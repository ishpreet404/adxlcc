#!/usr/bin/env bash
# Cyber Chaukidaar - Raspberry Pi installer (Raspberry Pi OS Bookworm, 64-bit or 32-bit)
#
#   git clone <repo> ~/cybercc && cd ~/cybercc && bash gateway/install.sh
#
# Installs Node.js 20, builds the dashboard, installs the server as a systemd service
# on port 8787, and (optionally) the BLE gateway service.  Idempotent.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
USER_NAME="${SUDO_USER:-$USER}"

echo "==> Cyber Chaukidaar install from $ROOT (user $USER_NAME)"

if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 18 ]; then
  echo "==> installing Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
sudo apt-get install -y python3-pip python3-venv git

echo "==> server dependencies"
(cd "$ROOT/server" && npm install --omit=dev --no-audit --no-fund)

echo "==> dashboard build"
(cd "$ROOT/dashboard" && npm install --no-audit --no-fund && npm run build)

if [ ! -f "$ROOT/server/.env" ]; then
  cp "$ROOT/server/.env.example" "$ROOT/server/.env"
  echo "==> created server/.env (edit SIM_NODES / thresholds there)"
fi

echo "==> python gateway venv"
python3 -m venv "$ROOT/gateway/.venv"
"$ROOT/gateway/.venv/bin/pip" install --quiet requests bleak || true

echo "==> systemd services"
sed -e "s#__ROOT__#$ROOT#g" -e "s#__USER__#$USER_NAME#g" "$ROOT/gateway/cybercc-server.service" | sudo tee /etc/systemd/system/cybercc-server.service >/dev/null
sed -e "s#__ROOT__#$ROOT#g" -e "s#__USER__#$USER_NAME#g" "$ROOT/gateway/cybercc-ble-gateway.service" | sudo tee /etc/systemd/system/cybercc-ble-gateway.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now cybercc-server
echo "==> server running: http://$(hostname -I | awk '{print $1}'):8787"

read -r -p "Enable the BLE gateway service too? [y/N] " yn || yn=n
if [[ "$yn" =~ ^[Yy]$ ]]; then
  sudo systemctl enable --now cybercc-ble-gateway
  echo "==> BLE gateway enabled"
fi

echo "==> done.  logs: journalctl -u cybercc-server -f"
