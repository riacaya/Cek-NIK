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

## Isi `github/`

- `index.html` — halaman cek NIK. `API_URL` diarahkan ke worker Cloudflare (`divine-fog-0a93`), path aset dibuat relatif agar cocok di `riacaya.github.io/Cek-NIK/`.
- `assets/` — `pro.json`, `kab.json`, `kec.json` (data wilayah), `logo.png`.

## Perubahan halaman

Edit file di `github/`, lalu commit dan push ke `main`. Workflow `Deploy GitHub Pages` berjalan otomatis dan situs ter-update dalam ±1 menit.
