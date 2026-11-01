# Cyber Chaukidaar — full project context

> One file that explains the whole project: what it is, who it is for, every use case, how each
> part works, the numbers, the decisions, and the limits. Written for teammates, judges, and anyone
> (human or AI assistant) picking the project up cold. Deeper references are linked at the end.

---

## 1. One-paragraph summary

**Cyber Chaukidaar** ("cyber watchman") is a low-power, camera-free perimeter-security system.
Each **sentry node** is an ESP32-S3 with two ground-coupled **ADXL345 seismic probes** and a
**24 GHz mmWave radar**. It feels footsteps, digging, drilling and impacts through the ground or a
wall, sees people on the surface with the radar, classifies what it sensed **on the chip**, and
reports to a **Node.js command server**. The server fuses the evidence, applies the rules of the
active **mission** (nuclear exclusion zone, border tunnel watch, jewelry store, general perimeter),
and responds: a siren on the node or a silent alarm, a **Gemini** explanation on the operator's
phone, and a tamper-evident record in **TigerData** (Timescale). Operators use a responsive
dashboard that installs as a phone app, or a standalone **OLED control panel** with a keypad.

Built for **hackCBS 9.0**, entering the **Gemini** and **TigerData** sponsor tracks.

---

## 2. The problem

Cameras and guards watch the surface. The highest-stakes threats reach the **ground or a wall**
first:

| Setting | Why today's approach fails |
|---|---|
| Nuclear / radiation exclusion zones | Humans stand guard inside a hazard area, mostly to tell wildlife from trespassers. |
| International borders | Tunnels are dug underneath cameras and patrols; nothing on the surface sees them. |
| Jewelry stores after hours | Break-ins come through a shared wall or the vault, not the camera-covered front door. |
| Long fence lines, farms, depots | Patrols are expensive; cameras need power, light and line of sight. |

Vibration is the earliest, cheapest, light-independent signal for all of these.

---

## 3. Use cases (missions)

One hardware design, switched between missions in one tap (dashboard **Mission** page, OLED panel
**Mission** page, or `POST /api/system/profile {"id":"<id>"}`). A mission changes **what is looked
for, how detections are titled, how severe they are, and how the system responds**. Rules live in
`server/src/services/profiles.js` and run on every packet, on top of the fusion engine, using the
same 15 seismic features plus the radar.

### 3.1 Nuclear Exclusion Zone (`nuclear`)

- **Replaces:** human guards standing in a radiation hazard area.
- **Looks for:** wildlife vs people (by gait), vehicles, tampering.
- **How it decides:** a gait score counts four bipedal cues:
  1. at least ~300 ms between impacts;
  2. low-band energy ≥ 0.21;
  3. dominant impact frequency ≤ 11.8 Hz;
  4. cadence regularity ≥ 0.4.

  Three or more cues mean a person. The decision is a **majority vote over the node's last five
  step windows**, so one odd step cannot flip it. Small animals step faster (~170–290 ms) with
  lighter, higher-pitched (12–16 Hz) impacts.
- **Severity:** any person = **CRITICAL** ("Unauthorized person in hazard zone"); wildlife =
  MEDIUM, or HIGH within 2 m ("Wildlife in exclusion zone").
- **Response:** **audible**, 8 s siren from MEDIUM up, to scare wildlife away early. Armed 24/7.

### 3.2 Border & Tunnel Watch (`border`)

- **Replaces / adds to:** patrols and cameras that cannot see underground.
- **Looks for:** rhythmic subsurface digging, foot crossings, vehicles, tampering.
- **How it decides:** fusion never alerts on seismic evidence alone, so this mission adds its own
  path. It requires all of the following:
  - impulsive impacts (crest factor ≥ 3.5);
  - rhythmic, 0.4–3 s apart (cadence ≥ 0.3), and low-frequency;
  - **no surface target on the radar**;
  - sustained for ≥ 4 windows;
  - from a **stationary** source: the probe A/B loudness ratio stays steady, whereas a walker's
    changes.

  This raises "Possible tunnelling activity" (HIGH, then **CRITICAL** after 10 windows).
