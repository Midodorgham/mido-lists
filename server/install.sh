#!/usr/bin/env bash
# Installs MIDO Server on Ubuntu 22.04/24.04 (or Debian 12).
# Usage on the VPS:
#   curl -fsSL https://raw.githubusercontent.com/Midodorgham/mido-lists/main/server/install.sh | sudo bash
set -euo pipefail
SRC="https://raw.githubusercontent.com/Midodorgham/mido-lists/main/server"
DIR=/opt/mido-server
ENVF=/etc/mido-server.env

[ "$(id -u)" = 0 ] || { echo "شغّله بـ sudo"; exit 1; }
say() { printf '\n\033[1;35m▶ %s\033[0m\n' "$*"; }

say "بيتأكد من Node.js"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

say "بينزّل ملفات السيرفر"
id mido >/dev/null 2>&1 || useradd --system --home "$DIR" --shell /usr/sbin/nologin mido
mkdir -p "$DIR/public" "$DIR/data"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo /nonexistent)"
for f in server.js public/admin.html public/admin.js public/admin.css public/icon.png; do
  if [ -f "$HERE/$f" ]; then cp "$HERE/$f" "$DIR/$f"; else curl -fsSL "$SRC/$f" -o "$DIR/$f"; fi
done
chown -R mido:mido "$DIR"
chmod 700 "$DIR/data"

if [ ! -f "$ENVF" ]; then
  say "اختار باسورد للوحة العملاء (٨ حروف أو أكتر)"
  while :; do
    read -rsp "الباسورد: " P1 </dev/tty; echo
    read -rsp "اكتبه تاني: " P2 </dev/tty; echo
    if [ "${#P1}" -ge 8 ] && [ "$P1" = "$P2" ]; then break; fi
    echo "مش متطابقين أو أقل من ٨، جرّب تاني."
  done
  umask 077
  printf 'ADMIN_PASSWORD=%s\nPORT=80\n' "$P1" > "$ENVF"
  unset P1 P2
fi
chmod 600 "$ENVF"

say "بيشغّل السيرفر كخدمة"
cat > /etc/systemd/system/mido-server.service <<UNIT
[Unit]
Description=MIDO Server
After=network-online.target
Wants=network-online.target

[Service]
User=mido
EnvironmentFile=$ENVF
Environment=DATA_DIR=$DIR/data
ExecStart=/usr/bin/env node $DIR/server.js
Restart=always
RestartSec=3
AmbientCapabilities=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$DIR/data
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable mido-server >/dev/null
systemctl restart mido-server
if command -v ufw >/dev/null && ufw status | grep -q active; then ufw allow 80/tcp >/dev/null; fi
sleep 2

IP="$(curl -fsS4 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
if systemctl is-active --quiet mido-server; then
  say "خلصت ✅"
  echo "لوحة العملاء:   http://$IP/admin"
  echo "عنوان السيرفر للعملاء: http://$IP"
else
  echo "السيرفر ماشتغلش، ابعت ده:"; journalctl -u mido-server -n 30 --no-pager
fi
