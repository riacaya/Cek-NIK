// serverpc.js — server lokal untuk mengetes HTML dari folder Downloads.
// Validasi struktur NIK dilakukan 100% di browser (data wilayah tertanam di cek_nik.html);
// server ini HANYA meneruskan nama pengurus/anggota parpol dari KPU SIPOL (data publik, nama utuh).
// Tanpa dependensi apa pun. Butuh Node >= 18 (fetch bawaan).
// Jalankan: klik ganda jalankan_server.bat  (atau: node server.js)  →  buka http://127.0.0.1:8788/
// Env opsional: PORT=8788  HOST=...  ROOT=...  KPU_URL=...
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 8788;
// HOST=0.0.0.0 dipakai bila di-deploy ke host cloud (Render/Fly/Koyeb dst.) yang
// butuh bind ke semua interface; default tetap 127.0.0.1 agar lokal tertutup.
const HOST = process.env.HOST || '127.0.0.1';
const KPU_URL = process.env.KPU_URL || 'https://infopemilu.kpu.go.id/Pemilu/Cari_nik_parpol/getDataFromAjx';
const BANSOS_URL = process.env.BANSOS_URL || 'https://cekbansos.kemensos.go.id';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
// Folder ikut lokasi file server.js, jadi boleh dipindah / di-copy ke mana pun
// (dulu di-hardcode D:/KTP — salah folder langsung semua file 404).
// Bisa ditimpa lewat env:  ROOT=D:/KTP  ASSETS_ROOT=D:/KTP/assets
const ROOT = process.env.ROOT ? path.resolve(process.env.ROOT) : __dirname;
// Token relai untuk worker blog (cloudflare-worker.js → KPU_RELAY). Ganti di DUA tempat
// bila ingin mengganti: env RELAY_TOKEN di sini dan ?t=... pada URL KPU_RELAY.
const RELAY_TOKEN = process.env.RELAY_TOKEN || 'ceknik-relay-2026';
// Relai HANYA boleh meneruskan ke host KPU — mencegah server ini dipakai proxy sembarangan.
const RELAY_HOST = /(^|\.)kpu\.go\.id$/;
const ASSETS_ROOT = process.env.ASSETS_ROOT ? path.resolve(process.env.ASSETS_ROOT) : path.join(ROOT, 'assets');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

// ---------- masking NIK (log tetap masked); nama publik KPU ditampilkan utuh ----------
function maskNik(nik) { return nik.slice(0, 6) + '********' + nik.slice(-4); }

// ---------- helper fetch dengan batas waktu ----------
async function req(url, opts = {}, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, Object.assign({}, opts, { signal: ctl.signal, redirect: 'follow' }));
    const text = await r.text();
    return { ok: r.ok, status: r.status, text };
  } catch (e) {
    return { ok: false, status: 0, error: String(e && e.message || e) };
  } finally { clearTimeout(t); }
}

// ---------- KPU SIPOL → nama pengurus/anggota parpol ----------
async function cekSipol(nik) {
  const kpu = await req(KPU_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer': 'https://infopemilu.kpu.go.id/Pemilu/Cari_nik',
    },
    body: 'input_ajx=' + encodeURIComponent(nik),
  }, 15000);

  const hasil = {
    nikMasked: maskNik(nik),
    nama: { found: false, value: null, partai: null, jabatan: null, unit: null },
    sumber: { kpu: { status: kpu.status || 0, state: 'error', jumlah: 0 } },
    galat: [],
  };

  if (kpu.ok) {
    try {
      const arr = JSON.parse(kpu.text);
      if (Array.isArray(arr)) {
        hasil.sumber.kpu.state = arr.length ? 'found' : 'empty';
        hasil.sumber.kpu.jumlah = arr.length;
        const r = arr[0] || {};
        hasil.nama = {
          found: !!r.nama,
          value: String(r.nama || '').trim() || null,
          partai: r.nama_parpol || null,
          jabatan: r.jabatan || null,
          unit: r.unit || r.nama_wilayah || null,
        };
      } else {
        hasil.sumber.kpu.state = 'bad';
        hasil.galat.push('kpu: respons bukan daftar');
      }
    } catch (e) {
      hasil.sumber.kpu.state = 'bad';
      hasil.galat.push('kpu: JSON tidak terbaca');
    }
  } else {
    hasil.galat.push('kpu: ' + (kpu.error || 'HTTP ' + kpu.status));
  }
  return hasil;
}

