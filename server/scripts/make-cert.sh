#!/bin/sh
# Create a private certificate authority + an HTTPS certificate for this machine's LAN address,
# so phones on the same network can open the dashboard over HTTPS and install it as an app
# (browsers only allow service workers / "Install app" in a secure context).
#
#   sh scripts/make-cert.sh            # uses this machine's current LAN IPs
#   sh scripts/make-cert.sh 10.0.0.5   # or name the IPs explicitly
#
# Then: add the printed HTTPS_CERT / HTTPS_KEY lines to server/.env, restart the server,
# install certs/ca.crt on the phone once (instructions printed below), and open https://<ip>:8443
set -eu
cd "$(dirname "$0")/.."
OUT=certs
mkdir -p "$OUT"

IPS="${*:-}"
if [ -z "$IPS" ]; then
  IPS=$( (ipconfig getifaddr en0 2>/dev/null; ipconfig getifaddr en1 2>/dev/null; hostname -I 2>/dev/null) | tr ' ' '\n' | grep -E '^[0-9]+\.' | sort -u | tr '\n' ' ')
fi
HOST=$(hostname -s 2>/dev/null || echo localhost)

SAN="DNS:localhost,DNS:${HOST}.local,IP:127.0.0.1"
for ip in $IPS; do SAN="$SAN,IP:$ip"; done

if [ ! -f "$OUT/ca.key" ]; then
  openssl genrsa -out "$OUT/ca.key" 2048 2>/dev/null
  openssl req -x509 -new -key "$OUT/ca.key" -sha256 -days 825 -subj "/CN=Cyber Chaukidaar Local CA" -out "$OUT/ca.crt"
  echo "created local CA: $OUT/ca.crt"
fi

openssl genrsa -out "$OUT/server.key" 2048 2>/dev/null
openssl req -new -key "$OUT/server.key" -subj "/CN=${HOST}.local" -out "$OUT/server.csr"
cat > "$OUT/ext.cnf" <<EOF
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=$SAN
EOF
openssl x509 -req -in "$OUT/server.csr" -CA "$OUT/ca.crt" -CAkey "$OUT/ca.key" -CAcreateserial \
  -out "$OUT/server.crt" -days 825 -sha256 -extfile "$OUT/ext.cnf" 2>/dev/null
rm -f "$OUT/server.csr" "$OUT/ext.cnf"
chmod 600 "$OUT"/*.key

echo ""
echo "certificate for: $SAN"
echo ""
echo "Add to server/.env:"
echo "  HTTPS_CERT=$(pwd)/$OUT/server.crt"
echo "  HTTPS_KEY=$(pwd)/$OUT/server.key"
echo "  HTTPS_PORT=8443"
echo ""
echo "Trust the CA on the phone once (send $OUT/ca.crt to it, e.g. AirDrop / email):"
echo "  iPhone : open it > Settings > Profile Downloaded > Install, then"
echo "           Settings > General > About > Certificate Trust Settings > enable 'Cyber Chaukidaar Local CA'"
echo "  Android: Settings > Security > Encryption & credentials > Install a certificate > CA certificate"
echo ""
echo "Then open https://<laptop-ip>:8443 and use 'Install app' / 'Add to Home Screen'."
