# endpointnik.md — Daftar Lengkap Endpoint Hasil Penelusuran API Cek NIK

**Tanggal uji:** 1 Oktober 2026, ±12:41–13:05 UTC (19:41–20:05 WIB)
**Metode:** `curl` langsung dari mesin lokal (Git Bash/Windows), tanpa autentikasi kecuali disebutkan.
**NIK uji:** `3301012501900001` (fiktif, struktural-valid: 33 = Jawa Tengah, 33.01.01 = Kedungreja/Cilacap, lahir 25-01-1990 laki-laki, serial 0001) dan `6403012501900001` (untuk uji endpoint Berau). Semua pengujian memakai NIK fiktif.

**Legenda status:**

- 🟢 **HIDUP** — merespons normal sesuai harapan.
- 🟡 **SETENGAH HIDUP** — hidup tapi terkunci: butuh API key / OTP / login / tanpa CORS / cakupan terbatas.
- 🔴 **MATI** — DNS tidak ada (NXDOMAIN), timeout/tidak terjangkau, 404, atau layanan sudah berhenti.

**Syarat layak untuk halaman statis `cek_nik.html` (dipanggil langsung dari browser):**

1. Merespons dengan data nyata.
2. Tanpa kredensial yang harus ditanam di klien (API key di JavaScript = publik).
3. Mengirim header `Access-Control-Allow-Origin` (CORS) — tanpa ini browser memblokir pembacaan respons.
4. Mengembalikan **nama** pemilik NIK (bukan sekadar parse format).

**Hasil utama penelusuran:** tidak ada satu pun endpoint yang memenuhi keempat syarat di atas. Satu-satunya 🟢 yang bisa dipanggil dari browser (nusakit) tidak punya field nama; satu-satunya yang punya nama tanpa kunci (KPU SIPOL) tidak punya CORS.

---

## 1. Endpoint NIK / identitas penduduk

### 1.1 nusakit.my.id — dipakai saat ini 🟢

Landing page `GET https://nusakit.my.id/` → 200 (berisi daftar fitur + tautan github `muhfauziazhar/nusakit-api` dan `cahyadsn/wilayah`). Spesifikasi lengkap di `GET https://nusakit.my.id/openapi.json` → 200 (OpenAPI 3.1.0, judul "Nusakit API"). `GET /health` → 200.

- **`GET https://nusakit.my.id/v1/nik/validate?nik=<16 digit>`** 🟢 — **endpoint utama di cek_nik.html**.
  - HTTP 200, CORS `Access-Control-Allow-Origin: *`, rate-limit `X-RateLimit-Limit: 120` per menit.
  - Contoh respons (diuji):
    ```json
    {"success":true,"data":{"valid":true,"info":{"nik":"3301012501900001","provinceCode":"33","province":"Jawa Tengah","regencyCode":"01","districtCode":"01","birthDateISO":"1990-01-25","gender":"L","age":36,"serial":"0001"}},"meta":{"timestamp":"2026-10-01T12:47:47.509Z","version":"1.0.0"}}
    ```
  - **Parse struktural murni** (kode wilayah + tanggal lahir dari digit NIK). **Tidak ada field nama sama sekali** — tidak akan pernah menghasilkan "nama…bintang".
- **`GET https://nusakit.my.id/v1/wilayah/lookup/{prov}.{kab}.{kec}`** 🟢 — 200, CORS `*`.
  - Contoh: `/v1/wilayah/lookup/33.01.01` → `{"success":true,"data":{"province":{"code":"33","name":"Jawa Tengah"},"regency":{"code":"33.01","name":"Kabupaten Cilacap"},"district":{"code":"33.01.01","name":"Kedungreja"}}}`.
- Seluruh path lain di `openapi.json` (semua 🟢, teruji hidup sebagai API format; **bukan** lookup identitas):
  `/v1/bank`, `/v1/bank/validate-account`, `/v1/bank/{code}`, `/v1/dummy/nik`, `/v1/dummy/npwp`, `/v1/dummy/phone`, `/v1/kodepos/{postalCode}`, `/v1/kodepos/wilayah/{code}`, `/v1/npwp/format`, `/v1/npwp/validate`, `/v1/phone/operator`, `/v1/phone/validate`, `/v1/qris/convert`, `/v1/qris/parse`, `/v1/rupiah/format`, `/v1/rupiah/parse`, `/v1/rupiah/terbilang`, `/v1/wilayah/provinces`, `/v1/wilayah/provinces/{code}`, `/v1/wilayah/regencies/{provinceCode}`, `/v1/wilayah/districts/{regencyCode}`, `/v1/wilayah/villages/{districtCode}`, `/v1/wilayah/search`.
  - `/v1/dummy/nik` hanya **generator** NIK fiktif, bukan validasi data kependudukan.
- Path dokumentasi yang dicoba dan **404** (🔴, JSON `{"success":false,"error":"Not Found"}`): `/docs`, `/v1`, `/api`, `/swagger`, `/v1/docs`.

### 1.2 KPU — infopemilu.kpu.go.id (Cari NIK / SIPOL parpol) 🟡

- **Halaman:** `GET https://infopemilu.kpu.go.id/Pemilu/Cari_nik` → 200 (berisi form pencarian; memuat skrip Cloudflare Turnstile tapi request AJAX-nya **tidak** mengirim token).
- **`POST https://infopemilu.kpu.go.id/Pemilu/Cari_nik_parpol/getDataFromAjx`** (form-urlencoded, field **`input_ajx=<nik>`**) 🟡
  - **HIDUP tanpa key dan tanpa captcha** — diuji: NIK fiktif → `[]` (200). Halaman KPU sendiri me-render field: `nik`, `nama`, `nama_parpol`, `jabatan`, `unit`, `tingkat_wilayah_kepengurusan`, `nama_wilayah` (daftar, bisa >1 data per NIK).
  - **GET ditolak** — `GET ...?input_ajx=3301012501900001` → `{"error":"NIK harus 16 digit angka."}` (parameter tidak pernah dibaca; semua variasi nama param sama) → **wajib POST**, sehingga tidak bisa di-proxy lewat proxy CORS berbasis GET.
  - **Tanpa header CORS sama sekali** (sudah diuji dengan `Origin` + preflight OPTIONS) → browser tidak bisa membaca respons silang-origon. **Ini penghalang utama.**
  - Data = **pengurus/anggota partai politik (SIPOL) saja**, bukan seluruh penduduk — NIK orang biasa biasanya `[]`.
  - Path saudara yang dicoba, semuanya **404** (halaman maintenance CodeIgniter): `/Pemilu/Cari_nik/getDataFromAjx`, `/Pemilu/Cari_dpt/getDataFromAjx`, `/Pemilu/Cari_nik_dpt/getDataFromAjx`, `/Pemilu/Cari_nik_dps/getDataFromAjx`, `/Pemilu/Cari_nik_parpol/getDataFromAjx2`.
- **`https://infopemilu.kpu.go.id/`** 🟢 → 200. Halaman beranda; tautan ke layanan KPU (lihat bagian5).

### 1.3 KPU — cekdptonline.kpu.go.id (DPT resmi) 🟡

- `GET https://cekdptonline.kpu.go.id/` 🟡 → 200 (SPA Vue; chunk `assets/js/index.23d2b81d.js`).
- Alur resminya: NIK + **nomor WhatsApp + kode OTP** (dikonfirmasi panduan resmi KPU/kabupaten) → **tidak bisa diotomasi** tanpa OTP milik pengguna.
- Konstanta backend di JS-nya:
  - `https://lindungiapi.kpu.go.id/auth` 🔴 → **000, tidak terjangkau** dari jaringan uji.
  - `https://lindungiapi.kpu.go.id/graphql` 🔴 → sama, tidak terjangkau.
  - `https://api.coloredstrategies.com` 🔴 — hanya sisa template React demo (bukan API KPU).
- Route SPA-nya (`auth-login`, `auth-register`, `twofactorauthentication`, `advanced-search`, `data-pemilih`, `data-pemilih-browse`, `data-pemilih-import`, `lappemilih`, `rekapitulasi-pemilih`) semuanya **di balik login + 2FA**.

### 1.4 KPU — endpoint lama resultDps (era pilkada 2017/2018) 🔴

Ditemukan dari repo `namtxs/cek-nik` (PHP):

