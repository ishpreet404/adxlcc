#!/usr/bin/env python3
"""
Cyber Chaukidaar - Raspberry Pi LoRa gateway (SX127x on SPI).

Receives the 40-byte binary frames sent by nodes built with -e lora, expands
them into v2 JSON packets and POSTs them to the server.  Any downlink command
in the server reply is transmitted back as "<nodeId>:<json>" right after the
uplink, while the node is still listening (400 ms window).

Hardware: SX1276/SX1278 module on the Pi's SPI0 (e.g. Adafruit RFM95 bonnet,
Dragino LoRa HAT).  Uses the `pyLoRa` package (`pip install pyLoRa spidev RPi.GPIO`).
Frequency / sync word must match firmware/include/config.h.

    python3 lora_gateway.py --server http://127.0.0.1:8787 --freq 865.0
"""

import argparse
import json
import logging
import struct
import time

import requests

log = logging.getLogger("lora-gateway")

FRAME = struct.Struct("<BB8sHIHBbBBBBBHHbBBBBHB")
FRAME_SIZE = FRAME.size  # 40 bytes
CLASSES = ["NORMAL", "HUMAN", "VEHICLE", "ENVIRONMENT"]


def crc8(data: bytes) -> int:
    c = 0
    for b in data:
        c ^= b
        for _ in range(8):
            c = ((c << 1) ^ 0x07) & 0xFF if c & 0x80 else (c << 1) & 0xFF
    return c


def decode(frame: bytes, rssi: int):
    if len(frame) != FRAME_SIZE:
        raise ValueError(f"frame size {len(frame)} != {FRAME_SIZE}")
    (magic, version, ident, seq, uptime_s, bat_mv, bat_pct, _unused, mode, state, radar_flags,
     radar_dm, radar_energy, rms_a, rms_b, lag10, corr_pct, ml_class, ml_conf, dom2, ipi, crc) = FRAME.unpack(frame)
    if magic != 0xC7 or version != 2:
        raise ValueError("bad magic/version")
    if crc8(frame[:-1]) != crc:
        raise ValueError("crc mismatch")
    node_id = ident.split(b"\0", 1)[0].decode("ascii", "replace")
    probs = [0.05] * 4
    probs[ml_class % 4] = ml_conf / 100.0
    return {
        "v": 2, "id": node_id, "seq": seq, "up": uptime_s * 1000, "fw": "2.x-lora", "tr": "lora", "rssi": rssi,
        "mode": "LIVE" if mode == 1 else "ECO", "st": ["IDLE", "SUSPECT", "EVENT"][state % 3],
        "bat": {"v": bat_mv / 1000.0, "p": bat_pct},
        "radar": {"ok": bool(radar_flags & 4), "pres": bool(radar_flags & 1), "mov": 1 if radar_flags & 2 else 0,
                  "dist": radar_dm / 10.0, "eng": radar_energy},
        "a": {"ok": True, "rms": rms_a / 10000.0, "peak": rms_a / 10000.0 * 3.0, "sl": 0},
        "b": {"ok": True, "rms": rms_b / 10000.0, "peak": rms_b / 10000.0 * 3.0, "sl": 0},
        "seis": {"lag": lag10 / 10.0, "corr": corr_pct / 100.0, "ratio": (rms_a / rms_b) if rms_b else 0,
                 "f": [rms_a / 10000.0, rms_a / 10000.0 * 3, rms_a / 10000.0 * 5, (rms_a / 10000.0) ** 2, dom2 / 2.0, 0, 0, ipi, 0, 3.0] if dom2 else None},
        "ml": {"c": ml_class, "p": probs},
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--server", default="http://127.0.0.1:8787")
    ap.add_argument("--key", default="")
    ap.add_argument("--freq", type=float, default=865.0, help="MHz, must match LORA_FREQUENCY")
    ap.add_argument("--sync", type=lambda v: int(v, 0), default=0x2C)
    ap.add_argument("--sf", type=int, default=9)
    ap.add_argument("--simulate-file", help="replay hex frames from a file instead of a radio (testing)")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    headers = {"Content-Type": "application/json", "X-Transport": "lora"}
    if args.key:
        headers["X-Node-Key"] = args.key

    def forward(frame: bytes, rssi: int, send_downlink):
        try:
            packet = decode(frame, rssi)
        except ValueError as exc:
            log.warning("dropped frame: %s", exc)
            return
        try:
            resp = requests.post(f"{args.server.rstrip('/')}/api/ingest", json=packet, headers=headers, timeout=5)
            log.info("%s seq=%s -> %s", packet["id"], packet["seq"], resp.status_code)
            body = resp.json() if resp.ok else {}
            if body.get("cmd"):
                send_downlink(f"{packet['id']}:{json.dumps({'cmd': body['cmd']})}".encode())
        except Exception as exc:  # noqa: BLE001
            log.warning("forward failed: %s", exc)

    if args.simulate_file:
        for line in open(args.simulate_file, "r", encoding="utf-8"):
            line = line.strip()
            if line:
                forward(bytes.fromhex(line), -70, lambda b: log.info("downlink: %s", b))
                time.sleep(0.5)
        return

    from SX127x.LoRa import LoRa, MODE  # pyLoRa
    from SX127x.board_config import BOARD

    BOARD.setup()

    class Gateway(LoRa):
        def __init__(self):
            super().__init__(verbose=False)
            self.set_mode(MODE.SLEEP)
            self.set_dio_mapping([0] * 6)
            self.set_freq(args.freq)
            self.set_spreading_factor(args.sf)
            self.set_bw(7)  # 125 kHz
            self.set_coding_rate(1)  # 4/5
            self.set_sync_word(args.sync)
            self.set_rx_crc(True)
            self.set_pa_config(pa_select=1, max_power=7, output_power=15)

        def on_rx_done(self):
            self.clear_irq_flags(RxDone=1)
            payload = bytes(self.read_payload(nocheck=True))
            rssi = self.get_pkt_rssi_value()
            forward(payload, rssi, self.send_downlink)
            self.set_mode(MODE.RXCONT)

        def send_downlink(self, data: bytes):
            self.set_mode(MODE.STDBY)
            self.write_payload(list(data))
            self.set_mode(MODE.TX)
            time.sleep(0.15)
            self.set_mode(MODE.RXCONT)

    gw = Gateway()
    gw.set_mode(MODE.RXCONT)
    log.info("listening on %.1f MHz SF%d", args.freq, args.sf)
    try:
        while True:
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        gw.set_mode(MODE.SLEEP)
        BOARD.teardown()


if __name__ == "__main__":
    main()
