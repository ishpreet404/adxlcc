# Operations: dashboard, phone app, base station, production settings

## Running the server (laptop or Raspberry Pi)

```bash
cd server && npm install && npm start
```

The server serves the built dashboard on `http://<host>:8787` and, when certificates are
configured, `https://<host>:8443`. Sensor nodes always post over plain HTTP to port 8787.

## Dashboard

| Page | What it shows |
|---|---|
| Overview | KPIs, active mission, live sensors of the selected node, map, radar, seismic scopes, alerts |
| Alerts | Every alert with mission headline, Gemini summary, evidence hash, replay, actions |
| Intelligence | Gemini live briefing, situation report, ask-the-data (text-to-SQL); TigerData analytics |
| Nodes | Per-node detail and controls: sound alarm, live mode, calibrate |
| Mission | Choose the deployment use case (see [use-cases.md](use-cases.md)) |
| Settings | Site, zones, arming schedule, notifications, simulator, recording, demo-data switch |
| OSINT | Breach checker |

Keyboard: `1`–`7` switch pages, `A` acknowledge all, `M` mute, `W` wall mode.

## Install it as an app on a phone

Browsers only allow installing a web app (and its offline service worker) over HTTPS.

1. `cd server && sh scripts/make-cert.sh` — creates a private CA and a certificate for the
   laptop's LAN address, and prints the three `HTTPS_*` lines to add to `server/.env`.
2. Restart the server; it logs `[https] dashboard also on https://...:8443`.
3. Send `server/certs/ca.crt` to the phone and trust it once (the script prints the steps for
   iPhone and Android).
4. Open `https://<laptop-ip>:8443` on the phone → **Install app** (Android) or
   **Share → Add to Home Screen** (iPhone).

If the laptop's IP changes, re-run the script so the certificate covers the new address.

## OLED base station (nRF box)

ESP32 + three SSD1306 OLEDs + 5-way keypad + WS2812 status pixel. Firmware: `pio run -e base`.

| Screen | Content |
|---|---|
| Left (menu) | Overview · Alerts · Nodes · Arming · Mission · Siren · System (UP/DOWN) |
| Middle (detail) | The highlighted item; LEFT/RIGHT pages through alerts or nodes |
| Right (banner) | Newest real alert, or ALL CLEAR with site and mission |

| Menu item | SELECT does |
|---|---|
| Overview | **hold 2 s** = panic alarm (CRITICAL alert, sirens on every node on audible missions) |
| Alerts | acknowledge the shown alert |
| Nodes | sound that node's siren for 10 s |
| Arming | **hold 1 s** = arm / disarm (a tap only shows the hint, so the site can't be disarmed by accident) |
| Mission | switch to the next mission |
| Siren | silence every node's siren |
| System | refresh |

A progress bar shows while holding; releasing early cancels. Only one action runs at a time
(extra presses show "busy"), and every action reports its result on the middle screen.
After 60 s without input the screens dim to prevent burn-in; any press (which is not acted on)
or a new alert wakes them.

Pixel: green pulse = armed and clear, blinking orange = active alert, solid red = critical,
off = disarmed, dim blue = no server link.

Wiring: UP 26, DOWN 32, LEFT 25, RIGHT 27, SELECT 33, pixel 14; OLED SCL/SDA pairs 22/21,
19/18, 17/16. Serial console (115200): `cfg wifi <ssid> <pass>`, `cfg server <url|auto>`,
`cfg key <panel key>`, `cfg show`, `scan`, `btnscan` (guided button-to-GPIO mapping), `reboot`.

Networking runs on its own FreeRTOS task, and the panel reads the compact
`GET /api/basestation` summary (well under 2 KB), so the keypad never waits on the network.

## Production settings (`server/.env`)

| Variable | Purpose |
|---|---|
| `ACCESS_PIN` | Require an operator PIN for the dashboard and API (signed HttpOnly session cookie). Leave empty only on a private network. |
| `PANEL_KEY` | Lets the base station act when `ACCESS_PIN` is set; set the same value on the panel with `cfg key`. |
| `NODE_API_KEY` | Shared secret sensor nodes send as `X-Node-Key`. |
| `HTTPS_CERT`, `HTTPS_KEY`, `HTTPS_PORT` | HTTPS listener (installable app). |
| `SIM_NODES` | Simulated nodes; set to `0` in production. |
| `DATABASE_URL`, `DATABASE_URL_RO` | TigerData service (read-only role for AI-generated SQL). |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Gemini; `gemini-flash-lite-latest` has the most generous free tier. |
| `GEMINI_SIM_PER_HOUR` | Gemini narrations for simulated alerts per hour (real alerts always narrated). |
| `BASESTATION_SHOW_SIM` | Show simulated items on the OLED panel (default off). |

## Sirens, panic and resilience

- **Silence**: dashboard header (desktop), the alert banner and the Overview emergency bar (phone),
  the panel's Siren screen, or `POST /api/system/silence`. A node's own controls also have Silence.
- **Panic**: hold the red Panic button for 1.5 s (dashboard / phone) or SELECT for 2 s on the
  panel's Overview. Raises a CRITICAL "Panic alarm" (even when disarmed), narrated by Gemini,
  and sounds every node for 30 s unless the mission is silent. `POST /api/system/panic`.
- **Command latency**: a node on USB/mains power checks in every 5 s and keeps WiFi up, so a
  siren or silence lands within seconds; on battery it checks in every 60 s to save power.
- **Server unreachable**: every reply tells the node the site's arming and the mission's siren
  policy. If three uplinks in a row fail and the node itself sees an intrusion or is tampered with
  while armed on an audible mission, it sounds its own siren (at most once a minute) and reports
  how many times it did so when the link returns (event `OFFLINE_ALARM`).
- **Node ring**: a dim breath every 4 s, red when the site is armed, green when disarmed.

`GET /healthz` is a public liveness probe. AI endpoints are rate limited, AI-generated SQL is
restricted to a single read-only `SELECT` over allowlisted tables and runs on a read-only role.

## TigerData

Telemetry and alerts are hypertables; a 1-second continuous aggregate (`telemetry_1s`, refreshed
every 10 s) feeds the activity charts; telemetry chunks are compressed after a day (segmented by
node) and raw rows are dropped after 30 days. Every alert is stored with a SHA-256 hash of its
sensor evidence, its mission label and the mission it was raised under.