- `GET https://pilkada2017.kpu.go.id/pemilih/dpt/1/hasil-cari/resultDps.json?nik=<nik>&nama=&namaPropinsi=&namaKabKota=&namaKecamatan=&namaKelurahan=` 🔴 → **000, koneksi gagal** (host lama sudah tidak melayani).
- `GET https://infopemilu.kpu.go.id/pilkada2018/pemilih/dpt/1/hasil-cari/resultDps.json?nik=...` 🔴 → **404** (maintenance page).
- Format respons zaman dulu (dari README repo, tidak lagi terverifikasi): `{"aaData":[{"nik":"327104650493****","nama":"NAMA ...", ...}]}` — NIK di-mask bintang, ini gaya "bintang" yang paling mirip ekspektasi "nama…tutup bintang", tapi layanannya sudah mati.

### 1.5 api.mychaelgo.com (endpoint lama di APK Cek KTP 2.0) 🔴

- `GET https://api.mychaelgo.com/ktp?nik=<nik>` 🔴 → **NXDOMAIN** (`*** can't find api.mychaelgo.com: Non-existent domain`). Alamat ini tertulis di dalam APK `apk/Cek+KTP_2.0_APKPure.apk` (`resources.arsc`) — sudah dipindai, tidak ada endpoint lain di dalam APK selain ini.
- Dokumentasinya `GET https://mychaelgoapi.docs.apiary.io/reference/ktp/ktp-collection/get-ktp-collection` 🟡 → 200 (shell JS; pernah 502 sesaat). Tercatat: `GET https://api.mychaelgo.com/ktp?nik=` dengan sampel `{"nik":"3506145512790002","nama":"KALIMAH","jenis_kelamin":"PEREMPUAN","kelurahan":"JAMBANGAN","kecamatan":"PAPAR", ...}` — sumber data "KPU". API-nya sendiri sudah mati.
- `GET https://mychaelgo.com/` 🟢 → 200, tapi hanya **situs portofolio pribadi** (template Mobirise), bukan API.

### 1.6 api.kaltimprov.go.id — Penduduk by NIK (Berau) 🟡

- **`GET https://api.kaltimprov.go.id/api/generate/berau/disdukcapil/penduduk-by-nik?nik=<nik>`** → **302** tanpa kunci.
  - Wajib header `Authorization: Bearer <API key>` (registrasi di portal mereka). Dokumentasi hidup: `https://api.kaltimprov.go.id/dokumentasi/berau/disdukcapil/...`; ada juga varian `/dokumentasi/balikpapan`.
  - **Data penduduk asli** (nama, dll.), tapi **hanya untuk NIK warga Berau** — tidak berguna untuk NIK umum, plus key akan bocor kalau ditanam di halaman statis.
  - **Pendalaman 2 Okt 2026 → lihat §8.5** (gateway ini mengagregasi disdukcapil banyak kab/kota Kaltim; model akses tertutup penuh, registrasi tidak swalayan).

### 1.7 SIMPUS Tangerang Selatan 🔴

- `POST https://simpus.tangerangselatankota.go.id:8000/v3/v1/nik` (form-urlencoded; ditemukan di Postman workspace publik) 🔴 → **000, timeout** — host/port tidak terjangkau dari jaringan uji; root-nya pun 000.

### 1.8 Dukcapil Kemendagri (kanal resmi) 🔴 untuk API

- `GET https://dukcapil.kemendagri.go.id/` 🔴 → **000, tidak terjangkau** dari jaringan uji (juga `/ceknik`, `/api/nik`).
- `GET https://ceknik.kemendagri.go.id/` 🔴 → 000.
- Tidak ditemukan API publik JSON apa pun di situs resmi (situsnya sendiri tidak merespons).

### 1.9 nik.zakiego.com — NIK Reader 🟡

- `GET https://nik.zakego.com/` 🟢 → 200 (Next.js). **Parse lokal di browser** saja (provinsi/kab/kecamatan/gender/tanggal lahir dari digit) — tidak ada lookup nama.
- Tebakan endpoint `GET https://nik.zakiego.com/api/nik/<nik>` 🔴 → 404 (tidak ada API).

### 1.10 API komersial / ber-key (ditemukan via pencarian, belum tentu bisa dipakai) 🟡

- `https://docs.apiindonesia.id` 🟢 (200) — API Indonesia; pakai header `x-api-key`, ada tier gratis. Dari halamannya sendiri: validasi NIK **"tanpa lookup ke database"**, **"Bukan verifikasi Dukcapil"** → parse format saja. **(live 2 Okt 2026 → §12.1)**
- `https://nusantara.clowdlab.com/docs` 🟢 (200) — Nusantara API; disebut "parsing NIK, kode pos", tanpa key (`false` di daftar API lokal) → parse saja, bukan lookup identitas.
- `https://docs.glair.ai/identity-verification` 🟡 → 307 ke `/vision/identity-verification`; layanan KYC berbayar, verifikasi NIK vs Dukcapil butuh akun/kontrak. Ada juga `docs.glair.ai/vision/ktp` (OCR KTP). **(live 2 Okt 2026 → §12.2: `api.glair.ai` 403; verifikasi = boolean match, bukan lookup nama)**
- `https://docs.iluma.ai/id/` 🟢 (200) — Iluma, `api.iluma.ai/v1.2/identity/...`, validasi identitas berbayar + API key.
- **RapidAPI "NIK Checker"** (ditemukan via toolify.ai) 🟡 — butuh akun & key RapidAPI; key tidak boleh ditanam di halaman statis.
- `https://aksarakan.com/document/ktp/api` (dari hasil pencarian) 🟡 — API **OCR KTP** (foto → teks), bukan lookup NIK.
- `https://parse.bot/marketplace/.../dukcapil-kemendagri-go-id-api` (dari hasil pencarian) — hanya ekstraksi **artikel blog** Dukcapil, bukan data NIK.

### 1.11 Domain KPU/Lain yang dicek tapi bukan API NIK

| URL | Status | Keterangan |
|---|---|---|
| `https://sipol.kpu.go.id/` | 🟡 200 | Login Keycloak KPU/parpol + reCAPTCHA; tidak ada API publik. |
| `https://sipelihatan.kpu.go.id/` | 🔴 000 | Tidak terjangkau. |
| `https://ppid.kpu.go.id/` | 🟢 200 | Portal dokumen (bukan NIK). |
| `https://api.kpu.go.id/` | 🔴 000 | Tidak ada. |
| `https://datapemilu.kpu.go.id/` | 🔴 000 | Tidak terjangkau dari jaringan uji (punya tautan dataset pemilu). |
| `https://uji-pemilu2024.kpu.go.id/`, `https://uji-pilkada2024.kpu.go.id/` | tidak diuji | Tautan dari halaman infopemilu (uji publik, bukan API NIK). |
| `https://pilkada2015.kpu.go.id/`, `https://pilkada2020.kpu.go.id/` | tidak diuji | Tautan lama di halaman infopemilu. |

### 1.12 Pendalaman: IP Dukcapil pusat + kombinasi endpoint (1 Okt 2026)

**Hasil DNS (nslookup):**

| Host | IP / hasil | Keterangan |
|---|---|---|
| `dukcapil.kemendagri.go.id` | **36.66.118.179**, **118.97.79.23** | DNS hidup. `www` = alias ke IP yang sama. |
| → konektivitas | `36.66.118.179:443` 🟢 (homepage200, ±10 dtk); `118.97.79.23:443` 🔴 timeout; port80 🔴 timeout (connect gagal) | Hanya IP pertama yang melayani. HTTPS jalan; butuh IP dipaku (`--resolve`) karena DNS bergantian ke IP mati. |
| `kemendagri.go.id` | 101.255.168.232, 103.245.225.232 | 🔴 timeout dari jaringan uji. |
| `ceknik.kemendagri.go.id` | NXDOMAIN | 🔴 tidak ada. |
| `api/ws/rest/sipp/e-ktp/dukcapil-api.kemendagri.go.id` | NXDOMAIN | 🔴 semua tidak ada. |
| `ikd.kemendagri.go.id` | **103.245.225.130** 🟢 | Ada, tapi yang dilayani aplikasi login **"Konsolidasi Sipades"** (form `/login` + `/captcha/default`, aset dari `sipades.kemendagri.go.id`) — bukan API KTP digital. |

**Kombinasi path endpoint yang dicoba (GET, volume rendah, dipaku ke36.66.118.179):**