- **Response:** **silent alarm**, so intruders are not tipped off. It is logged as `SILENT_ALARM`
  and pushed to the phone and Telegram. The node siren never sounds.

### 3.3 Jewelry Store After-Hours (`retail`)

- **Replaces / adds to:** cameras that do not cover shared walls or the vault.
- **Looks for:** drilling or cutting, hammering, structural vibration, a person in the showroom.
- **How it decides:**
  - **Drilling or cutting on wall/vault** (CRITICAL) requires all of: continuous vibration
    (crest < 3.2); high-frequency content (dominant ≥ 15 Hz, or centroid ≥ 18 Hz with high-band
    ratio ≥ 0.4); at least 4× the ambient noise floor; sustained for 3 windows.
  - **Forced-entry impact** (HIGH): a sharp impact (≥ 0.25 g, crest ≥ 5).
  - **Vibration on wall/vault** (HIGH): strong vibration with nobody on the radar.
  - **Intruder in showroom** (CRITICAL): a radar target after hours.
- **Response:** **audible**, 15 s siren from HIGH up. Armed after hours via the arming schedule.

### 3.4 General Perimeter (`perimeter`, default)

- **Replaces / adds to:** fence-line patrols.
- **Looks for:** people and vehicles crossing, loitering, tampering.
- **Response:** audible, 10 s siren from HIGH up. Armed 24/7.

### 3.5 Capabilities that apply to every mission

| Capability | What it does |
|---|---|
| **Tamper detection** | Probe A's gravity vector is low-passed. A tilt > 20° from rest or a shock > 1.8 g raises TAMPER, even when the site is disarmed. |
| **Zones** | Polygons drawn on the site map: *restricted* escalates to CRITICAL, *watch* tags alerts, *allowed* lets vehicles pass (e.g. a driveway). |
| **Arming** | ARMED / TEST (silent alerts for walk tests) / DISARMED (log only), plus a daily auto-arm schedule. |
| **Panic / duress** | Hold the dashboard button 1.5 s or the panel's SELECT 2 s. Raises CRITICAL even when disarmed, Gemini-narrated, and sounds every node for 30 s unless the mission is silent. |
| **Silence** | Stops every node's siren: dashboard header, alert banner, phone emergency bar, panel Siren page. |
| **Loitering** | A radar target standing still ≥ 15 s raises LOITER. |
| **Kinematics** | Speed, heading, running detection (cadence < 420 ms), 5 s predicted position, ETA to the next node. |
| **Cooperative pre-arm** | A track heading toward another node wakes that node's radar (LIVE 90 s) before the intruder arrives. |
| **Two-node triangulation** | When two radars range the same target within 3 s, their range circles are intersected (±0.5 m). |
| **Multi-node tracks** | Detections within 4 m of each other merge into one target with one trail. |
| **Offline autonomy** | After 3 failed uplinks, an armed node on an audible mission that sees an intrusion or tamper sounds its own siren (at most once a minute), then reports `OFFLINE_ALARM` when the link returns. |
| **Notifications** | Telegram bot, generic webhook, GPIO relay on a Pi; rate-limited. |
| **Incident replay and export** | Scrub through an alert's frames on a mini map; CSV export. |
| **Activity intelligence** | 1 m heat map, last-24 h and hour-of-day histograms (TigerData-backed analytics). |
| **Self-calibration** | Re-learns rest orientation and noise floor on command. |
| **Probe sonification** | Listen to the ground probe as audio. |
| **Retraining loop** | Record labelled windows from the dashboard, retrain in Python, reflash. |
| **OSINT breach checker** | Carried over unchanged from v1 (`POST /api/breach-check`). |

---

## 4. System architecture