// ---------- Cek Bansos Kemensos (DTSEN) — dipakai test.html ----------
// Situs ini TIDAK mengirim header CORS (malah Cross-Origin-Resource-Policy: same-origin),
// sehingga halaman browser tidak boleh memanggilnya langsung; lewat server lokal inilah jalurnya.
// CAPTCHA tetap diselesaikan MANUSIA lewat gambar di test.html — tidak ada OCR / bypass di sini,
// dan satu kode captcha dipakai tepat satu kali (dihapus setelah dipakai).
const SESSIONS = new Map();          // id -> { token, cookie, t }
const SESSION_TTL = 5 * 60 * 1000;   // 5 menit

function setCookies(res) {
  if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie();
  const v = res.headers.get('set-cookie');
  return v ? v.split(/,(?=\s*[^;]+=)/) : [];
}
function mergeCookie(prev, res) {
  const jar = new Map();
  String(prev || '').split(';').map(s => s.trim()).filter(Boolean).forEach(p => {
    const i = p.indexOf('='); if (i > 0) jar.set(p.slice(0, i), p.slice(i + 1));
  });
  setCookies(res).forEach(c => {
    const first = String(c).split(';')[0]; const i = first.indexOf('=');
    if (i > 0) jar.set(first.slice(0, i).trim(), first.slice(i + 1));
  });
  return Array.from(jar.entries()).map(([k, v]) => k + '=' + v).join('; ');
}
async function bFetch(url, opts, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 20000);
  try { return await fetch(url, Object.assign({}, opts, { signal: ctl.signal })); }
  finally { clearTimeout(t); }
}
function gcSessions() {
  const now = Date.now();
  for (const [k, v] of SESSIONS) if (now - v.t > SESSION_TTL) SESSIONS.delete(k);
}