| Path di `dukcapil.kemendagri.go.id` | Hasil |
|---|---|
| `/` | 🟢200 — halaman berita/blog "DITJEN DUKCAPIL KEMENDAGRI" (bukan API; form satu-satunya `/blog/search_submit` = pencarian artikel). |
| `/robots.txt` | 🔴404 kosong |
| `/sitemap.xml` | 🔴404 kosong |
| `/api` | 🔴404 kosong |
| `/api/nik` | 🔴404 kosong |
| `/ceknik` | 🔴404 kosong |
| `/cek-nik` | 🔴404 kosong |
| `/nik` | 🔴404 kosong |
| `/webservice` | 🔴404 kosong |
| `/halamandepan/ceknik` | 🔴404 kosong |
| `/api/v1/nik/validate` | 🔴404 kosong |

| Path di `ikd.kemendagri.go.id` | Hasil |
|---|---|
| `/` | 🟢200 — aplikasi "Konsolidasi Sipades" (login + captcha), bukan API. |
| `/api`, `/api/nik`, `/ceknik` | 🔴404 "Not Found" |
| `/robots.txt` | 🟢200 `User-agent: * Disallow:` (terbuka) |
| via `http://` port80 | 🟡301 redirect |

**Kesimpulan pendalaman:** Dukcapil pusat (Ditjen Dukcapil Kemendagri) **tidak menyediakan API cek NIK publik** di endpoint mana pun yang masuk akal — situsnya portal berita dan aplikasi login internal. Tetap tidak ada sumber nama yang layak untuk halaman statis.

### 1.13 Pendalaman: data partai (Golkar & SIPOL KPU) — 1 Okt 2026

**SIPOL KPU (`sipol.kpu.go.id`) — ada API-nya, tapi terkunci:**

| Path | Hasil |
|---|---|
| `GET /api/parpol` | 🟡200 tapi body `{"status":401,"message":"Unauthenticated."}` — **API JSON ada**, butuh token (Sanctum). |
| `GET /parpol` | 🟡302 → `https://sipol.kpu.go.id` ("SIPOL Login", Keycloak + reCAPTCHA). |
| `/api/parpol/1`, `/api/partai`, `/api/anggota`, `/api/pengurus`, `/api/ceknik`, `/api/search` | 🔴404 |
| `/partai`, `/data-parpol`, `/profil`, `/public`, `/api`, `/partai-politik` | 🔴404 |

**Situs partai Golkar:**

| Host / endpoint | Hasil |
|---|---|
| `golkar.or.id` (Cloudflare,104.21.78.26 /172.67.215.28) | 🟢200 — situs berita WordPress ("Suara Golkar"). |
| `https://www.golkar.or.id/wp-json/` | 🟢200 — namespace hanya `oembed/1.0` + `wp/v2` (artikel/halaman). **Tidak ada API custom, tidak ada data pengurus/anggota.** |
| Subdomain `sipgar/sipol/data/api/apps/database.golkar.or.id` | 🔴 NXDOMAIN semua. (SIPGAR di internet ternyata aplikasi kebugaran Kemenkes, bukan Golkar.) |
| `dpppartaigolkarofficial.com` (situs resmi + PPID, berisi SK pengurus dalam PDF) | 🟢200 — WordPress; namespace wp-json hanya plugin (elementor/yoast/litespeed/dll.) → **tidak ada endpoint data anggota**. Data pengurus berupa dokumen PDF statis. |
| `golkarconnect.id` ("Platform Konsolidasi Partai Golkar", aplikasi iOS/Android, dev heytechnoverse-ltd) | 🟢200 (153.92.8.82) — hanya **landing page** WordPress (Elementor/Hostinger). `api/app/www/admin.golkarconnect.id` → NXDOMAIN. `wp-json/` hanya namespace plugin. String `endpoint":"https://golkarconnect...` yang terlihat ternyata blok langganan Hostinger Reach (bukan API partai). Backend aplikasi mobile-nya tidak terekspos dari situs ini dan sudah pasti butuh login akun anggota. |

**Halaman data parpol KPU (infopemilu, semuanya 🟢200 tapi HTML informasi, bukan API):** `/Pemilu/2024/Peserta_pemilu`, `/Pemilu/2024/Parpol/`, `/Pemilu/2024/Pendaftaran_parpol`, `Penetapan_parpol`, `Verfak_parpol`, `Vermin_parpol`, `Pengundian_parpol`, `Pemutakhiran_parpol`, `/Pemilu/2024/Dapil/` — tanpa tabel/unduhan data anggota di HTML mentah.

**Kesimpulan:** sistem partai (termasuk Golkar) tidak mengekspos endpoint data anggota/pengurus ke publik — yang terbuka hanya situs berita dan dokumen PDF. Satu-satunya endpoint data partai+nama yang hidup tetap `POST infopemilu.kpu.go.id/Pemilu/Cari_nik_parpol/getDataFromAjx` (tanpa CORS), dan API SIPOL yang resmi ada tapi bertoken.

### 1.14 Pendalaman: download APK cek NIK/KTP terbaru + lacak endpoint (1 Okt 2026)

**APK yang diunduh (tersimpan di folder `apk/`):**

| File | Paket / versi | Sumber | Ukuran |
|---|---|---|---|
| `apk/ceknik-ktp-online.apk` | `com.vjy.ceknikktponline` v2.7 (update 2026) | `https://d.apkpure.com/b/APK/com.vjy.ceknikktponline?version=latest` (200, ZIP valid) | 2.786.068 byte |
| `apk/ikd-dukcapil.apk` | `gov.dukcapil.mobile_id` (Identitas Kependudukan Digital resmi) | `https://d.apkpure.com/b/APK/gov.dukcapil.mobile_id?version=latest` (XAPK; unduhan sempat terputus lalu dilanjut `curl -C -` → 206, ZIP valid) | 235.828.014 byte |

Kandidat `com.HaurgeulisDev.cek_ktp_id_nik_online` via APKPure → 404 (tidak tersedia).

#### A. `ceknik-ktp-online.apk` — endpoint yang dilacak

Satu-satunya endpoint data di `classes.dex` (tanpa Google Ads kecuali):

- **`http://pajak.hargaorigi.com/datawilayah.php?kode=`** (HTTP polos; server memaksa `301 → https://`).
  - Uji: `GET https://pajak.hargaorigi.com/datawilayah.php?kode=33` → 200 `Content-Type: text/html` → `{"success":"true","message":"Successfully!","data":"JAWA TENGAH - JAWA TENGAH - JAWA TENGAH"}` — **hidup** 🟢.
  - `kode=3301`, `330101001`, `50124`, `330101` → 200 `{"success":"false","message":"Alamat tidak ditemukan! Silahkan hubungi admin",...}` — cakupan data sangat terbatas (hanya provinsi yang terjawab).
  - **Tanpa header CORS**, Content-Type salah (text/html untuk JSON).
  - Fungsi: lookup **nama wilayah per kode provinsi** saja — **tidak ada nama orang**; selebihnya parse NIK offline di aplikasi.
- Selain itu hanya URL Google Ads/AdMob + halaman kebijakan privasi `vjystudio.blogspot.com` — tidak ada endpoint lain.

#### B. `ikd-dukcapil.apk` (aplikasi resmi) — endpoint yang dilacak

Struktur XAPK: `gov.dukcapil.mobile_id.apk` (base, 174 MB, Flutter) + `config.arm64_v8a.apk` (61 MB, berisi `libapp.so` Dart AOT) + split lain. Proteksi: `libpairipcore.so` (PairIP integrity), `libsqlcipher.sqlcipher` (DB lokal terenkripsi), ML Kit OCR + face detector (pindai KTP-el & liveness).

**Host resmi Dukcapil yang ditemukan di `libapp.so` — ketiganya hidup, tanpa CORS:**

| Host | IP | Uji GET / | Keterangan |
|---|---|---|---|
| `ep-web.dukcapil.kemendagri.go.id` | 103.77.185.45 | 200 (nginx/1.20.1, ±7,5 dtk), **ACAO: tidak ada** | Halaman "SIAK Terpusat Entri Point Pelayanan Kependudukan" — backend utama. |
| `layananonline.dukcapil.kemendagri.go.id` | 103.77.185.10 | 200, **ACAO: tidak ada** | "Integrasi SIAK Terpusat". |
| `token-provider.dukcapil.kemendagri.go.id` | 103.77.185.130 | 200, **ACAO: tidak ada** | Halaman kecil "Dukcapil @2021" — penerbit token. |

