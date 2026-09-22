# Architecture

## Data flow

```
ADXL345 A/B (100 Hz FIFO) ─► magnitude ─► HP 1.5 Hz + LP 40 Hz ─► ring buffers (2.56 s)
                                             │                        │
                                             ▼                        ▼
                                       STA/LTA picker        128-sample window every 1 s
                                       (0.25 s / 4 s)        ├─ 10 features (FFT, IPI, ZCR, crest…)
                                             │               ├─ random forest → class + probs
                                             │               └─ x-corr(A,B) → lag (TDOA), corr
radar (LD2410 UART) ─► presence / distance / energy          │
                                             └───────────────┴──► node state IDLE / SUSPECT / EVENT
                                                                   │
                                                          v2 JSON packet (WiFi | BLE | LoRa)
                                                                   ▼
server: normalise → registry → RF re-verify → fusion LR → localise → tracks → alerts → WebSocket
```

## Why this split

* **Edge does the heavy, cheap work.** Filtering, picking, features and the forest cost microseconds on the ESP32 and let the radio stay off. Raw waveforms only travel in LIVE mode (demo / recording).
* **Server re-verifies.** The same forest runs on the server on the features (or on the waveform when the node did not send features), so the dashboard can show *edge RF vs server RF*. Both are trained by the same script.
* **Fusion is a model, guarded by rules.** A logistic regression over ten evidence terms gives an intrusion probability with additive, inspectable contributions. Rules on top: one modality alone can never alert; ML-environmental with a clear radar is suppressed.
* **Localisation is honest.** Range from the radar (or seismic fall-off), bearing from the probe pair (TDOA + amplitude ratio). It is drawn as an *estimated position* with an uncertainty ellipse. 100 Hz sampling gives ~10 ms TDOA resolution over a 1.5 m baseline, so the seismic bearing is coarse; the radar range is good to ~0.3 m.
* **Tracks merge across nodes.** Detections from different nodes that agree within 4 m are one target with one trail.
* **Simulated nodes are real nodes.** They post through the same ingest path; the simulator also broadcasts ground truth so the estimate can be judged on the map.

## Repository layout

```
firmware/   ESP32 node (PlatformIO)        server/   Node.js central server (+ unit tests)
dashboard/  React tactical UI              ml/       trainer + models (JSON + C header)
gateway/    Raspberry Pi installer, BLE/LoRa gateways, systemd
tools/      serial bridge, node emulator   docs/     this folder
```

## Server modules

| Module | Responsibility |
|---|---|
| `services/registry.js` | node placement (persisted `data/site.json`), packet normalisation (v2 & v1), history, waveform buffers, health sweep |
| `ml/features.js`, `ml/classifier.js` | feature contract + forest inference (same maths as firmware and Python) |
| `services/fusion.js` | evidence vector → LR probability → severity/level, guard rails, evidence list |
| `services/localization.js` | node-frame geometry → site coordinates + uncertainty |
| `services/tracks.js` | multi-node merge, smoothing, trail, TTL |
| `services/alerts.js` | debounce (2 packets), per-node cooldown merge, ack/resolve/dismiss, auto-resolve, NDJSON |
| `services/simulator.js` | actors (walker/vehicle/wind) sensed by simulated nodes with the same physics |
| `services/recorder.js` | labelled window capture for retraining |
| `services/commands.js` | downlink queue delivered in the HTTP reply to the node's next uplink |
| `routes/breach.js` | **unchanged** OSINT breach checker |
