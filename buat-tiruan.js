// buat-tiruan.js — menyusun tes-tiru-sipol.html
//
// Ide: "telusuri tangan mereka lalu kita tiru". Skrip ini MENYALIN apa adanya
// CSS + markup + logika render halaman https://infopemilu.kpu.go.id/Pemilu/Cari_nik
// lalu menukar SATU bagian saja: transport $.ajax lintas-origin (yang diblokir CORS
// dari origin lain) menjadi fetch ke worker Cloudflare — datang lewat relai PC.
//
// Pakai:
//   curl -s https://infopemilu.kpu.go.id/Pemilu/Cari_nik -o /tmp/carinik.html
//   node buat-tiruan.js /tmp/carinik.html https://divine-fog-0a93.riacaya99.workers.dev
//   → menulis tes-tiru-sipol.html
const fs = require('fs');

const sumber = process.argv[2] || '/tmp/carinik.html';
const apiUrl = process.argv[3] || 'https://divine-fog-0a93.riacaya99.workers.dev';
const html = fs.readFileSync(sumber, 'utf8');
const lines = html.split(/\r?\n/);

// ---- 1) CSS: blok <style> yang memuat .search-card --------------------------
const iGaya = lines.findIndex((l) => l.includes('.search-card {'));
if (iGaya < 0) throw new Error('gaya .search-card tidak ditemukan — sumber berubah?');
let buka = iGaya;
while (buka > 0 && !lines[buka].includes('<style')) buka--;
let tutup = iGaya;
while (tutup < lines.length && !lines[tutup].includes('</style>')) tutup++;
const css = lines.slice(buka, tutup + 1).join('\n');

// ---- 2) MARKUP form (dari <!-- MAIN --> sampai sebelum <!-- JS -->) ---------
const iMulai = lines.findIndex((l) => l.includes('<!-- MAIN -->'));
const iAkhir = lines.findIndex((l, i) => i > iMulai && l.includes('<!-- JS -->'));
if (iMulai < 0 || iAkhir < 0) throw new Error('markup form tidak ditemukan');
const markup = lines.slice(iMulai, iAkhir).join('\n');

// ---- 3) JS inline (dari penanda BUILD PROGRESS DOTS sampai </script>) -------
const iJs = html.indexOf('/* ── BUILD PROGRESS DOTS');
if (iJs < 0) throw new Error('blok JS tidak ditemukan');
const iJsEnd = html.indexOf('</script>', iJs);
let js = html.slice(iJs, iJsEnd);

// ---- 4) Tukar $.ajax(...) dengan fetch ke worker ---------------------------
const iAjax = js.indexOf('$.ajax({');
if (iAjax < 0) throw new Error('$.ajax tidak ditemukan — struktur sumber berubah?');
let kedalaman = 0;
let iObj = -1;
for (let i = iAjax + 7; i < js.length; i++) {
  if (js[i] === '{') kedalaman++;
  else if (js[i] === '}') {
    kedalaman--;
    if (kedalaman === 0) { iObj = i; break; }
  }
}
if (iObj < 0) throw new Error('objek $.ajax tidak tertutup rapi');
const iAkhirPanggilan = js.indexOf(');', iObj) + 2;

const pengganti = [
  "    fetch(API_URL + '/api/check?nik=' + encodeURIComponent(nik))",
  "      .then(function(rsp) { return rsp.json().catch(function() { return { error: 'Respons server tidak terbaca.' }; }); })",
  '      .then(function(w) {',
  '        if (w.error) { renderResult(w, nik); return; }',
  '        var kpu = w.sumber && w.sumber.kpu;',
  '        if (!w.nama || !w.nama.found) {',
  "          if (kpu && kpu.state === 'error') {",
  "            document.getElementById('hasilSearch').innerHTML = '';",
  "            showAlert(w.galat && w.galat.length ? w.galat.join(' · ') : 'Gagal menghubungi server cek.');",
  '            return;',
  '          }',
  '          renderResult([], nik);',
  '          return;',
  '        }',
  '        renderResult([{',
  '          nik: w.nikMasked,',
  '          nama: w.nama.value,',
  '          nama_parpol: w.nama.partai,',
  '          jabatan: w.nama.jabatan,',
  '          unit: w.nama.unit,',
  '          tingkat_wilayah_kepengurusan: w.nama.tingkat,',
  '          nama_wilayah: w.nama.wilayah',
  '        }], nik);',
  '      })',
  '      .catch(function() {',
  "        document.getElementById('hasilSearch').innerHTML = '';",
  "        showAlert('Terjadi kesalahan pada server. Silakan coba lagi.');",
  '      })',
  '      .then(function() { setBtnLoading(false); });',
].join('\n');

js = js.slice(0, iAjax) + pengganti + js.slice(iAkhirPanggilan);
if (js.includes('$.ajax')) throw new Error('sisa $.ajax — patch gagal');

// ---- 5) Susun halaman ------------------------------------------------------
const keluar = [
  '<!DOCTYPE html>',
  '<html lang="id">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<title>Tes Tiruan Cek NIK — UI SIPOL KPU, data via worker+relai</title>',
  '<style>',
  '/* dasar minimal — padanan bootstrap yang sengaja tidak ikut disalin */',
  'body{margin:0;background:#eef2f7;font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1e293b}',
  '.container{max-width:680px;margin:0 auto;padding:24px 16px}',
  '/* ==== gaya asli KPU, disalin apa adanya ==== */',
  css,
  '</style>',
  '</head>',
  '<body>',
  '<div style="max-width:680px;margin:12px auto 0;padding:0 16px;font-size:12px;color:#64748b;line-height:1.5">',
  'Tiruan — CSS, markup, dan logika render disalin dari infopemilu.kpu.go.id/Pemilu/Cari_nik. ',
  'Perbedaan: permintaan diganti ke worker Cloudflare (data via relai PC); NIK di-mask oleh server, nama ditampilkan utuh.',
  '</div>',
  markup,
  '<script>',
  'var API_URL = ' + JSON.stringify(apiUrl) + ';',
  js,
  '</script>',
  '</body>',
  '</html>',
].join('\n');

fs.writeFileSync('tes-tiru-sipol.html', keluar, 'utf8');
console.log('tes-tiru-sipol.html ditulis:', keluar.length, 'karakter');
console.log('  css  :', css.length, 'karakter dari', lines[buka].trim().slice(0, 40));
console.log('  patch: $.ajax → fetch', js.includes('$.ajax') ? 'GAGAL' : 'OK');