**Path API yang terekstrak dari `libapp.so` (cuplikan, tanpa kecuali yang relevan):**

- Autentikasi/sesi: `/login`, `/password-check`, `/auth/account`, `/auth/device-check`, `/auth/device-remove-qr`, `/auth/registration-check`, `/auth/registration-enlist`, `/auth/registration-qr`, `/authOnline/registration-online`, `/init-handshake`, `/epconnect/ep-session`, `/lepas-perangkat`, `/pindah-perangkat`, `/hapus-akun`, `/ssoIntegration/read`.
- **Pencarian (yang paling dicari!):** `/pencarian/identifikasi-nik`, `/pencarian/identifikasi-kk`, `/pencarian/jumlah-nama`, `/pencarian/pencarian-wilayah` — plus halaman in-app `/beranda/pencarianNik`, `/beranda/pencarianNama`, `/beranda/pencarianNamaLengkap`, `/beranda/pencarianKk`, `/byNIK`, `/byNikOrg`, `/detail-nik`, `/validate-ktp`, `/ektpReader/reader`.
- Wilayah: `/wilayah/getProp`, `/wilayah/getKab`, `/wilayah/getKec`, `/wilayah/getKel`, `/wilayah/getWilayah`, `/wilayahAdm/getWilayah`, `/beranda/wilayahAdministrasi/cari`.
- Layanan/dokumen: `/procPelayanan`, `/procPelayananSave`, `/procHistQRMobileSiak`, `/procHistDetail`, `/epPelayananDafduk/*` (reqCetakBiodataWni, reqCetakKartuKeluarga, reqPindahWni, dll.), `/epPelayananCapil/*`, `/epDokumenPelayanan/procDokumenLayanan`, `/dokumenkuPindah/dokumen/*`, `/validasiDokumen/verifier-*`.
- Monitoring petugas: `/epmonitoringCP01|CP02|CPKM|IBIO|IKRK|INOP|IPDH|IPSH|IWGD|IWPD/(list|track|view)`.
- Simbol layanan: `SrvPencarianNIKDetail.send()` (backend `RestPmhCP01`), `SrvAuthAccountLogin`, `SrvHomeIkdHubData`, `RestMonitoringPelayananPmhCP01`, menu `MN_SNIK_IKD` / `MN_SNAMA_IKD` / `MN_SNOKK_IKD`. (Ada juga string mirip kunci statis di `libapp.so` — nilainya tidak dicatat di dokumen ini.)

**Uji terhadap `ep-web`:** `/pencarian/identifikasi-nik` → 404 (halaman Error), `/wilayah/getProp` → timeout/000 — path butuh prefix/metode/sesi yang tepat; seluruh alur dilindungi session (`/init-handshake`, `/epconnect/ep-session`) + passcode/PIN + PairIP. **Tanpa CORS** di ketiga host.

**Kesimpulan:** aplikasi resmi Dukcapil punya endpoint pencarian NIK/nama yang lengkap, tetapi tertutup rapat: butuh akun IKD yang aktivasi via Dukcapil/OTP, sesi di-establish lewat handshake, tidak ada CORS, tidak ada anon query. Untuk halaman statis tetap **tidak layak**; status semua kandidat di bagian ini: 🟢 hidup tapi terbatas (datawilayah.php), 🟡 hidup tapi terkunci (ep-web/layananonline/token-provider).

---

## 2. CORS proxy (penghubung browser ↔ endpoint KPU tanpa CORS)

Semua diuji **POST** meneruskan `input_ajx=3301012501900001` ke `https://infopemilu.kpu.go.id/Pemilu/Cari_nik_parpol/getDataFromAjx` dengan `Origin: https://example.com`. Yang berhasil akan mengembalikan `[]` + header ACAO.

| # | Proxy | Status uji | ACAO | Keterangan |
|---|---|---|---|---|
| 1 | `https://api.allorigins.win/raw?url=` | 🔴 522 untuk target KPU (kontrol GET ke example.com = 200) | kontrol=1 | Origin-nya hidup, tapi **fetch ke KPU gagal (522)**. |
| 2 | `https://api.codetabs.com/v1/proxy?quest=` | 🔴 522 termasuk kontrol example.com | 0 | Layanan sedang/tetap down. |
| 3 | `https://proxy.corsfix.com/?` | 🔴 403 | 1 | `{"corsfix_error":"no_active_plan"}` — butuh paket berbayar/trial. |
| 4 | `https://api.cors.lol/?url=` | 🔴 429 | 0 | `Rate limit exceeded` — konsisten dari IP lokal. |
| 5 | `https://corsproxy.io/?url=` | 🔴 403 | 1 | Diblokir Cloudflare (halaman error punya ACAO). |
| 6 | `https://corsproxy.org/?url=` (-L) | 🔴 200 tapi bukan proxy | 0 | Redirect301 ke halaman marketing `hide.mn`. |
| 7 | `https://cors.eu.org/` | 🔴 429 | 0 | Rate limit. |
| 8 | `https://cors-anywhere.azm.workers.dev/` | 🔴 403 | 0 | Balasan `Hello World` — butuh whitelist origin. |
| 9 | `https://thingproxy.freeboard.io/fetch/` | 🔴 000 | — | Koneksi gagal. |
| 10 | `https://r.jina.ai/` (Jina Reader, POST JSON `{url,method,headers,body}`) | 🟡 hidup, CORS ok (ACAO meng-echo Origin), tapi 🔴 untuk tugas ini | 1 | Hanya menavigasi (GET page.goto); POST tidak diteruskan → `422 TimeoutError` ke KPU. |

**Kesimpulan proxy:** 0 dari 10 bisa meneruskan POST ke KPU dari browser saat diuji — tidak ada jembatan CORS yang layak andal.

---

## 3. Repositori GitHub yang ditemukan (bukan endpoint hidup)

| Repo | Isi / nasib |
|---|---|
| `namtxs/cek-nik` | Klien PHP ke `resultDps.json` KPU 2017/2018 — upstream mati. |
| `vhax7788/cek-nik-api` | Express+Puppeteer scraping cekdptonline (butuh OTP era sekarang); deploy `https://cek-nik-api.onrender.com` 🔴 404. |
| `kevindepernama-byte/cek-nik` | Homepage `https://cek-nik-gamma.vercel.app` 🔴 404 (DEPLOYMENT_NOT_FOUND). |
| `YoshCasaster/Cek-NIK-API`, `AllxdDev-Hosting/Cek-NIK-API` | Hanya README + tautan unduhan ZIP pihak ketiga — tidak ada API hidup. |
| `diamsyah02/api_ceknikmu`, `argawan/Cek-NIK-KTP-API` | Repo lama (2022), tidak ada deploy. |
| `maldiq/php-ceknik` | Validasi format NIK (PHP) saja — parse lokal. |
| `andikaputradev/nik-checker` | CLI Go + `data.json` wilayah — parse lokal. |
| `AdhuyGuru/ceknik`, `tuwiliyt/ceknik`, `ondev404/ceknik`, `glorymaitimuu/*`, `rizkipr05/cekNIK-app` | Aplikasi/mobile — tidak menemukan endpoint API publik. |
| `wildanlsfs/cek-bansos-api` | Muncul di pencarian; terkait bansos, bukan cek NIK KTP. |

---

## 4. Kanal non-API yang muncul di hasil pencarian (bukan endpoint)

- SMS `Cek#KTP#NIK` ke **0815-3636-9999** (artikel dispenduk Mojokerto).
- Telepon **Halo Dukcapil 168** (blog resmi Kemendagri) / call center **1500 537** (panduan 2026).
- Situs resmi `dukcapil.kemendagri.go.id` (🔴 tidak terjangkau saat diuji), LAPOR! Kemendagri, DM Twitter `@dukcapil168`.
- Form cek DPT resmi `cekdptonline.kpu.go.id` (OTP WhatsApp).

---

## 5. Endpoint internal aplikasi (bukan pencarian eksternal)

- `assets/pro.json`, `assets/kab.json`, `assets/kec.json` — data wilayah lokal di repo ini, dipakai `cek_nik.html` sebagai **fallback** kalau lookup wilayah eksternal gagal.

---

## 6. Rangkuman kelayakan untuk halaman statis