```
 ┌──────── Sentry node (ESP32-S3) ────────┐   HTTP/JSON    ┌────────────── Command server (Node.js) ──────────────┐
 │ ADXL345 A/B ─ band-pass ─ STA/LTA      │  (WiFi; BLE/   │ ingest → registry → RF re-verify → fusion LR        │
 │   └ 15 features → random forest        │   LoRa opt.)   │   → mission rules (profiles) → localise → tracks    │
 │   └ A/B cross-correlation (TDOA)       │ ─────────────► │   → alerts → response (siren / silent)              │
 │ LD2420 radar ─ presence / range        │ ◄───────────── │   ├─ Gemini: narrate, brief, text-to-SQL            │
 │ WS2812 ring · buzzer siren · tamper    │  downlink in   │   ├─ TigerData: hypertables, aggregates, evidence   │
 │ ECO sleep / LIVE / NVS settings        │  HTTP reply    │   └─ WebSocket fan-out                              │
 └────────────────────────────────────────┘                └──────┬──────────────────────┬──────────────────────┘
                                                                  │ WS / HTTPS           │ GET /api/basestation (~190 B)
                                                       ┌──────────▼─────────┐  ┌─────────▼──────────────────┐
                                                       │ React dashboard    │  │ OLED control panel (ESP32) │
                                                       │ + installable PWA  │  │ 3× SSD1306 · keypad · LED  │
                                                       └────────────────────┘  └────────────────────────────┘
```

### Why this split

- **The edge does the cheap, heavy work.** Filtering, triggering, features and the forest cost
  microseconds, so the radio can stay off. Raw waveforms travel only in LIVE mode.
- **The server re-verifies.** The same forest runs on the server, so the dashboard shows edge vs
  server agreement.
- **Fusion is a model guarded by rules.** A logistic regression gives an intrusion probability
  with inspectable per-term contributions. One modality alone never alerts, and ML-environmental
  with a clear radar is suppressed.
- **Mission rules sit on top.** They are explainable heuristics, and every alert carries a
  human-readable reason, e.g. "Rhythmic impacts every ~630 ms for 135 windows, source
  stationary, nothing on the surface radar".
- **Simulated nodes are real nodes.** They post through the same ingest path, so nothing
  downstream is faked.

---

## 5. Hardware

### 5.1 Sentry node (built): `pio run -e s3` / `-e s3-usb`

| Part | Pin (ESP32-S3) | Notes |
|---|---|---|
| ADXL345 #1 (probe A, left), SPI CS | GPIO 10 | 3.3 V only |
| ADXL345 #2 (probe B, right), SPI CS | GPIO 9 | |
| SPI SCK / MOSI / MISO | 12 / 11 / 13 | shared |
| LD2420 radar TX→RX / RX←TX | 16 / 17 | 115200 baud text (`ON`/`OFF`/`Range <cm>`) |
| WS2812B ring (8 LEDs) | GPIO 14 | LED 0 points along the heading, so it lights toward the target |
| Buzzer (active) | GPIO 5 | siren; `BUZZER_PASSIVE 1` for passive |
| Battery sense | GPIO 8 | 100 k/100 k divider; reads < 2.5 V ⇒ "External power (USB)" |

Ring states:

- A dim breath every 4 s: red when armed, green when disarmed.
- Strobing with the buzzer during a siren.

Mechanical coupling decides everything. Probes are bolted to steel spikes 25–35 cm deep, 1.5–2 m
apart, perpendicular to the radar heading. Expected range with good coupling: footsteps 5–8 m in
packed soil, vehicles 10–15 m.

### 5.2 OLED control panel ("nRF box"): `pio run -e base`

- Classic ESP32 with three SSD1306 OLEDs (software I²C pairs SCL/SDA 22/21, 19/18, 17/16).
- 5-way keypad: UP 26, DOWN 32, LEFT 25, RIGHT 27, SELECT 33.
- WS2812 status pixel on 14.

| Screen | Content |
|---|---|
| Left | the current page's rows (menu) |
| Middle | detail of the highlighted row, plus a footer saying exactly what SELECT will do |
| Right | newest real alert, or ALL CLEAR with site and mission |

Pages (fw 2.2.0). UP/DOWN moves, SELECT/RIGHT opens or acts, LEFT goes back.

| Page | Rows |
|---|---|
| Overview | Site, Nodes, Alerts, Mission (each opens its page) · Panic (hold 2 s) |
| Alerts | one row per open alert; SELECT acknowledges |
| Nodes | one row per node → node page: Sound siren · Silence siren · Live mode 5 min · Calibrate |
| Arming | ARMED · TEST · DISARMED (hold 1 s; the current mode is marked "now") |
| Mission | Nuclear · Border · Jewelry · Perimeter |
| Siren | Silence all · Panic (hold 2 s) |
| System | link, server, panel IP, firmware, free memory · Refresh now |

