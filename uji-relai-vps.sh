#!/usr/bin/env bash
# uji-relai-vps.sh — jalankan di VPS/mesin CALON RELAI (bukan di PC) untuk mengetes
# apakah IP mesin itu diterima firewall KPU & Kemensos SEBELUM membayar/sebelum dipakai.
#
# Pakai :  bash uji-relai-vps.sh
# Hasil :  LAYAK  = IP ini diterima → boleh dipasang server.js (/relay + /api/bansos/*)
#                   sebagai relai 24 jam untuk worker blog (SIPOL + DTSEN).
#          TIDAK  = IP diblokir (timeout/403) → jangan sewa mesin ini.
#
# Data contoh = NIK publik contoh (pejabat parpol); ganti bila perlu.

NIK="${1:-3311022506760001}"
KPU_HOME="https://infopemilu.kpu.go.id/"
KPU_POST="https://infopemilu.kpu.go.id/Pemilu/Cari_nik_parpol/getDataFromAjx"
BANSOS="https://cekbansos.kemensos.go.id"
REFERER="https://infopemilu.kpu.go.id/Pemilu/Cari_nik"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

echo "IP publik mesin ini: $(curl -s --max-time 8 https://api.ipify.org || echo '(gagal)')"
echo

# 1) GET halaman utama KPU — harus 200/302 dalam beberapa detik (bukan timeout)
echo -n "1) GET $KPU_HOME ... "
code=$(curl -s -o /dev/null --max-time 15 -A "$UA" -w '%{http_code}' "$KPU_HOME" 2>/dev/null)
if [ "$code" = "200" ] || [ "$code" = "302" ]; then
  echo "OK (HTTP $code)"
  step1=ok
else
  echo "GAGAL (HTTP ${code:-000}) — kemungkinan IP diblokir firewall KPU"
  step1=gagal
fi

# 2) POST endpoint SIPOL — harus membalas daftar JSON
echo -n "2) POST getDataFromAjx (NIK $NIK) ... "
body=$(curl -s --max-time 15 -A "$UA" -X POST "$KPU_POST" \
  -H 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8' \
  -H "Referer: $REFERER" \
  -H 'X-Requested-With: XMLHttpRequest' \
  --data "input_ajx=$NIK" 2>/dev/null | head -c 400)
case "$body" in
  \[*)
    echo "OK — balasan: $(echo "$body" | head -c 160)"
    step2=ok ;;
  *)
    echo "GAGAL — balasan: ${body:-'(kosong/timeout)'}"
    step2=gagal ;;
esac

# 3) cekbansos (DTSEN) — halaman utama + cookie; IP datacenter sering diblokir juga di sini
echo -n "3) GET $BANSOS/ ... "
hdrs=$(curl -s -D - -o /dev/null --max-time 15 -A "$UA" "$BANSOS/" 2>/dev/null)
bcode=$(echo "$hdrs" | head -1 | awk '{print $2}')
cookie=$(echo "$hdrs" | grep -i '^set-cookie' | head -1)
if [ "$bcode" = "200" ] && [ -n "$cookie" ]; then
  echo "OK (HTTP $bcode + cookie diterima)"
  step3=ok
else
  echo "GAGAL (HTTP ${bcode:-000}${cookie:+ }) — ${cookie:-tanpa cookie/kemungkinan diblokir}"
  step3=gagal
fi

echo
gagal=0
[ "$step1" = ok ] || gagal=$((gagal+1))
[ "$step2" = ok ] || gagal=$((gagal+1))
[ "$step3" = ok ] || gagal=$((gagal+1))

if [ "$gagal" -eq 0 ]; then
  echo "VERDIKSI: LAYAK — IP mesin ini diterima KPU & Kemensos (SIPOL + DTSEN siap)."
  echo "  Langkah berikutnya: pasang server.js di mesin ini (lihat PANDUAN-VPS.md),"
  echo "  lalu isi KPU_RELAY di cloudflare-worker.js dengan URL-nya dan deploy ulang."
  exit 0
else
  echo "VERDIKSI: TIDAK LAYAK — $gagal dari 3 tes gagal; jangan sewa/pakai mesin ini."
  echo "  (Pola yang terlihat: IP datacenter besar — Cloudflare, Google, GitHub/Azure,"
  echo "   Alibaba, Oracle, Akamai — ditolak; IP residensial bersih seperti PC rumahan diterima.)"
  exit 1
fi