// 1) ambil halaman (cookie + token CSRF) lalu gambar CAPTCHA-nya
async function bansosCaptcha() {
  const home = await bFetch(BANSOS_URL + '/', {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'id-ID,id;q=0.9' },
  });
  if (!home.ok) throw new Error('halaman cekbansos HTTP ' + home.status);
  const html = await home.text();
  const cookie = mergeCookie('', home);
  const m = html.match(/name=["']csrf-token["']\s+content=["']([^"']+)["']/i) || html.match(/name=["']_token["']\s+value=["']([^"']+)["']/i);
  if (!m) throw new Error('token CSRF tidak ditemukan di halaman');

  const cap = await bFetch(BANSOS_URL + '/captcha/flat?' + Math.random().toString(36).slice(2), {
    headers: { 'User-Agent': UA, 'Cookie': cookie, 'Referer': BANSOS_URL + '/', 'Accept': 'image/*,*/*' },
  });
  if (!cap.ok) throw new Error('gambar captcha HTTP ' + cap.status);
  const mime = (cap.headers.get('content-type') || 'image/jpeg').split(';')[0];
  const buf = Buffer.from(await cap.arrayBuffer());
  if (buf.length < 100) throw new Error('gambar captcha kosong');

  gcSessions();
  const id = require('crypto').randomBytes(16).toString('hex');
  if (SESSIONS.size > 50) SESSIONS.delete(SESSIONS.keys().next().value);
  SESSIONS.set(id, { token: m[1], cookie: mergeCookie(cookie, cap), t: Date.now() });
  return { id, img: 'data:' + mime + ';base64,' + buf.toString('base64') };
}

// 2) POST /cekbansos_nik (captcha diisi manusia) -> 302 -> GET /hasil-nik -> parse tabel DTSEN
function parseHasil(html) {
  const tb = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (tb) {
    const trs = tb[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
    for (const tr of trs) {
      const cells = (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [])
        .map(c => c.replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ').trim());
      if (cells.length >= 11) return {
        state: 'found', nama: cells[0], desil: cells[1], dtsen: cells[2],
        sembako: { status: cells[3], periode: cells[4] },
        pkh: { status: cells[5], periode: cells[6] },
        pbi: { status: cells[7], periode: cells[8], ket: cells[9] },
        kpd: cells[10],
      };
    }
  }
  const alert = (html.match(/<div[^>]*class=["'][^"']*alert[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1];
  const pesan = alert ? alert.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
  return { state: 'empty', pesan: pesan || 'NIK tidak ditemukan dalam data DTSEN.' };
}

async function bansosCheck(id, nik, captcha) {
  gcSessions();
  const s = SESSIONS.get(id);
  if (!s) return { state: 'session', pesan: 'Sesi captcha kedaluwarsa — muat ulang captcha lalu ulangi.' };
  SESSIONS.delete(id); // satu captcha = satu percobaan

  const body = new URLSearchParams({ _token: s.token, nik_input: nik, captcha: captcha }).toString();
  const post = await bFetch(BANSOS_URL + '/cekbansos_nik', {
    method: 'POST', redirect: 'manual',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': s.cookie,
      'Origin': BANSOS_URL,
      'Referer': BANSOS_URL + '/',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    body,
  });
  const cookie = mergeCookie(s.cookie, post);
  await post.arrayBuffer().catch(() => {});   // buang body 302
  const loc = post.headers.get('location') || '';

  if (loc && !/hasil-nik/i.test(loc)) {
    return { state: 'captcha', pesan: 'Permintaan ditolak (kode captcha salah / sesi kedaluwarsa / NIK tidak diterima). Muat ulang captcha lalu coba lagi.' };
  }
  if (!loc) return { state: 'error', pesan: 'Respons tidak terduga dari cekbansos (HTTP ' + post.status + ').' };

  const r = await bFetch(new URL(loc, BANSOS_URL).href, {
    headers: { 'User-Agent': UA, 'Cookie': cookie, 'Referer': BANSOS_URL + '/', 'Accept': 'text/html,application/xhtml+xml' },
  });
  const html = await r.text();
  if (!r.ok) return { state: 'error', pesan: 'Gagal membaca hasil (HTTP ' + r.status + ').' };
  return Object.assign(parseHasil(html), { sumber: 'cekbansos.kemensos.go.id — DTSEN' });
}

// ---------- HTTP ----------
// Badan request dibungkus try/catch: satu error (mis. URL rusak /%zz) tidak boleh
// mematikan seluruh server. Dulu URIError di sini membuat proses crash total.
async function serve(rq, res) {
  const u = new URL(rq.url || '/', 'http://x');
  const cors = (r) => { r.setHeader('Access-Control-Allow-Origin', '*'); r.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); r.setHeader('Access-Control-Allow-Headers', 'Content-Type'); };
  const json = (code, obj) => { cors(res); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

  if (rq.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }
  if (u.pathname === '/api/health') return json(200, { ok: true, port: PORT });

  if (u.pathname === '/api/check') {
    const nik = (u.searchParams.get('nik') || '').trim();
    if (!/^\d{16}$/.test(nik)) return json(422, { error: 'NIK harus tepat 16 digit angka.' });
    try {
      const h = await cekSipol(nik);
      console.log(`[${new Date().toISOString()}] check nik=${maskNik(nik)} kpu=${h.sumber.kpu.state}`);
      return json(200, h);
    } catch (e) {
      return json(500, { error: 'server gagal: ' + String(e && e.message || e) });
    }
  }

  if (u.pathname === '/api/bansos/captcha') {
    try {
      const c = await bansosCaptcha();
      console.log(`[${new Date().toISOString()}] bansos captcha siap`);
      return json(200, { ok: true, id: c.id, img: c.img });
    } catch (e) {
      return json(502, { ok: false, error: 'captcha gagal: ' + String(e && e.message || e) });
    }
  }

  if (rq.method === 'POST' && u.pathname === '/api/bansos/check') {
    let raw = '';
    try {
      for await (const chunk of rq) { raw += chunk; if (raw.length > 4096) throw new Error('body terlalu besar'); }
      const b = JSON.parse(raw || '{}');
      const nik = String(b.nik || '').trim();
      const captcha = String(b.captcha || '').trim();
      const id = String(b.id || '').trim();
      if (!/^\d{16}$/.test(nik)) return json(422, { ok: false, error: 'NIK harus tepat 16 digit angka.' });
      if (!/^[A-Za-z0-9]{4,10}$/.test(captcha)) return json(422, { ok: false, error: 'Kode captcha tidak valid.' });
      const h = await bansosCheck(id, nik, captcha);
      console.log(`[${new Date().toISOString()}] bansos nik=${maskNik(nik)} state=${h.state}`);
      // NIK ditampilkan utuh ke pemiliknya (ia sendiri yang mengetiknya); log server tetap masked.
      // Nama TIDAK bisa dibuka: situs sudah mengirimnya berbintang di HTML (P******O).
      return json(200, Object.assign({ ok: true, nik: nik }, h));
    } catch (e) {
      return json(500, { ok: false, error: 'server gagal: ' + String(e && e.message || e) });
    }
  }

  // ---------- Relai SIPOL untuk worker Cloudflare ----------
  // Firewall KPU menolak IP datacenter (Cloudflare & Google), tapi IP PC ini diterima.
  // Kontrak: worker POST JSON {url, body, headers} → dibalas {status, text} (kontrak sama
  // dengan gas-relay.js, jadi worker tidak perlu diubah, cukup isi KPU_RELAY).
  if (rq.method === 'POST' && u.pathname === '/relay') {
    if (u.searchParams.get('t') !== RELAY_TOKEN) return json(403, { error: 'token relai salah' });
    let raw = '';
    try {
      for await (const chunk of rq) { raw += chunk; if (raw.length > 65536) throw new Error('body terlalu besar'); }
    } catch (e) { return json(413, { error: String(e && e.message || e) }); }
    let p;
    try { p = JSON.parse(raw || '{}'); } catch (_) { return json(400, { error: 'JSON tidak valid' }); }
    let tu;
    try { tu = new URL(String(p.url || '')); } catch (_) { return json(400, { error: 'url tidak valid' }); }
    if (tu.protocol !== 'https:' || !RELAY_HOST.test(tu.hostname)) return json(400, { error: 'hanya host *.kpu.go.id yang boleh lewat relai' });
    const hdrs = {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'user-agent': UA,
    };
    if (p.headers && typeof p.headers === 'object') {
      for (const k of Object.keys(p.headers).slice(0, 20)) hdrs[String(k).toLowerCase()] = String(p.headers[k]).slice(0, 500);
    }
    const fwd = await req(tu.href, { method: 'POST', headers: hdrs, body: String(p.body || '') }, 15000);
    console.log(`[${new Date().toISOString()}] relai ${tu.hostname} → ${fwd.status || fwd.error}`);
    return json(200, fwd.status ? { status: fwd.status, text: fwd.text } : { status: 0, text: '', error: fwd.error || 'gagal' });
  }

  if (u.pathname.startsWith('/api/')) return json(404, { error: 'not found' });

  // statis: / → cek_nik.html, sisanya file relatif (tolak traversal)
  let rel;
  try { rel = decodeURIComponent(u.pathname === '/' ? '/cek_nik.html' : u.pathname); }
  catch (_) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('400'); return; }
  // file tersembunyi (.env, .git/, .htpasswd, dst) tidak boleh ikut tersaji
  if (rel.split('/').some((s) => s.startsWith('.'))) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('forbidden'); return; }
  const base = rel.startsWith('/assets/') ? ASSETS_ROOT : ROOT;
  const file = path.normalize(path.join(base, rel.startsWith('/assets/') ? rel.slice('/assets/'.length) : rel));
  const safeBase = path.resolve(base);
  if (!path.resolve(file).startsWith(safeBase + path.sep) && path.resolve(file) !== safeBase) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}

const server = http.createServer((rq, res) => {
  res.on('error', () => {});   // klien menutup koneksi mendadak ≠ alasan mematikan server
  serve(rq, res).catch((e) => {
    console.error(`[${new Date().toISOString()}] gagal melayani:`, (e && e.message) || e);
    try {
      if (!res.headersSent) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      }
      if (!res.writableEnded) res.end(JSON.stringify({ error: 'server gagal: ' + ((e && e.message) || e) }));
    } catch (_) { /* koneksi sudah mati, biarkan */ }
  });
});

// ---------- penjaga: dulu semua ini membuat proses mati total ----------
server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.error('');
    console.error('  Port ' + PORT + ' sudah dipakai — kemungkinan server ini sudah berjalan.');
    console.error('  Buka saja http://127.0.0.1:' + PORT + '/ , atau tutup program lain di port itu.');
    console.error('  Ingin port lain:  set PORT=' + (PORT + 1) + '  lalu jalankan ulang.');
    console.error('');
  } else if (e && e.code === 'EACCES') {
    console.error('\n  Tidak diizinkan memakai port ' + PORT + '. Coba: set PORT=8787\n');
  } else {
    console.error('[server] gagal listen:', (e && e.message) || e);
  }
  process.exit(1);
});

server.on('clientError', (err, socket) => {
  try { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); } catch (_) {}
});

// Error yang lolos dari mana pun dicatat, tapi server tetap hidup melayani.
process.on('uncaughtException', (e) => console.error(`[${new Date().toISOString()}] exception:`, (e && e.stack) || e));
process.on('unhandledRejection', (e) => console.error(`[${new Date().toISOString()}] rejection:`, (e && e.stack) || e));
process.stdout.on('error', () => {});   // jangan crash bila jendela konsol ditutup mendadak
process.on('SIGINT', () => { console.log('\nServer dihentikan. Sampai jumpa!'); process.exit(0); });

server.listen(PORT, HOST, () => {
  console.log('cek-nik mini server → http://' + HOST + ':' + server.address().port + '/');
  console.log('  root     : ' + ROOT);
  console.log('  nama SIPOL : ' + KPU_URL);
  console.log('  struktur   : di browser (data tertanam di cek_nik.html)');
  console.log('  berhenti   : tekan Ctrl+C di jendela ini');
});
