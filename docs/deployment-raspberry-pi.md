# Raspberry Pi deployment

## One-shot install

```bash
sudo apt-get update && sudo apt-get install -y git
git clone <your-repo-url> ~/cybercc
cd ~/cybercc && bash gateway/install.sh
```

The script installs Node.js 20, builds the dashboard, writes `server/.env`, installs and starts `cybercc-server.service` (port 8787, auto-restart, starts on boot) and optionally `cybercc-ble-gateway.service`.

Dashboard: `http://<pi-ip>:8787`. Logs: `journalctl -u cybercc-server -f`.

## Networking options

| Link | Setup |
|---|---|
| **Pi hotspot (recommended)** | The Pi keeps its Ethernet cable for the LAN and turns its own WiFi into the sentry network: `bash gateway/hotspot.sh` (SSID `CyberChaukidaar`, password `SentryGrid2026`, Pi at 192.168.4.1, survives reboots). Nodes use these credentials by default and discover the server automatically, so nothing depends on the venue's WiFi or DHCP. Open the dashboard from a laptop on the LAN at `http://<pi-lan-ip>:8787`, or join the hotspot and use `http://192.168.4.1:8787`. `bash gateway/hotspot.sh --status` shows connected nodes; `--off` removes it. |
| **Venue WiFi** | Nodes join your WiFi and POST straight to the Pi. Give the Pi a static IP / DHCP reservation; put that in the nodes with `cfg server http://<ip>:8787`. For a field site with no router, make the Pi an access point (`sudo nmcli dev wifi hotspot ifname wlan0 ssid CyberChaukidaar password SentryGrid2026`); the firmware defaults match this SSID and `http://192.168.4.1:8787`… adjust to the hotspot's IP (`hostname -I`). |
| **BLE** | Flash nodes with `-e ble`; enable `cybercc-ble-gateway.service`. Range ~20–40 m open air. |
| **LoRa** | SX127x HAT on SPI0 + `gateway/lora_gateway.py` (`pip install pyLoRa spidev RPi.GPIO`). Frequency/sync word must match `config.h`. Range kilometres, but packets are 40-byte summaries (no waveforms). |

## Configuration (`server/.env`)

```
PORT=8787
SIM_NODES=0            # set 0 in the field; 2 for demos
SITE_WIDTH=40          # metres
SITE_HEIGHT=30
ALERT_THRESHOLD=0.70
CRITICAL_THRESHOLD=0.88
NODE_API_KEY=          # optional shared secret for nodes
LEAKOSINT_API_KEY=     # optional, breach checker upstream
TELEGRAM_BOT_TOKEN=    # optional, alerts to Telegram (see below)
```

### Telegram alerts

1. In Telegram, talk to **@BotFather**, `/newbot`, and copy the token.
2. Put it in `server/.env` as `TELEGRAM_BOT_TOKEN=...` and `sudo systemctl restart cybercc-server` (or paste it in **Setup > Notifications** on the dashboard, no restart needed).
3. Open your bot in Telegram and press **Start** (for a group: add the bot to the group and send any message).
4. Dashboard **Setup > Notifications > FIND CHATS**, then **TEST**. The server discovers the chat id itself and stores it in `server/data/notify.json`; every alert now goes to that chat. `TELEGRAM_CHAT_ID` in `.env` is only needed to force specific chat ids.

If TEST fails, the reason (token rejected, no chat yet, blocked bot, no internet on the Pi) is shown under *Recent deliveries*.

Persistent data lives in `server/data/` (site layout, alerts and events as NDJSON) and recorded ML windows in `ml/data/`.

## Updating

```bash
cd ~/cybercc && git pull && (cd dashboard && npm run build) && sudo systemctl restart cybercc-server
```

## Running the server on a laptop instead

Everything is plain Node.js; `npm start` from the repo root does the same thing on Windows/macOS/Linux. Point the nodes at the laptop's IP.