Status pixel:

| Colour | Meaning |
|---|---|
| Green pulse | armed and clear |
| Blinking orange | active alert |
| Solid red | critical alert |
| Off | disarmed |
| Dim blue | no server link |

The screens dim after 60 s idle.

### 5.3 Server host

Node.js 18+. It runs on a laptop or a Raspberry Pi (3B+/4/5/Zero 2 W). For the hackathon it
currently runs on the MacBook. No native dependencies.

### 5.4 Power budget (18650, 3000 mAh)

| State | Current |
|---|---|
| ECO light sleep (probes 25 Hz, radar off, radio off) | ≈ 1.3 mA avg |
| Heartbeat every 60 s | ≈ 1 mA avg |
| Active event (100 Hz, radar on, 1 pkt/s) | ≈ 180 mA for seconds |
| LIVE streaming | ≈ 200 mA, demo only, auto-expires |

- **On a quiet site:** about 3–4 weeks per charge. A 2 W solar panel with a TP4056 keeps it up
  indefinitely.
- **On USB/mains:** the node detects external power and checks in every 5 s with WiFi kept up,
  for fast commands.

---

## 6. Software components

| Path | What |
|---|---|
| `firmware/src/main.cpp` | Node: sampling, DSP, ML, state machine IDLE/SUSPECT/EVENT, power manager, downlink handling (`deter`, `silence`, `armed`, `audible`, live, calibrate), offline siren |
| `firmware/src/dsp/`, `ml/` | Biquad band-pass, STA/LTA, 15-feature extraction, random-forest inference |
| `firmware/src/comm/` | WiFi/BLE/LoRa transports, packet build and reply parsing |
| `firmware/src/indicators.*` | ring + buzzer patterns, armed breath, silence |
| `firmware/src/settings.*` | NVS settings + serial `cfg` console (WiFi, server, id, keys) |
| `firmware/src/base_station/` | OLED panel: FreeRTOS net task on core 0, interrupt-debounced keys, page system, hold-to-confirm |
| `server/src/services/pipeline.js` | per-packet pipeline |
| `server/src/services/fusion.js` | logistic-regression fusion and guard rails |
| `server/src/services/profiles.js` | missions and their rules |
| `server/src/services/alerts.js` | debounce, merge by kind, ack/resolve, mission severity, panic |
| `server/src/services/sponsors.js` | glue: response policy, Gemini narration, evidence hash, TigerData write |
| `server/src/services/reason.js` | Gemini: narrate, live feed, situation report, guarded text-to-SQL |
| `server/src/services/timeseries.js` | TigerData schema, lifecycle policies, analytics queries |
| `server/src/services/auth.js`, `ratelimit.js` | operator PIN sessions, panel/node keys, rate limits |
| `server/src/services/simulator.js` | physically synthesized actors: walker, vehicle, wind, wildlife, tunnel digger, drill |
| `dashboard/` | React + Vite + Tailwind + zustand, responsive app shell, PWA (manifest, service worker, icons) |
| `ml/` | pure-Python trainer; exports JSON (server) and a C header (firmware) |
| `gateway/` | Pi installer, systemd units, BLE and LoRa gateways |
| `tools/` | USB serial bridge, node emulator |

### Dashboard pages

| Page | What it shows |
|---|---|
| Overview | KPIs, active mission, live sensors, map, radar scope, seismic scopes, alerts, emergency bar on phones |
| Alerts | every alert with mission headline, Gemini summary, evidence hash, replay, actions |
| Intelligence | Gemini briefing feed, situation report, ask-the-data; TigerData analytics |
| Nodes | per-node telemetry and controls (sound, silence, live, calibrate) |
| Mission | choose the use case |
| Settings | site, zones, arming schedule, notifications, simulator, recording |
| OSINT | breach checker |

Keyboard shortcuts:

| Key | Action |
|---|---|
| `1`–`7` | switch pages |
| `A` | acknowledge all |
| `M` | mute |
| `W` | wall mode |

---

## 7. Machine learning

### 7.1 Features

15 features are computed from a 1.28 s window (shared contract between Python, C++ and JS):

| # | Feature | # | Feature | # | Feature |
|---|---|---|---|---|---|
| 1 | rms | 6 | spectralEnergy | 11 | kurtosis |
| 2 | peak | 7 | spectralCentroid | 12 | spectralFlatness |
| 3 | peakToPeak | 8 | interPeakInterval | 13 | lowBandRatio (1–8 Hz) |
| 4 | variance | 9 | zeroCrossingRate | 14 | highBandRatio (20–50 Hz) |
| 5 | dominantFrequency | 10 | crestFactor | 15 | cadenceStrength |

### 7.2 Models

| Model | Type | Input | Output | Runs on |
|---|---|---|---|---|
| `vibration_rf` | random forest, 12 trees, depth ≤ 8 (≈ 21 KB) | 15 features | NORMAL / HUMAN / VEHICLE / ENVIRONMENT | ESP32 and server |
| `fusion_lr` | logistic regression | radar, probe RMS, dual corroboration, cross-correlation, RF probabilities | intrusion probability | server |

### 7.3 Accuracy (synthetic data)

| Test set | 4-class | Intrusion vs benign |
|---|---|---|
| Held-out 20 % | 91.8 % | 96.2 % |
| Unseen seed (other soils, cadences, noise) | 91.5 % | 94.7 % |

The server smooths class probabilities over consecutive windows (α = 0.45).

---

## 8. Sponsor integrations

### 8.1 Gemini (`server/src/services/reason.js`, `routes/ai.js`)

- **Model:** `gemini-flash-lite-latest` (largest free-tier allowance). Uses `@google/genai`.
- **Alert narration:** every real alert gets a mission-aware explanation (what, where, how sure,
  what to do). It is attached to the alert and streamed as a live feed over WebSocket.
- **Situation report:** `POST /api/ai/brief` summarises nodes, open alerts and recent activity.
- **Ask the data:** `POST /api/ai/ask` turns natural language into SQL with these guards:
  - one `SELECT` only, over allowlisted tables;
  - executed on a **read-only TigerData role**;
  - rate limited.
- **Robustness:**
  - 12 s timeout, then a quota cooldown;
  - `thinkingConfig` only on models that support it;
  - a template fallback, so an alert never waits on AI;
  - simulated alerts are capped per hour (`GEMINI_SIM_PER_HOUR`), so the demo cannot drain the
    quota.

### 8.2 TigerData / Timescale (`server/src/services/timeseries.js`, `routes/tiger.js`)

- **Hypertables:** `telemetry` (every packet) and `alerts` (with label, mission profile and
  evidence hash).
- **Continuous aggregate:** `telemetry_1s`, refreshed every 10 s; it powers the activity charts.
- **Compression:** after 1 day, segmented by node.
- **Retention:** raw rows are dropped after 30 days.
- **Evidence hash:** a SHA-256 over each alert's evidence (ids, time, class, probability,
  interpretation, ML output, position, first waveform samples). It makes the record
  tamper-evident.
- **Analytics endpoints:** `/api/tiger/stats`, `/activity`, `/alerts-timeline`, `/status`.
- **TLS:** follows `sslmode` from the connection string.

---

## 9. Protocol and APIs

### 9.1 Node ↔ server

- **Uplink:** the node POSTs JSON to `/api/ingest` (or `/api/telemetry`, legacy v1) carrying
  features, ML output, radar, battery, RSSI, state, `offlineAlarms`, etc.
- **Downlink:** commands ride in the **HTTP reply** to the next uplink, so there is no polling.
  Every reply also carries the site's arming (`arm`) and the mission's siren policy (`aud`); that
  is what makes offline autonomy possible.
- **Command latency:** about 1 s while active, about 5 s on mains, up to 60 s in battery ECO.

### 9.2 Main REST routes