| Endpoint | Status | Punya nama | CORS | Tanpa key | Layak untuk cek_nik.html |
|---|---|---|---|---|---|
| nusakit `/v1/nik/validate` | 🟢 | ❌ | ✅ `*` | ✅ | ✅ (dipakai sekarang — struktural saja) |
| KPU `Cari_nik_parpol/getDataFromAjx` | 🟡 | ✅ | ❌ | ✅ | ❌ tanpa proxy/pantulan CORS; cakupan parpol |
| cekdptonline KPU | 🟡 | ✅ | ❌ | ❌ OTP | ❌ |
| kaltimprov Berau | 🟡 | ✅ | ? | ❌ key | ❌ (key di klien + hanya Berau) |
| api.mychaelgo.com | 🔴 | (dulu ✅) | — | — | ❌ |
| dukcapil / simpus / lindungiapi | 🔴 | — | — | — | ❌ |
| apiindonesia / nusantara / glair / iluma / rapidapi | 🟡 | ❌/berbayar | campuran | ❌ | ❌ |
| 10 CORS proxy pengujing | 🔴 | — | — | — | ❌ |

**Kesimpulan:** belum ada API pengganti "siap pakai" yang (a) mengembalikan nama dan (b) bisa dipanggil langsung dari halaman statis, pada tanggal uji ini. Endpoint nusakit tetap satu-satunya yang jalan dari browser, sehingga `cek_nik.html` tidak diubah. Jika nama wajib dibutuhkan, pilihannya: proxy kecil buatan sendiri (Node tanpa dependensi) yang meneruskan request KPU, registrasi API key kaltimprov (khusus Berau), atau penggunaan manual `cekdptonline.kpu.go.id` dengan OTP milik pengguna sendiri.

> **Pembaruan1 Okt 2026:** kesimpulan di atas terpecahkan lewat **`server.js`** — lihat bagian7.

---

## 7. Solusi yang dibangun: `server.js` (server mini lokal, tanpa dependensi)

**File:** `server.js` (Node ≥18, zero dependency) + `cek_nik.html` yang disesuaikan.

- Jalankan: `node server.js` → `http://127.0.0.1:8787/` (env `PORT` bawaan mesin ini bernilai `0` — sudah ditangani agar jatuh ke8787; knob uji: `PORT`, `KPU_URL`, `NUSAKIT_URL`).
- `GET /api/check?nik=<16 digit>` → menjalankan **paralel**: `POST` KPU `Cari_nik_parpol` (nama) + `GET` nusakit (struktural), lalu melengkapi nama wilayah dari `assets/*.json` lokal. Selalu balas200 JSON dengan status per sumber (`ok/empty/found/error` + `galat[]`); `422` untuk NIK bukan16 digit. NIK di-log dalam versi **masked**; nama keluar dari server **utuh tanpa mask** (data publik pengurus parpol, sejak 5 Okt 2026); NIK direspons tetap masked (`331102********0001`).
- `GET /api/health`, plus penyajian statis `cek_nik.html` + `assets/*` (tolak traversal), `Access-Control-Allow-Origin: *` untuk /api (aman dipakai dari `file://`).
- `cek_nik.html`: utama memanggil `/api/check` (atau `http://127.0.0.1:8787` bila dibuka sebagai `file:`); **bila server tidak terjangkau, otomatis fallback ke alur lama** (nusakit langsung + fallback assets). Baris hasil: NIK (masked), Nama (utuh), Partai/Jabatan bila ada, wilayah, TTL, gender, usia, dan baris **Sumber**.

**Skenario uji yang dijalankan (semua lolos,1 Okt 2026):**

| # | Skenario | Hasil |
|---|---|---|
| S1 | `GET /api/health` | `200 {"ok":true,"port":8787}` |
| S2 | NIK fiktif `330101********0001` | nusakit ok (Cilacap/Kedungreja), KPU `empty`, Nama `—` — kartu hijau "NIK Valid" |
| S3 | NIK pengguna `331102********0001` | **nama ketemu**: `PURWANTO`, Partai Golongan Karya, jabatan sekretaris, unit Kecamatan + struktural Sukoharjo/Kec. Bulu,1976-06-25, L,50 th; sumber `nusakit + KPU SIPOL` |
| S4 | NIK non-16-digit (`...X`) | `422 {"error":"NIK harus tepat 16 digit angka."}` |
| S5 | `GET /` (statis) | `200` HTML versi baru |
| S6 | `KPU_URL` dipindah ke host mati (port8788) | nusakit tetap ok, `kpu.state=error` + `galat:["kpu: fetch failed"]` — tanpa nama, tetap anggun |
| S7 | `NUSAKIT_URL` dipindah ke host mati (port8789) | `valid:null` tapi nama dari KPU tetap tampil — kartu tetap hijau |
| S8 | Kedua sumber bermasalah | respons `200` + `galat[]` lengkap → halaman menampilkan kartu "Sumber data tidak terjangkau" |
| E2E | Browser (preview) isi NIK → klik Cek | kartu **"NIK Valid — nama ditemukan"** tampil utuh (terverifikasi via screenshot) |

**Catatan:**
- Tidak ada login/OTP yang dijalankan — skenario di atas semuanya Kanal publik; **nomor HP yang diberikan pengguna tidak terpakai** (alur OTP KPU/IKD tidak diperlukan dan kode sekali-pakai tidak boleh lewat obrolan).
- Data nama berasal dari SIPOL KPU (data publik pengurus parpol) dan ditampilkan **utuh** (tanpa bintang) sejak 5 Okt 2026; NIK asli tidak pernah keluar dari server dalam bentuk utuh (direspons selalu masked).
- Perbaikan yang terjadi selama pembuatan: penanganan env `PORT=0` (mesin ini menyetel `PORT` env = `0`), dan pemilihan port kedua via `PORT=8788/8789` untuk skenario gagal.

---

## 8. Re-probe live + pendalaman endpoint non-layak (1 Okt 2026, ±16:55–19:00 UTC)

Verifikasi ulang semua endpoint di luar kesimpulan "bisa dipakai". Ringkasan: tidak ada perubahan keputusan — **KPU SIPOL tetap satu-satunya sumber nama tanpa captcha**, dan `server.js` tetap memakainya. Detail temuan:

### 8.1 KPU SIPOL — header lengkap (konfirmasi mustahil client-side)

`POST .../Cari_nik_parpol/getDataFromAjx` masih 🟢 hidup, cepat (±0.3 dtk), balas `[]` untuk NIK fiktif. Header respons:

- `Server: Apache/2.4.52 (Ubuntu)`, `Upgrade: h2`, `Strict-Transport-Security`.
- **Tidak ada `Access-Control-Allow-Origin`** → browser memblokir pembacaan silang-origin (penghalang utama, tetap).
- Anti-iframe: `X-Frame-Options: DENY` + `Content-Security-Policy: frame-ancestors 'none'`.
- `Set-Cookie: cookiesession1=...` (sesi), `Content-Type: text/html` walau body JSON → klien wajib `JSON.parse` manual.
- Varian DPT lain (`Cari_nik`, `Cari_dpt`, `Cari_nik_dpt/getDataFromAjx`) semuanya 🔴 **404 maintenance_view.php** — hanya jalur parpol yang hidup.
- **Kesimpulan:** wajib proxy server-side (desain `server.js`). Tidak akan pernah bisa murni client-side.

### 8.2 ep-web.dukcapil — backend-nya INTERNAL (`https://dukancil/`) — temuan baru

- Host 🟢 hidup (`/` = 200, `text/html`), tapi server **Express**: semua path dari APK (`/pencarian/identifikasi-nik`, `/init-handshake`, `/login`, `/epconnect/ep-session`) + prefix (`/api`, `/v1`, `/rest`, `/api/v1`, `/sipp`, `/health`) balas 🔴 **`Cannot POST ...` / 404**.
- Dari `bin/siakClient.min.js` (±127 KB) ketahuan **base URL API = `https://dukancil/`** — hostname **internal** (tidak resolvable publik). Path data: `/referensi/wni`, `/referensi/wna`, `/referensi/moduladm`, `/referensi/activity`, `/ping`.
- **Kesimpulan:** ep-web hanya *thin client* SIAK; data WNI asli ada di backend internal `dukancil` yang tak tersentuh dari internet. Bukan sekadar soal sesi/PIN — backend-nya memang privat. **Coret dari kandidat.**

