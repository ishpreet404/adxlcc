#!/usr/bin/env bash
# Cyber Chaukidaar - turn the Raspberry Pi's WiFi into the sentry network (access point).
#
#   bash gateway/hotspot.sh                 # create/enable the hotspot (SSID CyberChaukidaar)
#   bash gateway/hotspot.sh --ssid X --pass Y --country IN
#   bash gateway/hotspot.sh --status
#   bash gateway/hotspot.sh --off           # remove the hotspot, wlan0 back to normal
#
# The Pi keeps using its Ethernet cable (eth0) for the LAN / internet; wlan0 becomes a
# 2.4 GHz WPA2 access point at 192.168.4.1 with DHCP + NAT, so nodes can even reach the
# internet through the Pi if needed.  Requires Raspberry Pi OS Bookworm (NetworkManager).
set -euo pipefail

SSID="CyberChaukidaar"
PASS="SentryGrid2026"
COUNTRY="IN"
CHANNEL="6"
CON="sentry-ap"
IFACE="wlan0"
ADDR="192.168.4.1/24"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ssid) SSID="$2"; shift 2;;
    --pass) PASS="$2"; shift 2;;
    --country) COUNTRY="$2"; shift 2;;
    --channel) CHANNEL="$2"; shift 2;;
    --iface) IFACE="$2"; shift 2;;
    --status)
      nmcli -f NAME,TYPE,DEVICE,STATE con show --active || true
      echo "--- addresses:"; hostname -I
      echo "--- clients on the hotspot:"; ip neigh show dev "$IFACE" 2>/dev/null || true
      exit 0;;
    --off)
      sudo nmcli con down "$CON" 2>/dev/null || true
      sudo nmcli con delete "$CON" 2>/dev/null || true
      echo "hotspot removed"; exit 0;;
    *) echo "unknown option $1"; exit 1;;
  esac
done

if [[ ${#PASS} -lt 8 ]]; then echo "password must be at least 8 characters"; exit 1; fi
if ! command -v nmcli >/dev/null; then echo "nmcli not found - this script needs Raspberry Pi OS Bookworm (NetworkManager)"; exit 1; fi

echo "==> WiFi country $COUNTRY, unblocking radio"
sudo raspi-config nonint do_wifi_country "$COUNTRY" 2>/dev/null || sudo iw reg set "$COUNTRY" || true
sudo rfkill unblock wifi || true

echo "==> (re)creating hotspot '$SSID' on $IFACE at ${ADDR%/*}"
sudo nmcli con delete "$CON" 2>/dev/null || true
sudo nmcli con add type wifi ifname "$IFACE" con-name "$CON" autoconnect yes ssid "$SSID" >/dev/null
sudo nmcli con modify "$CON" \
  802-11-wireless.mode ap 802-11-wireless.band bg 802-11-wireless.channel "$CHANNEL" \
  ipv4.method shared ipv4.addresses "$ADDR" ipv6.method disabled \
  wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$PASS" wifi-sec.proto rsn wifi-sec.pairwise ccmp wifi-sec.group ccmp \
  802-11-wireless-security.pmf 1 \
  connection.autoconnect-priority 50
sudo nmcli con up "$CON" >/dev/null

echo "==> hotspot up"
nmcli -f NAME,TYPE,DEVICE,STATE con show --active | grep -E "NAME|$CON" || true
echo
echo "  SSID:      $SSID"
echo "  password:  $PASS"
echo "  Pi on AP:  ${ADDR%/*}   (nodes discover the server automatically)"
echo "  Pi on LAN: $(hostname -I | awk '{print $1}')   (open http://<that-ip>:8787 from a laptop on the LAN)"
echo
echo "The hotspot comes back automatically after reboot.  Flash nodes with the same SSID/password"
echo "(firmware defaults) or set them over serial: cfg wifi $SSID $PASS"
