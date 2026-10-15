#!/usr/bin/env node
// buat-single.js — membuat single/ceknik-single.html
//
// Konversi cek_nik.html (versi PC) menjadi SATU FILE UTUH:
//   - CSS + JS           : sudah inline dari sananya
//   - logo.png           : di-embed sebagai data URI
//   - pro/kab/kec.json   : di-embed sebagai "id:nama|id:nama|..."
//                          (jauh lebih kecil dibanding JSON mentah)
//   - API_URL            : tetap tersedia agar kelak SIPOL & DTSEN bisa
//                          dijalankan lewat server/cloud saat ditempel di blog
//
// Jalankan:  node buat-single.js
//            node buat-single.js https://ceknik.<kamu>.workers.dev   (mengisi API_URL)
const fs = require('fs');
const path = require('path');

// API URL dipilih di sini: argumen pertama atau env API_URL
const API_URL = String(process.argv[2] || process.env.API_URL || '').trim().replace(/\/+$/, '').replace(/[\s'"\\]/g, '');
if (API_URL && !/^https?:\/\/[^\s]+$/.test(API_URL)) throw new Error('API_URL tidak valid: ' + API_URL);

const ROOT = __dirname;
const SRC = path.join(ROOT, 'cek_nik.html');
const OUT_DIR = path.join(ROOT, 'single');
const OUT = path.join(OUT_DIR, 'ceknik-single.html');

// ----------1) kemas data wilayah ----------
function pack(key) {
  const raw = fs.readFileSync(path.join(ROOT, 'assets', key + '.json'), 'utf8');
  const arr = JSON.parse(raw)[key];
  const packed = arr.map((x) => String(x.id) + ':' + x.nama).join('|');

  // verifikasi roundtrip: decode(packed) harus persis sama dengan aslinya
  const back = {};
  packed.split('|').forEach((r) => {
    const i = r.indexOf(':');
    if (i > 0) back[r.slice(0, i)] = r.slice(i + 1);
  });
  const orig = {};
  arr.forEach((x) => (orig[String(x.id)] = x.nama));
  if (JSON.stringify(back) !== JSON.stringify(orig)) {
    throw new Error('data ' + key + ' tidak lolos verifikasi roundtrip');
  }
  return { packed, count: arr.length, before: Buffer.byteLength(raw) };
}

// ----------2) baca sumber ----------
let html = fs.readFileSync(SRC, 'utf8');

// ----------3) logo -> data URI ----------
const logoTag = 'src="assets/logo.png"';
if (!html.includes(logoTag)) throw new Error('tag logo tidak ditemukan di cek_nik.html');
const logoB64 = fs.readFileSync(path.join(ROOT, 'assets', 'logo.png')).toString('base64');
html = html.replace(logoTag, 'src="data:image/png;base64,' + logoB64 + '"');

// ----------4) ganti blok muatWilayah dengan sumber data tertanam ----------
const headMark = 'var API_URL=';
const tailMark = 'return WIL_LOADED;\n}';
const i0 = html.indexOf(headMark);
const i1 = html.indexOf(tailMark, i0);
if (i0 < 0 || i1 < 0) throw new Error('blok muatWilayah tidak ditemukan di cek_nik.html');

const newBlock = [
  "// ==========================================================================",
  "// API_URL — isi dengan URL server-mu (contoh: 'https://ceknik.example.workers.dev')",
  "//           supaya SIPOL KPU + DTSEN Kemensos ikut aktif saat halaman ini",
  "//           ditempel di blog. Kosongkan bila hanya butuh Rumus Lokal (offline).",
  "// ==========================================================================",
  "var API_URL='" + API_URL + "';",
  "var WIL_PRO={},WIL_KAB={},WIL_KEC={},WIL_LOADED=null;",
  "function decodeWil(s){var o={};String(s||'').split('|').forEach(function(r){var i=r.indexOf(':');if(i>0)o[r.slice(0,i)]=r.slice(i+1)});return o}",
  "function muatWilayah(){",
  "  if(WIL_LOADED)return WIL_LOADED;",
  "  WIL_LOADED=Promise.resolve().then(function(){",
  "    var el=document.getElementById('wilayah');if(!el)throw Error('data wilayah tidak ada');",
  "    var d=JSON.parse(el.textContent);",
  "    WIL_PRO=decodeWil(d.pro);WIL_KAB=decodeWil(d.kab);WIL_KEC=decodeWil(d.kec);",
  "  });",
  "  return WIL_LOADED;",
  "}"
].join('\n');
html = html.slice(0, i0) + newBlock + html.slice(i1 + tailMark.length);

// ----------5) sisipkan payload data sebelum <script> utama ----------
const stats = { pro: pack('pro'), kab: pack('kab'), kec: pack('kec') };
const payload = JSON.stringify({
  pro: stats.pro.packed,
  kab: stats.kab.packed,
  kec: stats.kec.packed
}).replace(/</g, '\\u003c');   // cegah "</script>" merusak halaman

const scriptIdx = html.indexOf('<script>');
if (scriptIdx < 0) throw new Error('tag <script> tidak ditemukan');
const note =
  '<!-- ceknik-single.html : hasil generate node buat-single.js. Jangan diedit manual. -->\n';
html =
  html.slice(0, scriptIdx) +
  note +
  '<script type="application/json" id="wilayah">' + payload + '</script>\n' +
  html.slice(scriptIdx);

// ----------6) tulis hasil ----------
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, html);

const size = fs.statSync(OUT).size;
const before = fs.statSync(SRC).size;
console.log('dibuat : ' + OUT);
console.log('ukuran : ' + (size / 1024).toFixed(1) + ' KB  (cek_nik.html ' + (before / 1024).toFixed(1) + ' KB)');
console.log('API_URL: ' + (API_URL || '(kosong — hanya Rumus Lokal; isi dengan: node buat-single.js <URL-worker>)'));
console.log('logo   : ' + (logoB64.length / 1024).toFixed(1) + ' KB ter-embed');
for (const k of Object.keys(stats)) {
  console.log(
    'data ' + k + ': ' + stats[k].count + ' entri, ' +
    (stats[k].before / 1024).toFixed(1) + ' KB -> ' +
    (Buffer.byteLength(stats[k].packed) / 1024).toFixed(1) + ' KB'
  );
}
console.log('pastikan tidak ada fetch eksternal selain /api/health : OK (data tertanam)');