### 8.3 Kemensos cekbansos — `POST /cekbansos_nik` (lookup DTKS by NIK) — lead baru, TERKUNCI CAPTCHA

Halaman `https://cekbansos.kemensos.go.id/` 🟢 200. Form NIK: `POST /cekbansos_nik`, field `_token` (CSRF Laravel, sama dengan `<meta name="csrf-token">`), `nik_input`, dan **`captcha`** (gambar `id=captchaCode2`).

**Alur yang sudah dipecahkan (CSRF + sesi):**
1. `GET /` → simpan cookie `cekbansos_session` + `XSRF-TOKEN`, ambil `_token`.
2. `GET /captcha/flat?<rand>` → gambar **JPEG 160×46** (paket `mews/captcha`, `gd-jpeg`); jawaban disimpan di sisi server (sesi).
3. `POST /cekbansos_nik` (`_token` + `nik_input` + `captcha=<teks>`).

**Uji:** captcha **kosong** → 302 balik ke `/`; captcha **salah** (`abcd12`) → tetap **302 Found → `/`** (validasi Laravel gagal). Jadi CSRF sudah benar; **satu-satunya gerbang tersisa = image CAPTCHA** dan captcha benar-benar ditegakkan.

**Keputusan (sengaja TIDAK diotomasi):** satu-satunya cara lanjut adalah OCR untuk memecahkan captcha. Ini **tidak dibangun**, karena captcha adalah kontrol anti-otomasi yang disengaja pada basis data pemerintah (DTKS/penerima bansos) berisi **PII warga rentan** — berbeda kategori dengan KPU SIPOL (tanpa captcha, data pejabat publik/parpol). Membuat penembus captcha untuk scraping PII pemerintah melewati batas, rapuh, dan berisiko melanggar ToS/hukum. **Status: 🔴 tidak layak untuk integrasi otomatis.** Bila perlu data DTKS: jalur manual oleh pengguna (isi captcha sendiri) atau permintaan data resmi ke Kemensos.

### 8.4 Koreksi & konfirmasi lain

| Endpoint | Status re-probe 1 Okt 2026 |
|---|---|
| nusakit `/v1/nik/validate` | 🟢 200, CORS `*`, struktural saja (tak berubah). |
| nusakit `/v1/dummy/nik` | 🟢 **koreksi:** bukan mati — **hanya POST** (GET → 404). Isinya generator NIK fiktif + disclaimer, bukan lookup. |
| `api.mychaelgo.com/ktp` | 🔴 NXDOMAIN (mati permanen). |
| `api.kaltimprov.go.id` Berau | 🟡 302 → `/login` (auth wall Laravel, butuh API key). |
| `pajak.hargaorigi.com/datawilayah.php` | 🟢 hidup, **provinsi saja**, `text/html`, tanpa CORS, tanpa nama orang. |
| `token-provider` / `ikd.kemendagri.go.id` | 🟢 200, login/internal, tanpa CORS. |
| `docs.apiindonesia.id` / `nusantara.clowdlab.com/docs` | 🟢 200, key-based, parse-format (bukan lookup Dukcapil). |

**Kesimpulan bagian 8:** `server.js` tetap pada **KPU SIPOL** sebagai sumber nama (satu-satunya yang hidup, tanpa captcha, tanpa key). ep-web/dukancil dicoret (internal), cekbansos_nik dicoret (captcha-gated PII).

---

## 9. Uji sumber data tambahan (2 Okt 2026)

Probe live kandidat NIK→identitas di luar daftar lama. Semua buntu dengan pola sama (login / OTP / captcha / API key / backend internal):

| Sumber | Endpoint/host | Status | Model akses |
|---|---|---|---|
| SSCASN BKN | `daftar-sscasn.bkn.go.id` | 🟡 302 → `/login` | auth wall (validasi NIK hanya pasca-login CPNS) |
| SSCASN BKN | `helpdesk-sscasn.bkn.go.id` | 🟢 200 | hanya tiket + artikel bantuan (`nik_didaftarkan_orang_lain`), bukan API lookup |
| Prakerja | `www.prakerja.go.id` | 🟡 404 JSON `Application not found` | API gateway; butuh path app + auth. `dashboard.prakerja` timeout |
| BPJS Kesehatan | `bpjs-kesehatan.go.id` | 🟢 200 (homepage) | API kepesertaan auth-gated |
| cekrekening.id (Kominfo) | `/` | 🔴 403 | diblokir; lagipula laporan penipuan rekening, bukan NIK→nama |
| Nusantara API | `nusantara.clowdlab.com` | 🟡 docs SPA; tebakan `/api/nik` 404 | parse-format, bukan lookup identitas |
| apiindonesia.id | `use.apiindonesia.id/v1/validasi/nik` | 🟡 **401 `Bearer token is required`** | wajib API key; docs menyatakan "tanpa lookup ke database / bukan verifikasi Dukcapil" → parse-format saja |

**Kesimpulan §9:** tidak ada sumber baru yang layak. Setiap layanan NIK→nama dilindungi login/OTP/captcha/API-key atau backend internal; yang tanpa kunci hanyalah parse-format struktural (tanpa nama). KPU SIPOL tetap satu-satunya sumber nama hidup tanpa kunci.

---

## 10. Pendalaman gateway Provinsi Kaltim — `api.kaltimprov.go.id` (2 Okt 2026)

Perluasan §1.6. **Ini jalur kabupaten→data kependudukan asli yang paling nyata ditemukan.** Portal developer (Apache, `X-Powered-By: PHP/8.2.31`) mengagregasi disdukcapil banyak kab/kota Kaltim: Balikpapan, Berau, Bontang, Kubar, Kukar, Kutim, Mahulu, Paser, PPU, Samarinda.

**Struktur dokumentasi:**
- Index: `/dokumentasi` + per-wilayah `/dokumentasi/{berau,balikpapan,samarinda,kubar,kukar,paser,kaltim,publik}`.
- Ekosistem: `/api/ekosistem/{wilayah}`.
- Pola endpoint data: `/api/generate/{wilayah}/{skpd}/{endpoint}` dan `/api/generate/publik/{id}`.

**Endpoint disdukcapil Berau (terkonfirmasi dari halaman detail):**
| Endpoint | Fungsi | Method |
|---|---|---|
| `/api/generate/berau/disdukcapil/penduduk-by-nik?nik=` | **lookup data penduduk by NIK** (nama, dll.) — data asli, bukan parse | GET |
| `/api/generate/berau/disdukcapil/penduduk` | daftar penduduk | GET |
| `/api/generate/publik/{506,783,1269,1327,1342}` | dataset publik | GET |

Detail endpoint disimpan per-UUID, mis. `/dokumentasi/berau/disdukcapil/e63bcd50-e3ab-11e9-b5bb-9101f8d8511e` (= `penduduk-by-nik`) dan `.../8aaed7e0-e3ab-11e9-b881-21f8bee827c5` (= `penduduk`). Halaman menyebut `Authorization: Bearer`, `api_key`, `token`.

**Model akses (teruji 2 Okt 2026):**
- `penduduk-by-nik` **tanpa auth** → 🔴 **302 → `/login`**.
- **Bearer token palsu** → tetap **302 → `/login`** (token tak dikenali).
- **Dataset "publik" `/api/generate/publik/506`** → juga **302 → `/login`** (tidak benar-benar keyless).
- `/login` → 🟢 200; **`/register` & `/daftar` → 🔴 404** → **registrasi tidak swalayan**; akun/api_key harus diterbitkan admin (permohonan ke Diskominfo/Dukcapil Kaltim).

**Kesimpulan §10:** gateway Kaltim adalah **satu-satunya jalur terverifikasi ke data penduduk asli level kabupaten**, tapi (1) wajib api_key resmi yang tak bisa didaftarkan sendiri, (2) cakupan hanya warga Kaltim (bukan nasional), (3) key tak boleh ditanam di klien → wajib server-side. Untuk `cek_nik.html` (nasional, tanpa key) tetap **tidak layak**; status 🟡 hidup, data asli, auth-gated + regional + non-self-service.

---

## 11. Sentuh Tanahku (ATR/BPN) — bedah APK: endpoint & login (2 Okt 2026)

