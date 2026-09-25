# Firmware

## Build & flash

```bash
pip install platformio            # once
cd firmware
pio run -e s3 -t upload           # ESP32-S3 build (SPI ADXL345, LD2420, ring, buzzer)
pio run -e wifi -t upload         # classic ESP32 (or -e ble / -e lora)
pio device monitor -b 115200
```

The ESP32 boots into **ECO** and immediately sends one heartbeat so it shows up on the map.

## Configure a node (no recompiling)

Open the serial monitor and type:

```
cfg id N1
cfg wifi CyberChaukidaar SentryGrid2026   # default = the Pi hotspot; any other 2.4 GHz network works too
cfg server auto                 # default: find the Pi by UDP broadcast on udp/8788 (or give http://<pi-ip>:8787)
cfg key mysecret            # only if NODE_API_KEY is set on the server
cfg show
reboot
```

Other console commands: `live` (stream for 5 min), `eco`, `status`, `help`. Settings live in NVS and survive re-flashing.

## Runtime behaviour

```
              seismic trigger / radar OUT / downlink LIVE
   ┌────────┐ ─────────────────────────────────────────► ┌─────────────────────┐
   │  ECO   │                                            │  ACTIVE  (or LIVE)  │
   │ 25 Hz  │ ◄───────────────────────────────────────── │ 100 Hz, radar on,   │
   │ sleep  │      20 s quiet (ACTIVE) / timer (LIVE)    │ 1 pkt/s (4 in LIVE) │
   └────────┘                                            └─────────────────────┘
      heartbeat every 60 s (battery, RSSI, noise floor)
```

* **ECO**: ADXL345s at 25 Hz low-power streaming into their FIFOs; the ESP32 light-sleeps 1 s, wakes, drains both FIFOs (≈25 samples), updates the STA/LTA pickers and sleeps again. WiFi is off. Every `HEARTBEAT_ECO_S` it reconnects (≈300 ms using the cached BSSID/channel), posts a packet and switches the radio off again.
* **ACTIVE**: sensors at 100 Hz, radar powered and warmed up, every second: features → forest → cross-correlation → packet. The node state is `EVENT` when radar and seismic agree, `SUSPECT` for one of them.
* **LIVE**: like ACTIVE but 4 packets/s with 25-sample waveform snapshots per probe, for the dashboard scopes and the ML recorder. Entered from the dashboard's LIVE button (downlink), the console, or `BOOT_LIVE 1`; expires after `liveFor` seconds.

All tunables (`STA_LTA_TRIGGER`, `ACTIVE_HOLD_S`, `HEARTBEAT_ECO_S`, pins, baud…) are in `include/config.h`.

## Downlink

Every uplink's HTTP reply may carry `{"cmd":{"mode":"LIVE","liveFor":300}}`, `{"cmd":{"mode":"ECO"}}` or `{"cmd":{"reboot":true}}`. Queue one from the dashboard (LIVE/ECO buttons) or `POST /api/nodes/:id/command`.

## Bench testing without WiFi

The firmware echoes each packet on the serial port as `>>{json}`. Forward it:

```bash
cd tools && npm install serialport
node serial-bridge.js COM5 http://127.0.0.1:8787
```

## Updating the ML model on the node

`python ml/train.py` regenerates `firmware/include/model_vibration.h`; rebuild and flash. The forest is flattened into arrays (no recursion, no heap) and costs < 100 µs per window.

## Sanity checks on first power-up

Serial log should show `probe A @0x53 OK, probe B @0x1D OK`. Stamp next to a spike: the console prints `IDLE → SUSPECT (ml=HUMAN …)`. Wave a hand in front of the radar while active: `radar=yes 1.2m`. If a probe reports MISSING, check SDO strapping and pull-ups.
