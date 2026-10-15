# PANDUAN VPS — relai Cek-NIK 24 jam tanpa PC

Tujuan: SIPOL (KPU) & DTSEN (Kemensos) tetap jalan walau PC mati.
Arsitektur: **blog → worker Cloudflare → VPS ini → KPU/Kemensos**.

Kenapa VPS: firewall KPU & Kemensos memblokir hampir semua IP cloud besar
(Terbukti: Cloudflare, Google, GitHub/Azure semuanya timeout). Jadi VPS **wajib
diuji dulu** sebelum dibayar — IP datacenter kecil/provider lokal biasanya lolos.

---

## Langkah 1 — Uji IP sebelum bayar

Di mesin calon VPS (trial/bulan pertama/money-back):

```bash
bash uji-relai-vps.sh
```

- `VERDIKSI: LAYAK` → lanjut langkah 2.
- `TIDAK LAYAK` → jangan pakai mesin itu. Coba provider lain
  (provider lokal Indonesia — IDCloudHost, Domainesia, Dewaweb, Niagahoster —
  biasanya IP-nya lebih diterima daripada provider luar).

## Langkah 2 — Pasang relay di VPS

Salin folder proyek ke VPS, lalu:

```bash
bash pasang-vps.sh
```

Script itu memasang Node.js bila belum ada, membuat service systemd
(`ceknik-relay`, auto-restart bila crash), membuka firewall, dan menguji.

## Langkah 3 — Uji dari luar

```bash
curl -s http://IP-VPS:8788/api/health        # harus {"ok":true...}
curl -s http://IP-VPS:8788/relay -X POST -d '{}'   # harus "token relai salah" (artinya endpoint terbuka & terjaga)
```

Semua endpoint `/api/*` dan `/relay` di VPS **wajib token** `?t=ceknik-relay-2026`
(karena IP VPS bukan localhost). Hanya `/api/health` yang terbuka.

## Langkah 4 — Arahkan worker ke VPS

Di `cloudflare-worker.js`, ubah SATU baris:

```js
const KPU_RELAY = 'http://IP-VPS:8788/relay?t=ceknik-relay-2026';
```

(Ditarik otomatis: `RELAY_BASE` & `RELAY_TOKEN` untuk endpoint DTSEN ikut berubah.)

Deploy ulang:

```bash
npx wrangler deploy cloudflare-worker.js --name divine-fog-0a93 --compatibility-date 2026-10-01
```

## Langkah 5 — Verifikasi end-to-end

```bash
curl -s 'https://divine-fog-0a93.riacaya99.workers.dev/api/selftest?nik=3311022506760001'
curl -s 'https://divine-fog-0a93.riacaya99.workers.dev/api/check?nik=3311022506760001'
```

Selftest harus `ok: true` untuk semua langkah, `jalur=relai`.
Bila lolos, **relai PC (`jalankan_relay.bat`) boleh dimatikan**.

Kembalikan ke relai PC kapan pun: isi lagi
`KPU_RELAY = 'https://ceknik-relay-3311.loca.lt/relay?t=ceknik-relay-2026'`
lalu deploy ulang.

---

## Keamanan

- Token relay jangan dibagikan (ganti: env `RELAY_TOKEN` di VPS + `?t=` di worker).
- `/relay` hanya meneruskan ke host `*.kpu.go.id` — tidak jadi proxy sembarangan.
- Service systemd sudah dijail ringan (`ProtectSystem=full`, `NoNewPrivileges`).
- Port 8788 dibuka hanya untuk IP mana pun — pertimbangkan `ufw limit 8788/tcp`
  bila ingin membatasi, tapi worker Cloudflare bisa pakai IP keluar apa pun.

## Operasional

| Perintah | Fungsi |
|---|---|
| `sudo systemctl status ceknik-relay` | cek status |
| `sudo journalctl -u ceknik-relay -f` | log langsung |
| `sudo systemctl restart ceknik-relay` | mulai ulang |

Catatan biaya: VPS 1 vCPU / 512 MB–1 GB RAM sudah lebih dari cukup
(`server.js` tanpa dependensi). Ukuran kecil biasanya Rp 30–100 rb/bulan.

## Troubleshooting

- **Selftest bilang relai gagal** → `curl -s http://IP-VPS:8788/api/health`
  dari mana pun; kalau dari VPS sendiri bisa tapi dari luar tidak = firewall/Security Group port 8788 belum dibuka.
- **`TIDAK LAYAK` di uji IP** → IP VPS diblokir KPU/Kemensos; ganti provider.
- **DTSEN captcha gagal** → cek `sudo journalctl -u ceknik-relay -n 50`;
  kemungkinan besar IP VPS diblokir cekbansos (tes ada di langkah 1 butir 3).