**Sumber:** `apk/Sentuh-Tanahku_6.0.8_apkcube.apk` (XAPK 45 MB; `base.apk` Flutter + split `arm64_v8a`). Logika Dart AOT di `lib/arm64-v8a/libapp.so` (14,5 MB). Ini aplikasi **pertanahan ATR/BPN**, bukan NIK→nama; dicatat karena login-nya menumpang **SSO IKD Dukcapil** dan endpoint-nya sempat ditebak-nebak script `cari_shm_sentuh.py`.

### 11.1 Login / autentikasi

**Dua jalur:**
1. **Email + password** → backend utama `sentuh.atrbpn.go.id`:
   - `POST /auth/signin` (alias `/authentication`), sesi via `/refresh_token`, `/user`, `/account`, `/account_summary`.
   - Field terdeteksi di `libapp.so`: `email`, `password`, `pin`, `otp`, `nik`, `nomorIdentitas`, `no_hp`/`phone`, `deviceId`, `fcm`, `token`, `refresh_token` → ada verifikasi OTP + pengikatan perangkat (device binding + FCM push).
2. **SSO IKD Dukcapil** (login pakai akun Identitas Kependudukan Digital):
   - `https://akun-ikd.dukcapil.kemendagri.go.id/IKD_API/auth/sso`
   - Uji live → 🟢 200 `{"err_code":500,"err_msg":"Invalid token or user key or api key or client secret !"}` → butuh token/api-key/client-secret hasil handshake app.

### 11.2 Peta host & endpoint (ekstraksi `libapp.so`)

| Host | Fungsi | Status uji (jaringan lokal, 2 Okt 2026) |
|---|---|---|
| `sentuh.atrbpn.go.id` | backend utama (auth, berkas, sertifikat) | 🔴 **000** — IP `103.123.13.70`, TLS handshake OK lalu request di-drop (diduga blokir IP non-ID/datacenter) |
| `bhumi.atrbpn.go.id/api/geocode` | geospasial/peta bidang | 🟡 **401** `{"message":"You are not authorized..."}` (butuh token) |
| `antre.atrbpn.go.id/be/api/` | antrean online | 🟢 301 (hidup) |
| `sipenta.atrbpn.go.id/tatausaha/apis/` | tata usaha | 🟢 200 (`CariBerkas` balas 200 kosong tanpa param/token) |
| `aplikasi.atrbpn.go.id/konsol/antrian/directus/` | CMS Directus antrean | hidup |
| `sentuhnotif.atrbpn.go.id` / `socketantre.atrbpn.go.id` | notifikasi + socket.io antrean | hidup |
| `digitrust-api.peruri.id` | tanda tangan elektronik Peruri (TTE) | hidup |
| `bantuan.atrbpn.go.id/sentuhtanahku/`, `jdih.atrbpn.go.id`, `ppid.atrbpn.go.id`, `www.atrbpn.go.id` | bantuan/dokumentasi/PPID/publik | hidup |

**Path data tanah/sertifikat (asli dari APK):** `/CariBerkas`, `/GetBerkas`, `/GetInfoSertifikat`, `/SertifikatTanahNew`, `/GetParcelBoundaryById`, `/GetGeotagParcelByBerkas`, `/BagiSertifikat`, `/BagikanBerkas`, `/KotakKeluarSertifikat`, `/AddCollectionBerkas`, `/DeleteCollectionBerkas`, `/GetTanyaJawabBerkas`, `/VerifyTTE`, `/getGeoJsonInfo`, `/SwaplottingTerdaftar`, `/SwaplottingBelumTerdaftar`; wilayah: `/wilayah/no`, `/provinsi`, `/kabupatenkota`, `/kecamatan`, `/kelurahan`; antrean: `/antre`, `/antrian`, `/antrian/saya`, `/antrian_online`.

### 11.3 Koreksi untuk `cari_shm_sentuh.py`

- Path tebakan script (`/CariBidang`, `/api/CariBidang`, `/legacy/GetInfoSertifikat`, `/legacy/SertifikatTanahNew`) **tidak ada** di APK — yang benar `/CariBerkas`, `/GetInfoSertifikat`, `/SertifikatTanahNew` (lihat §11.2).
- **"Mode Tamu" tanpa token tidak akan tembus**: semua endpoint data di belakang auth (bhumi 401; backend `sentuh` butuh sesi). Menebak param `nomorHak/nomorSertipikat` dsb. akan mentok 401/404.

### 11.4 Batas penggunaan (disengaja)

Reverse-engineering APK milik sendiri untuk memetakan endpoint & alur login = wajar. Yang **tidak dilakukan/tidak dianjurkan**: login dengan kredensial via otomasi, brute-force OTP, atau **enumerasi nomor SHM untuk menarik data kepemilikan tanah pihak ketiga tanpa auth** (itu PII properti orang lain). Jalur benar untuk data **milik sendiri**: login di app → pakai **token akun sendiri** → panggil `/CariBerkas` / `/GetInfoSertifikat` untuk berkas sendiri.

**Kesimpulan §11:** Sentuh Tanahku tidak menyediakan jalur anonim NIK/SHM→data; login-nya email+password (OTP+device binding) atau SSO IKD Dukcapil, dan seluruh endpoint data auth-gated. Backend utama bahkan memblokir IP di luar Indonesia. Tidak relevan sebagai sumber `cek_nik.html`; dicatat sebagai referensi endpoint ATR/BPN + pola login IKD SSO.

---

## 12. Pendalaman API komersial (apiindonesia.id, glair.ai) + verdict kolaborasi Dukcapil pusat & Berau (2 Okt 2026)

Perluasan §1.10 dan §9. Probe live ulang + baca dokumentasi resmi dua penyedia KYC komersial, plus penilaian apakah gateway Berau (§10) bisa "dikolaborasikan" dengan IP Dukcapil pusat (§1.12) menjadi satu cek NIK nasional. Semua uji memakai NIK fiktif `3301012501900001`.

### 12.1 apiindonesia.id — validasi NIK = parse struktur, BUKAN lookup 🟡

- **Endpoint:** `POST https://use.apiindonesia.id/api/v1/validasi/nik` (base `https://use.apiindonesia.id`; docs `https://docs.apiindonesia.id` 🟢 200).
- **Tanpa key → 🔴 401 Unauthorized** (diuji live 2 Okt 2026). Respons via **Cloudflare** (`CF-Ray`, `Server: cloudflare`), body JSON 70 byte. Header **`Access-Control-Allow-Origin: *`** ada → secara teknis bisa dipanggil dari browser, **tapi** tetap butuh key.
- **Auth:** semua endpoint `/api/v1/*` wajib header **`x-api-key`** — kutipan docs: *"Semua endpoint di bawah `/api/v1/*` memerlukan header `x-api-key`"*.
- **Yang dikembalikan:** **hanya validasi struktural** — kutipan docs: *"Memeriksa format 16 digit NIK dan mengekstrak kode wilayah/tanggal lahir. **Bukan verifikasi Dukcapil.**"* → validity + kode provinsi + tanggal lahir. **Tidak ada field nama.**
- **Free tier:** daftar akun gratis → **API key pertama otomatis dibuat** (kutipan: *"Daftar akun gratis— API key pertama Anda otomatis dibuat saat registrasi."*) + **bonus 3.000 kredit** (Rp3.000).
- **OCR/KTP:** **tidak ada** endpoint OCR / unggah foto KTP di docs.
- **Verdict:** **redundan** dengan `cek_nik.html` — melakukan persis hal yang sudah dihitung formula lokal (struktur + wilayah + TTL) **tanpa biaya & tanpa key**, dan tetap **tak memberi nama**. Tidak layak diintegrasikan; kalaupun dipakai, key wajib **server-side** (di `server.js`), bukan di halaman statis (bocor).

### 12.2 glair.ai — KYC match (boolean) + OCR, berbayar, tanpa sandbox 🔴

- **API base:** `https://api.glair.ai` → **🔴 403** (diuji live 2 Okt 2026; terkunci, butuh kredensial). Docs `https://docs.glair.ai` → 🟡 307 (redirect normal ke `/vision/...`).
- **Endpoint verifikasi identitas:** `POST /identity/v1/verification`.
  - **Auth:** `apiKey` + `username` + `password` (kredensial hasil kontrak). **Tidak ada free trial / sandbox** yang disebut di docs.
  - **Yang dikembalikan:** **boolean match**, bukan data — kutipan docs: *"If `true`, the uploaded name field is valid and corresponds with given NIK."* → **kamu kirim NIK + nama (+foto), dia balas cocok/tidak**; **tidak pernah mengembalikan nama** dari NIK saja. Jadi **tidak bisa** dipakai "mencari" nama pemilik NIK.