| Prefix | Routes |
|---|---|
| `/api/nodes` | list, get, update, `/:id/history`, `/:id/wave`, `/:id/command` |
| `/api/alerts` | list, ack, resolve, dismiss, acknowledge-all |
| `/api/system` | profile, arming (+ schedule), site, zones, siren, silence, panic, sim (start, stop, scenario, intruder, tamper), record, notify (Telegram, test), panels, events, health |
| `/api/ai` | status, feed, brief, ask |
| `/api/tiger` | status, stats, activity, alerts-timeline |
| `/api/basestation` | ~190-byte summary for the OLED panel (short keys; `bat:-2` = USB) |
| `/healthz` | public liveness probe |
| `/ca.crt` | public local-CA certificate, used to trust HTTPS on a phone (never the key) |

Real-time updates go over WebSocket at `/ws` (alerts, telemetry, AI feed, profile changes).

---

## 10. Configuration (`server/.env`)

| Variable | Purpose |
|---|---|
| `PORT` (8787), `HTTPS_CERT`, `HTTPS_KEY`, `HTTPS_PORT` (8443) | HTTP for nodes; HTTPS for the installable app |
| `ACCESS_PIN` | operator PIN (HMAC-signed HttpOnly session cookie) |
| `PANEL_KEY`, `NODE_API_KEY` | panel and node shared secrets |
| `DATABASE_URL`, `DATABASE_URL_RO` | TigerData service, plus a read-only role for AI SQL |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_SIM_PER_HOUR`, `GEMINI_NARRATE_SIM` | Gemini |
| `SIM_NODES`, `BASESTATION_SHOW_SIM` | simulator nodes; show them on the panel |

Node and panel WiFi and server settings are set over serial, not compiled in:

- `cfg wifi <ssid> <pass>`
- `cfg server <url|auto>`
- `cfg key <panel key>`
- `cfg show`, `scan`, `btnscan`, `reboot`

---

## 11. Optimisations

| Area | What we did |
|---|---|
| Power | ECO light sleep, radar power-gating, 60 s heartbeat on battery, wake on a seismic spike or a radar `ON`; 5 s heartbeat only on external power |
| Bandwidth | features instead of waveforms; downlink piggybacks on the uplink reply |
| Panel RAM (~300 KB ESP32) | the panel reads a ~190-byte summary, never the multi-hundred-KB alert list; networking runs on its own FreeRTOS task (core 0), so the keypad never blocks |
| UI correctness on the panel | in-flight lock (one action at a time), hold-to-confirm for arming and panic, every action reports its result |
| Latency | siren reached the node in **0.3 s**, silence in **0.9 s** (measured, node on USB) |
| AI cost | flash-lite model, simulated-alert budget, quota cooldown, template fallback |
| Storage | 1 s continuous aggregate for charts, compression after 1 day, 30-day retention |
| Discovery | UDP auto-discovery exists, but the server IP is pinned on the hackathon network because laptops with several interfaces can advertise an unreachable address |

---

## 12. Security and safety

- **Access control:** operator PIN with signed session cookies, separate panel and node keys.
- **Transport and limits:** HTTPS via a local CA, security headers, rate limits on AI endpoints.
- **AI-generated SQL:** a single read-only `SELECT`, on allowlisted tables, on a read-only role.
- **No secrets in source:** WiFi credentials are entered through the serial console.
- **Evidence integrity:** a SHA-256 evidence hash per alert, stored in TigerData.
- **Fail-safe behaviour:** tamper alarms fire while disarmed; dangerous controls need a hold; the
  offline siren works when the server is unreachable.
- **Deliberately out of scope:** no WiFi interception, rogue access points, or collection of
  people's device identities. It would be non-consensual surveillance and illegal in most
  jurisdictions. The system senses physical presence only.

---

## 13. Measured and current state (as of 2026-11-01)

| Item | State |
|---|---|
| Hardware | 1 real sentry node (N1, ESP32-S3, USB-powered) and the OLED panel (fw 2.2.0), both online |
| Network | server on the MacBook at `10.31.128.201` (HTTP 8787, HTTPS 8443) on the "Nothing" 2.4 GHz hotspot; panel at `10.31.128.35` |
| TigerData | connected, hypertables live, writes flowing |
| Gemini | connected, `gemini-flash-lite-latest`, 0 failures in the current run |
| Measured latency | siren 0.3 s, silence 0.9 s; recovery after server restart verified |
| Code size | ≈ 13.7k lines: firmware ~2.9k, server ~4.4k, dashboard ~5.4k, ML ~1k |

---

## 14. Known limits (stated honestly)

- Mission thresholds were tuned on simulator-synthesized signals and bench tests, not field data.
  Record labelled windows on site (**Settings → Record**) and re-tune before real deployment.
- The 94–96 % accuracy figures come from synthetic validation sets.
- Only one physical node exists today. Extra nodes are flashed from the same binary with a
  different `cfg id`, and the simulator fills the multi-node views in the meantime.
- The seismic bearing is coarse (100 Hz sampling ≈ 10 ms TDOA resolution over a 1.5 m baseline).
  Radar range is good to ~0.3 m.
- Sensitivity depends heavily on soil and mechanical coupling.

---

## 15. Roadmap

1. Collect field data and retrain (the recorder is built in).
2. Use LoRa for remote borders (the driver exists: `-e lora`).
3. Build a solar, weatherproof node enclosure.
4. Field-test two-node triangulation and pre-arm hand-off.
5. Run a pilot with one of the three mission customers.

---

## 16. Demo script (5 minutes)

1. **Arm the site and walk past the node.** You get an alert, the buzzer and ring sound, and the
   Gemini narration appears on the phone.
2. **Switch to Nuclear and tap the floor lightly and quickly** (out of radar view). You get
   "Wildlife in exclusion zone".
3. **Switch to Border and knock every ~0.6 s for 5 s** (out of radar view). You get a silent
   "Possible tunnelling activity".
4. **Switch to Jewelry and press a vibrating phone or toothbrush on the surface.** You get
   "Drilling or cutting on wall/vault".
5. **Silence from the OLED panel, then ask Gemini a question.** The answer comes from TigerData.

Backup: **Settings → Include simulated demo nodes**, then the scenarios `wildlife`, `tunnel`,
`drilling` and `patrol` run the same pipeline without hardware.

---

## 17. Running it

```bash
npm run setup && npm run build      # server + dashboard deps, build dashboard
cd server && npm start              # http://<ip>:8787 (+ https://<ip>:8443 if certs configured)
cd firmware && pio run -e s3-usb -t upload   # sentry node (S3: esptool --no-stub + watchdog_reset quirks)
cd firmware && pio run -e base -t upload     # OLED panel
```

Install as a phone app:

1. Open `http://<ip>:8787/ca.crt` on the phone and trust the CA.
2. Open `https://<ip>:8443`.
3. Use **Install app** (Android) or **Add to Home Screen** (iPhone).

