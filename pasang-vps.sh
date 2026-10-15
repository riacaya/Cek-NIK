#!/usr/bin/env bash
# pasang-vps.sh — pasang relai Cek-NIK (server.js) di VPS Linux SEBELUM memakainya.
#
# Pakai di VPS:
#   1) taruh folder proyek (scp/clone) lalu:  bash pasang-vps.sh
#   2) ikuti PANDUAN-VPS.md untuk mengubah KPU_RELAY di cloudflare-worker.js
#
# Yang dilakukan: cek Node.js → salin file → buat service systemd → nyalakan → uji.
# Aman dijalankan berulang (idempoten).

set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
SVC=ceknik-relay
PORT="${PORT:-8788}"
HOST="${HOST:-0.0.0.0}"           # VPS harus menerima koneksi dari luar
RELAY_TOKEN="${RELAY_TOKEN:-ceknik-relay-2026}"

echo "Folder : $DIR"
echo "Port   : $PORT   Host: $HOST"
echo

# --- 1) Node.js >= 18 (fetch bawaan) ----------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js belum ada — menginstal (butuh sudo)..."
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -y && sudo apt-get install -y nodejs npm
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y nodejs
  elif command -v yum >/dev/null 2>&1; then
    sudo yum install -y nodejs
  else
    echo "  Package manager tak dikenal — instal Node.js 18+ manual: https://nodejs.org"; exit 1
  fi
fi
V=$(node -v | sed 's/v//' | cut -d. -f1)
echo "Node   : $(node -v)"
if [ "$V" -lt 18 ]; then echo "Butuh Node >= 18 (fetch bawaan). Perbarui lalu jalankan lagi."; exit 1; fi

if [ ! -f "$DIR/server.js" ]; then
  echo "server.js tidak ada di $DIR — jalankan dari folder proyek."; exit 1
fi

# --- 2) service systemd -------------------------------------------------------
echo
echo "Membuat service systemd ($SVC)..."
sudo tee /etc/systemd/system/$SVC.service >/dev/null <<EOF
[Unit]
Description=Cek-NIK relay (server.js) untuk SIPOL KPU + DTSEN
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$DIR
ExecStart=$(command -v node) $DIR/server.js
Restart=always
RestartSec=3
Environment=HOST=$HOST
Environment=PORT=$PORT
Environment=RELAY_TOKEN=$RELAY_TOKEN
# jail: hanya folder proyek yang boleh dibaca
ProtectSystem=full
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now $SVC
sleep 2

# --- 3) uji -------------------------------------------------------------------
echo
echo "Uji lokal:"
if curl -s --max-time 5 "http://127.0.0.1:$PORT/api/health" | grep -q '"ok"'; then
  echo "  /api/health          OK"
else
  echo "  /api/health          GAGAL — cek: sudo journalctl -u $SVC -n 30 --no-pager"
  exit 1
fi
if curl -s --max-time 5 "http://127.0.0.1:$PORT/relay" -X POST -d '{}' | grep -q 'token'; then
  echo "  /relay (tolak tanpa token) OK"
fi

# --- 4) firewall bila ufw aktif ----------------------------------------------
if command -v ufw >/dev/null 2>&1 && sudo ufw status 2>/dev/null | grep -q "Status: active"; then
  echo
  echo "ufw aktif — membuka port $PORT:"
  sudo ufw allow "$PORT/tcp"
fi

IP=$(curl -s --max-time 8 https://api.ipify.org || echo 'IP-KELOLA-MANUAL')
cat <<EOF

SELESAI. Langkah berikut (lihat PANDUAN-VPS.md):
  1) Tes firewall KPU dari VPS ini :  bash uji-relai-vps.sh
  2) Pastikan port $PORT terbuka dari luar :
       curl -s http://$IP:$PORT/api/health
  3) Ubah KPU_RELAY di cloudflare-worker.js menjadi :
       const KPU_RELAY = 'http://$IP:$PORT/relay?t=$RELAY_TOKEN';
     lalu deploy :  npx wrangler deploy cloudflare-worker.js --name divine-fog-0a93 --compatibility-date 2026-10-01
  4) Cek :  curl -s 'https://divine-fog-0a93.riacaya99.workers.dev/api/selftest?nik=3311022506760001'
     Bila semua langkah OK, relai PC (jalankan_relay.bat) boleh dimatikan.

Status : sudo systemctl status $SVC
Log    : sudo journalctl -u $SVC -f
EOF
