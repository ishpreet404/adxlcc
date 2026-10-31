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
| Left (menu) | Overview · Alerts · Nodes · Arming · Mission · System (UP/DOWN) |
| Middle (detail) | The highlighted item; LEFT/RIGHT pages through alerts or nodes |
| Right (banner) | Newest real alert, or ALL CLEAR with site and mission |

SELECT: acknowledge the shown alert · sound the shown node's siren · arm/disarm · next mission.
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

`GET /healthz` is a public liveness probe. AI endpoints are rate limited, AI-generated SQL is
restricted to a single read-only `SELECT` over allowlisted tables and runs on a read-only role.

## TigerData

Telemetry and alerts are hypertables; a 1-second continuous aggregate (`telemetry_1s`, refreshed
every 10 s) feeds the activity charts; telemetry chunks are compressed after a day (segmented by
node) and raw rows are dropped after 30 days. Every alert is stored with a SHA-256 hash of its
sensor evidence, its mission label and the mission it was raised under.
