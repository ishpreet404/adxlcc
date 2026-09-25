# 🛡️ Cyber Chaukidaar v2

**Battery-powered perimeter sentry grid**: ESP32 nodes with a human-presence radar and two ground-coupled ADXL345 seismic probes report to a Raspberry Pi server that runs edge-verified ML, multi-modal fusion, rough target localisation and alarms, all on one tactical dashboard. The OSINT breach checker (`POST /api/breach-check` and its page) is carried over from v1 unchanged.

```
 ┌──────────── node (ESP32, 18650) ────────────┐        ┌────────── Raspberry Pi ───────────┐
 │ radar (LD2410) ── distance / energy         │  WiFi  │ server/  Node.js                  │
 │ ADXL345 A ─┐ band-pass → STA/LTA → 10 feats │  BLE   │  ingest → RF verify → fusion LR   │  WS   ┌───────────┐
 │ ADXL345 B ─┘ x-corr TDOA  → random forest   │  LoRa  │  → localise → tracks → alerts     │ ────► │ dashboard │
 │ ECO light-sleep · LIVE streaming · downlink │ ─────► │  simulator · recorder · breach API │       └───────────┘
 └─────────────────────────────────────────────┘        └────────────────────────────────────┘
```

## What is in the box

| Path | What | Status |
|---|---|---|
| `firmware/` | ESP32 PlatformIO project: ADXL345 FIFO driver, LD2410/LD1125H radar driver, biquad band-pass, STA/LTA picker, 128-pt FFT features, on-device random forest, cross-correlation TDOA, power manager (light/deep sleep, fast WiFi reconnect, radar power gating), WiFi / BLE / LoRa transports, NVS settings + serial console | builds for `wifi`, `ble`, `lora` |
| `server/` | Node.js (no native deps): packet normalisation (v2 + legacy v1), server-side RF verification, logistic-regression fusion with explainable evidence, per-node localisation, multi-node track merging, alert lifecycle, event log, WebSocket fan-out, physically-consistent simulator, ML recorder, dashboard hosting, **unchanged breach checker** | `npm test` passes |
| `dashboard/` | React + Vite + Tailwind: site map (nodes, radar beams, probe rings, estimated positions with uncertainty, tracks, ground truth), radar PPI scope, dual seismic oscilloscope, probe cards, spectrum, telemetry column (battery %, voltage, RSSI, transport, mode, uptime, heap, temp, sensor health), fusion panel, alerts + siren, incidents, site setup with drag-to-place, **unchanged Threat Intel page** | built |
| `ml/` | Pure-Python trainer (no numpy/sklearn): realistic synthetic seismic generator, 15-feature random forest + logistic regression, exports JSON for the server and a C header for the ESP32; real-data recording loop; cross-window smoothing on the server | 96 % intrusion-vs-benign |
| `gateway/` | Raspberry Pi installer + systemd units, BLE gateway (bleak), LoRa gateway (SX127x) | |
| `tools/` | USB serial bridge (node ↔ server without WiFi), stand-alone node emulator | |
| `docs/` | architecture, hardware/wiring, firmware, protocol, deployment, demo | |

## v2.1 hackathon features (same hardware)

| Feature | Where | How it works |
|---|---|---|
| **Tamper detection** | node → dashboard/alerts | probe A's gravity vector is low-passed; tilt > 20° from the calibrated rest or a > 1.8 g shock raises a TAMPER alert (fires even when disarmed), wakes the node and strobes its LED |
| **Zones** | Setup → draw on map | polygons with rules: *restricted* escalates anything inside to CRITICAL, *watch* tags alerts, *allowed* lets vehicles pass (driveway) |
| **Arm / Test / Disarm + schedule** | top bar, Setup | DISARMED logs only, TEST raises silent alerts for walk tests, daily auto-arm window |
| **Target kinematics** | map, alert cards | speed, compass heading, RUNNING (cadence < 420 ms), 5 s predicted position, ETA to the next node |
| **Cooperative pre-arm** | server → node downlink | a track heading for another node wakes that node's radar (LIVE 90 s) before the intruder arrives |
| **Two-node triangulation** | tracks | when two radars range the same target within 3 s the range circles are intersected (±0.5 m) |
| **Loitering** | alerts | a radar target standing still ≥ 15 s raises a LOITER alert |
| **Battery forecast & link quality** | telemetry column | voltage slope → hours left; packet loss from sequence gaps; reboot counter |
| **Notifications** | Pi only | Telegram bot, generic webhook, GPIO siren/strobe relay on the Pi, rate-limited |
| **Activity intelligence** | Incidents, map HEAT layer | 1 m heat map of target positions, last-24 h and hour-of-day histograms |
| **Incident replay** | Incidents ▶ REPLAY | scrub through the alert's frames (position, probability, radar range, probe RMS) on a mini map |
| **Probe sonification** | telemetry LISTEN | hear the ground probe: vibration envelope modulates a low tone |
| **Wall mode, toasts, layers, shortcuts, CSV export** | dashboard | `W` fullscreen map with alert banner; `1–5 A M G E` keys; map layers BEAMS/ZONES/HEAT/TRAILS/PREDICT/LABELS |
| **Node self-calibration & deterrent** | telemetry buttons | CALIBRATE re-learns rest orientation + noise floor; DETER strobes the LED / `PIN_DETERRENT` for 10 s |

## Quick start (laptop, no hardware)

```bash
npm run setup          # installs server + dashboard deps
python ml/train.py     # (already done; re-run to retrain) → models for server + firmware
npm run build          # builds the dashboard into dashboard/dist
npm start              # server on http://localhost:8787 with 2 simulated nodes walking a patrol
```

Open http://localhost:8787. Use **SITE SETUP → SIMULATOR** to change scenarios or send a one-off walker/vehicle at any node. For dashboard development run `npm run dev:dashboard` (Vite on :5173, proxied to the server).

## Hardware you have → what to do

| Item | Role |
|---|---|
| 1 × ESP32 + 2 × ADXL345 + 1 × radar | one real sentry node — flash `firmware/` (`pio run -e wifi -t upload`), set its WiFi/server over the serial console |
| 1 × Raspberry Pi | the central server (`bash gateway/install.sh`) — also the BLE/LoRa gateway if you use those links |
| more nodes later | flash the same binary, type a different `cfg id`; they appear on the map automatically |

Extra nodes can be **simulated** meanwhile (clearly labelled SIM everywhere) so the multi-node view, tracking and alarms can be exercised end-to-end today.

See [docs/hardware.md](docs/hardware.md) for wiring/BOM/mechanical coupling, [docs/firmware.md](docs/firmware.md) for flashing and the power profile, [docs/deployment-raspberry-pi.md](docs/deployment-raspberry-pi.md) for the Pi, [docs/protocol.md](docs/protocol.md) for the packet/REST/WS contract, [docs/demo.md](docs/demo.md) for a scripted demo, and [ml/README.md](ml/README.md) for the models.

## Breach checker

`POST /api/breach-check` (`server/src/routes/breach.js`) and the **THREAT INTEL (OSINT)** page (`dashboard/src/pages/ThreatIntelligence.jsx`, plus the `Card/Input/Button/StatusBadge/Separator` primitives it uses) are byte-for-byte the v1 implementation. Set `LEAKOSINT_API_KEY` in `server/.env` to use the live upstream; otherwise the built-in offline dataset answers.
