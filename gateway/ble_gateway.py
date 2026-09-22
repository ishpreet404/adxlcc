#!/usr/bin/env python3
"""
Cyber Chaukidaar - Raspberry Pi BLE gateway.

Scans for sentry nodes advertising the 0xC0DE service (firmware built with -e ble),
subscribes to their uplink characteristic, reassembles newline-terminated JSON
packets and POSTs them to the central server.  The server's reply (which may carry
downlink commands such as {"cmd":{"mode":"LIVE"}}) is written back to the node's
downlink characteristic.

    pip install bleak requests
    python3 ble_gateway.py --server http://127.0.0.1:8787

Runs fine as a systemd service (see cybercc-ble-gateway.service).
"""

import argparse
import asyncio
import json
import logging
import time

import requests
from bleak import BleakClient, BleakScanner

SERVICE_UUID = "0000c0de-0000-1000-8000-00805f9b34fb"
UPLINK_UUID = "0000c0d1-0000-1000-8000-00805f9b34fb"
DOWNLINK_UUID = "0000c0d2-0000-1000-8000-00805f9b34fb"

log = logging.getLogger("ble-gateway")


class NodeLink:
    def __init__(self, device, server, key):
        self.device = device
        self.server = server.rstrip("/")
        self.key = key
        self.buf = bytearray()
        self.client = None

    async def run(self):
        while True:
            try:
                async with BleakClient(self.device, timeout=15.0) as client:
                    self.client = client
                    log.info("connected to %s (%s)", self.device.name, self.device.address)
                    await client.start_notify(UPLINK_UUID, self.on_notify)
                    while client.is_connected:
                        await asyncio.sleep(1.0)
            except Exception as exc:  # noqa: BLE001
                log.warning("%s: %s - retrying in 5 s", self.device.address, exc)
            self.client = None
            await asyncio.sleep(5.0)

    def on_notify(self, _handle, data: bytearray):
        self.buf.extend(data)
        while b"\n" in self.buf:
            line, _, rest = self.buf.partition(b"\n")
            self.buf = bytearray(rest)
            if line.strip():
                asyncio.get_event_loop().create_task(self.forward(bytes(line)))

    async def forward(self, raw: bytes):
        try:
            packet = json.loads(raw.decode("utf-8", "replace"))
        except json.JSONDecodeError:
            log.warning("bad JSON from %s: %r", self.device.address, raw[:80])
            return
        packet.setdefault("tr", "ble")
        if self.client and self.client.is_connected:
            try:
                rssi = await self.client.get_rssi() if hasattr(self.client, "get_rssi") else None
                if rssi is not None:
                    packet["rssi"] = int(rssi)
            except Exception:  # noqa: BLE001
                pass
        headers = {"Content-Type": "application/json", "X-Transport": "ble"}
        if self.key:
            headers["X-Node-Key"] = self.key
        loop = asyncio.get_event_loop()
        try:
            resp = await loop.run_in_executor(None, lambda: requests.post(f"{self.server}/api/ingest", json=packet, headers=headers, timeout=5))
            body = resp.text
            log.debug("%s -> %s %s", packet.get("id"), resp.status_code, body[:120])
            if resp.ok and self.client and self.client.is_connected:
                await self.client.write_gatt_char(DOWNLINK_UUID, body.encode("utf-8")[:500], response=False)
        except Exception as exc:  # noqa: BLE001
            log.warning("forward failed: %s", exc)


async def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--server", default="http://127.0.0.1:8787")
    ap.add_argument("--key", default="", help="NODE_API_KEY configured on the server (optional)")
    ap.add_argument("--scan-interval", type=float, default=15.0)
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    links = {}
    while True:
        try:
            devices = await BleakScanner.discover(timeout=6.0, service_uuids=[SERVICE_UUID])
        except Exception as exc:  # noqa: BLE001
            log.error("scan failed: %s", exc)
            devices = []
        for dev in devices:
            name = dev.name or ""
            if dev.address not in links and (name.startswith("SENTRY-") or True):
                log.info("found node %s at %s", name, dev.address)
                link = NodeLink(dev, args.server, args.key)
                links[dev.address] = link
                asyncio.create_task(link.run())
        await asyncio.sleep(args.scan_interval)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
