# Cek-NIK

Halaman cek NIK: **SIPOL KPU** — **DTSEN Kemensos** — validasi rumus lokal.

Disajikan lewat GitHub Pages: https://riacaya.github.io/Cek-NIK/

## Struktur

| Path | Fungsi |
|---|---|
| `github/` | Halaman web yang dideploy ke GitHub Pages (`index.html` + `assets/`) |
| `.github/workflows/pages.yml` | Deploy otomatis ke GitHub Pages setiap push ke `main` |
| `android-app/` | APK Android (lokal saja, tidak ikut repo) |
| `modal/` | Arsip file lama (lokal saja, tidak ikut repo) |
| `relay/` | Relai KPU/Kemensos untuk SIPOL & DTSEN (lokal saja, tidak ikut repo) |

## Isi `github/`

- `index.html` — halaman cek NIK **mode ganda**:
  - **GitHub Pages** (dibuka di `riacaya.github.io/Cek-NIK/`) tampil sebagai halaman penuh.
  - **Blog/Blogger** — tempel **seluruh isi file** ke pos (mode HTML). Deteksi otomatis membuatnya jadi widget terkurung di `<div id="cn-page">`, jadi CSS-nya tidak merusak tema blog, dan aset wilayah diambil dari URL absolut Pages (GitHub Pages mengirim `Access-Control-Allow-Origin: *`).
  - `API_URL` diarahkan ke worker Cloudflare (`divine-fog-0a93`).
  - Uji mode widget dari komputer: buka `index.html?widget=1`.
- `assets/` — `pro.json`, `kab/`, `kec.json` (data wilayah), `logo.png`.

## Perubahan halaman

Edit file di `github/`, lalu commit dan push ke `main`. Workflow `Deploy GitHub Pages` berjalan otomatis dan situs ter-update dalam ±1 menit.

## Relai SIPOL & DTSEN

GitHub Pages dan worker Cloudflare tidak bisa menjangkau `infopemilu.kpu.go.id` / `cekbansos.kemensos.go.id` (firewall mereka menolak IP cloud), jadi dua fitur itu lewat relai di PC ini:

- Jalankan `relay\jalankan_relay.bat` (jendela terminal harus tetap terbuka). Script menyalakan `server.js` (port 8788) + tunnel `https://ceknik-relay-3311.loca.lt`, dan menghidupkan ulang otomatis bila mati.
- Selama relai mati, halaman tetap jalan tetapi SIPOL & DTSEN menampilkan galat.
- Berkas relai sengaja tidak ikut repo (`relay/` di `.gitignore`); sumber lamanya ada di riwayat git.

### Kenapa relai tidak bisa dijalankan di GitHub Actions

Sudah diuji (15 Okt 2026, IP runner `20.169.60.131` / Azure): semua permintaan ke
`infopemilu.kpu.go.id` dan `cekbansos.kemensos.go.id` *connection timed out* (HTTP 000),
sedangkan situs kontrol luar bisa dibuka. Artinya firewall KPU & Kemensos memblokir IP cloud
(sama seperti IP Cloudflare yang dipakai worker), jadi walau `localtunnel`/`lt` bisa dijalankan
di Actions, relainya tidak akan pernah sampai ke KPU. Relai harus berada di IP yang diterima
mereka — PC ini, atau VPS yang IP-nya sudah diuji dulu sebelum disewa.