---

## 18. Project history (key decisions)

- **v1:** an OSINT breach checker (kept, unchanged).
- **v2:** dual-probe seismic + radar node, edge ML, fusion, localisation, simulator.
- **v2.1:** tamper, zones, arming, kinematics, pre-arm, triangulation, loiter, notifications,
  replay.
- **hackCBS build:**
  - added the missions (nuclear, border, retail);
  - integrated Gemini and TigerData;
  - added the node siren and the OLED control panel with real pages;
  - redesigned the dashboard and made it an installable phone app;
  - added operator auth and HTTPS;
  - added panic and silence, the power-aware heartbeat, and the offline siren.
- **Dropped:** the Solana track (out of scope for the hardware story).
- **Fixed along the way:**
  - deprecated Gemini models;
  - TigerData TLS chain errors;
  - panel RAM exhaustion;
  - stacked keypad presses toggling arming;
  - USB power misreported as a low battery.

---

## 19. Further reading

[architecture.md](architecture.md) · [use-cases.md](use-cases.md) · [operations.md](operations.md) ·
[hardware.md](hardware.md) · [firmware.md](firmware.md) · [protocol.md](protocol.md) ·
[demo.md](demo.md) · [deployment-raspberry-pi.md](deployment-raspberry-pi.md) ·
[../ml/README.md](../ml/README.md)