- **OCR KTP:** `docs.glair.ai/vision/ktp` → baca teks dari **foto KTP** (image→teks), bukan NIK→database.
- **Verdict:** layanan KYC berbayar untuk **verifikasi** (mengonfirmasi data yang sudah kamu punya), bukan **lookup**. Tanpa akun/kontrak tak bisa dicoba; dengan akun pun tidak membocorkan nama dari NIK. Tidak relevan sebagai sumber `cek_nik.html`.

### 12.3 Tabel ringkas (live 2 Okt 2026)

| Penyedia | Endpoint | Tanpa key | Memberi nama dari NIK? | Free tier? | Nilai utk `cek_nik.html` |
|---|---|---|---|---|---|
| apiindonesia.id | `POST use.apiindonesia.id/api/v1/validasi/nik` | 🔴 401 (`x-api-key`) | ❌ struktur saja ("Bukan verifikasi Dukcapil") | ✅ key auto + 3.000 kredit | ❌ redundan (formula lokal setara) |
| glair.ai | `POST api.glair.ai/identity/v1/verification` | 🔴 403 | ❌ boolean match (bukan lookup) | ❌ tanpa sandbox | ❌ |
| glair.ai | `docs.glair.ai/vision/ktp` (OCR) | 🔴 | ❌ (OCR foto→teks) | ❌ | ❌ |

### 12.4 Verdict "kolaborasi" gateway Berau (§10) + IP Dukcapil pusat (§1.12)

Pertanyaan: bisakah jalur Berau/Kaltim digabung dengan IP Dukcapil pusat jadi satu cek NIK nasional? **Tidak.**

- **Dukcapil pusat** = cakupan **nasional**, tapi **terkunci**: `dukcapil.kemendagri.go.id` (36.66.118.179 / 118.97.79.23) hanya **portal berita** (bukan API); backend asli `ep-web` (103.77.185.45) / `layananonline` (.10) / `token-provider` (.130) → 200 **tanpa CORS**, sesi via handshake + akun IKD (aktivasi Dukcapil/OTP), data WNI di backend **internal `https://dukancil/`** yang tak resolvable publik (§8.2). **Tak ada query anonim.**
- **Berau/Kaltim** = **data penduduk asli**, tapi 302→`/login`, api_key **non-self-service**, cakupan **hanya warga Kaltim** (§10).
- **Digabung:** dua pintu terkunci. Kombinasi yang berfungsi **hanya** mungkin bila memegang **kredensial resmi** (hak akses IKD/pusat **atau** api_key Kaltim), dan itu **wajib server-side** — bukan `cek_nik.html` statis tanpa key. **Tak ada jalur keyless nasional.**

**Kesimpulan §12:** baik API komersial (apiindonesia = parse struktur; glair = KYC match/OCR berbayar) maupun "kolaborasi" pusat+Berau **tidak menyediakan NIK→nama tanpa kredensial resmi**. `cek_nik.html` (struktur lokal + nama publik **SIPOL KPU**, ter-mask) tetap **maksimal yang sah** tanpa key. Jalur sah bila butuh data kependudukan asli: (a) **hak akses lembaga pengguna** Dukcapil (Permendagri) — server-side; (b) **api_key resmi Kaltim** (permohonan ke Diskominfo/Dukcapil Kaltim) — server-side, khusus warga Kaltim; atau (c) **KYC berlisensi** (glair / iluma / apiindonesia tier berbayar) dengan kontrak.

---

## 13. Halaman kedua: `test.html` — Cek Bansos DTSEN lewat endpoint di folder `modal/` (2 Okt 2026)

> **Pembaruan 2 Okt 2026:** file `test.html` sudah **dihapus** dari folder ini karena seluruh isinya (form captcha + pemanggilan cekbansos) telah digabung ke **`cek_nik.html`** — halaman tunggal itu kini memakai ketiga sumber (Rumus + SIPOL + DTSEN) dan tampil sebagai tiga kotak terpisah. Isi bagian ini tetap dicatat sebagai riwayat rancangan.

`test.html` = salinan tampilan & pola kode `cek_nik.html`, tapi endpointnya diganti ke yang terekam di folder `modal/` (`modal/test001.txt` + HAR `cekbansos.kemensos.go.id_Archive [26-10-02 12-43-17].har`):

- `GET https://cekbansos.kemensos.go.id/` → cookie sesi + `<meta name="csrf-token">` (`_token`)
- `GET https://cekbansos.kemensos.go.id/captcha/flat?<random>` → gambar JPEG CAPTCHA (terikat sesi)
- `POST https://cekbansos.kemensos.go.id/cekbansos_nik` (`_token`, `nik_input`, `captcha`) → `302`
- `GET https://cekbansos.kemensos.go.id/hasil-nik` → tabel DTSEN (NAMA, DESIL, KETERANGAN DTSEN, SEMBAKO, PKH, PBI-JK, STATUS KPD)

**Mengapa tetap butuh `server.js`:** situs itu mengirim `Cross-Origin-Resource-Policy: same-origin` dan **tanpa** `Access-Control-Allow-Origin` → mustahil dipanggil langsung dari halaman browser (lihat §8.3). Dua rute baru ditambahkan di `server.js`:

| Rute | Fungsi |
|---|---|
| `GET /api/bansos/captcha` | ambil sesi + token CSRF + gambar captcha (base64), simpan sesi di memori (TTL 5 menit) |
| `POST /api/bansos/check` | `{id, nik, captcha}` → POST `cekbansos_nik` (`redirect:'manual'`) → ikuti `302` ke `/hasil-nik` → parse tabel → JSON |

**Aturan yang dipertahankan:** CAPTCHA **diisi manusia** lewat gambar di halaman (tidak ada OCR/bypass — tetap pada keputusan §8.3), dan **satu kode = satu percobaan** (sesi langsung dihapus setelah dipakai). Nama TIDAK bisa dibuka — HTML hasil dari `/hasil-nik` **hanya memuat nama berbintang** (`P******O`; tidak ada nama utuh di sel/manapun dalam respons, diverifikasi terhadap isi HAR), jadi asterisk itu berasal dari Kemensos, bukan dari halaman ini. NIK ditampilkan utuh ke pemiliknya (ia yang mengetik), log server tetap masked.

**Hasil uji (2 Okt 2026):**

| Uji | Hasil |
|---|---|
| `GET /api/bansos/captcha` | 🟢 200, gambar JPEG valid (±2,5 KB, magic `ffd8ff`) |
| Parser tabel vs HTML asli di HAR | 🟢 11 sel terurai: `P******O`, desil `6-10`, `AKTIF DTSEN`, Sembako/PKH/PBI-JK `TIDAK`, KPD `TIDAK` |
| `POST check` dengan captcha salah | 🟢 `state=captcha` (302 ke `/`, ditolak sesuai harapan) |
| Alur lengkap di browser (`test.html`) dengan captcha diisi manusia | 🟢 kartu **"Data Ditemukan"** — NIK masked, TTL/gender/usia (rumus lokal) + nama utuh, desil, DTSEN, Sembako/PKH/PBI-JK/KPD |
| Halaman tanpa server lokal | 🟢 kartu "Server Lokal Tidak Terjangkau" + petunjuk menjalankan `server.js` |

Jalankan: `node server.js` → buka `http://127.0.0.1:8787/test.html` (port bisa diubah dengan env `PORT`; endpoint bisa dipindah dengan `BANSOS_URL`).

**Pembaruan — `cek_nik.html` kini menggabungkan ketiga sumber (2 Okt 2026):** form ditambah baris CAPTCHA (opsional) dan kartu hasil digabung jadi satu: **Rumus** (struktur + `WIL_*` tertanam) + **SIPOL** (`/api/check`) + **DTSEN** (`/api/bansos/check`), dijalankan paralel dengan `Promise.all`. Baris **Sumber** ditulis simpel — mis. `Rumus + SIPOL + DTSEN` — dan hanya memuat sumber yang benar-benar memberi data; sumber yang gagal/kosong muncul sebagai baris status sendiri (`SIPOL: tidak ada data parpol…`, `DTSEN: <pesan>`). CAPTCHA dikosongkan = DTSEN dilewati, halaman tetap jalan tanpa server seperti sebelumnya.
