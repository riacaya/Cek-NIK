/**
 * cloudflare-worker.js — API Cek NIK (SIPOL KPU + DTSEN Kemensos) untuk Cloudflare Workers.
 * Dipakai oleh single/ceknik-single.html ketika ditempel di blog: isi var API_URL dengan URL worker ini.
 *
 * CARA DEPLOY (±3 menit, tanpa terminal):
 *   1. Buka https://dash.cloudflare.com → Workers & Pages → Create → Create Worker
 *   2. Beri nama (mis. ceknik) → Deploy
 *   3. Klik "Edit code" → hapus isi bawaan → tempel SELURUH isi file ini → Deploy
 *   4. Catat URL: https://ceknik.<username>.workers.dev
 *   5. Uji: buka <URL>/api/health  lalu <URL>/api/selftest?nik=3175010101900001
 *   6. Generate ulang file single dengan API terisi:
 *        node buat-single.js https://ceknik.<username>.workers.dev
 *      lalu tempel isi single/ceknik-single.html ke blog (mode HTML).
 *
 * Endpoint (semua membalas dengan header CORS):
 *   GET  /api/health                 → cek hidup
 *   GET  /api/check?nik=16digit      → SIPOL KPU (format JSON sama dengan server.js)
 *   GET  /api/bansos/captcha         → gambar captcha DTSEN
 *   POST /api/bansos/check {id, nik, captcha} → hasil DTSEN
 *   GET  /api/selftest?nik=          → diagnosa langkah demi langkah
 *
 * Catatan desain: sesi captcha disimpan STATELESS di token `id` (base64 JSON berisi
 * token CSRF + cookie), dikirim balik oleh halaman. Jadi tidak perlu KV / database.
 */

const KPU_URL = 'https://infopemilu.kpu.go.id/Pemilu/Cari_nik_parpol/getDataFromAjx';
const KPU_REFERER = 'https://infopemilu.kpu.go.id/Pemilu/Cari_nik';
const BANSOS = 'https://cekbansos.kemensos.go.id';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// --- Firewall KPU menolak IP Cloudflare DAN Google (terbukti lewat ?ping=1 di GAS),
// tapi menerima IP PC pengguna. KPU_RELAY = relai di PC via tunnel (jalankan_relay.bat):
// server.js /relay menerima POST JSON {url, body, headers}, memanggil KPU dari IP PC,
// membalas {status, text}. Selama PC relay mati worker tetap melayani: SIPOL gagal jujur,
// DTSEN tetap jalan. Kosongkan bila tidak ada relai. (Kontrak sama dengan gas-relay.js.)
const KPU_RELAY = 'https://ceknik-relay-3311.loca.lt/relay?t=ceknik-relay-2026';
const KPU_TIMEOUT = 18000;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      ...CORS,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

// ---------------------------------------------------------------- http helper
async function call(url, opts) {
  const o = opts || {};
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeout || 20000);
  try {
    const h = { 'user-agent': UA, 'accept-language': 'id-ID,id;q=0.9', ...(o.headers || {}) };
    if (o.contentType) h['content-type'] = o.contentType;
    if (o.cookie) h.cookie = o.cookie;
    const r = await fetch(url, {
      method: o.method || 'GET',
      headers: h,
      body: o.body || undefined,
      redirect: o.follow === false ? 'manual' : 'follow',
      signal: ctl.signal,
    });
    let setCookies = [];
    if (typeof r.headers.getSetCookie === 'function') setCookies = r.headers.getSetCookie();
    else if (r.headers.get('set-cookie')) setCookies = [r.headers.get('set-cookie')];
    const buf = await r.arrayBuffer();
    return {
      code: r.status,
      bytes: buf,
      text: new TextDecoder().decode(buf),
      setCookies,
      location: r.headers.get('location'),
      header: (n) => r.headers.get(n),
    };
  } finally {
    clearTimeout(timer);
  }
}

function mergeCookies(prev, setCookies) {
  const jar = new Map();
  String(prev || '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.includes('='))
    .forEach((p) => {
      const i = p.indexOf('=');
      jar.set(p.slice(0, i).trim(), p.slice(i + 1).trim());
    });
  (setCookies || []).forEach((c) => {
    const first = String(c).split(';')[0];
    const i = first.indexOf('=');
    if (i > 0) jar.set(first.slice(0, i).trim(), first.slice(i + 1).trim());
  });
  return jar.size ? Array.from(jar.entries()).map(([k, v]) => k + '=' + v).join('; ') : null;
}

function toB64(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH));
  return btoa(s);
}

function encState(o) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/=+$/, '');
}
function decState(s) {
  return JSON.parse(decodeURIComponent(escape(atob(s))));
}

function maskNik(nik) { return nik.slice(0, 6) + '********' + nik.slice(-4); }
function extractToken(html) {
  const a = html.match(/name=["']csrf-token["']\s+content=["']([^"']+)["']/i) ||
    html.match(/name=["']_token["']\s+value=["']([^"']+)["']/i);
  return a ? a[1] : null;
}

// ------------------------------------------------------------------ 1) SIPOL
async function kpuFetch(nik, timeout) {
  const t0 = Date.now();
  const r = await call(KPU_URL, {
    method: 'POST',
    body: 'input_ajx=' + encodeURIComponent(nik),
    contentType: 'application/x-www-form-urlencoded; charset=UTF-8',
    headers: {
      referer: KPU_REFERER,
      origin: 'https://infopemilu.kpu.go.id',
      'x-requested-with': 'XMLHttpRequest',
      accept: 'application/json, text/javascript, */*; q=0.01',
    },
    timeout: timeout || KPU_TIMEOUT,
  });
  if (r.code < 200 || r.code >= 300) throw new Error('HTTP ' + r.code);
  return { text: r.text, ms: Date.now() - t0, status: r.code };
}

async function kpuViaRelay(nik) {
  const t0 = Date.now();
  let r = null;
  let err = null;
  // Maksimal 4 percobaan: kegagalan CEPAT (<7 dtk — flap sesaat edge localtunnel:
  // 400/502/503 sering muncul ~1 menit pertama setelah tunnel bangun) diulang;
  // kegagalan LAMBAT berarti tunnel/PC relay benar-benar mati — buang waktu kalau diulang.
  for (let percobaan = 0; percobaan < 4; percobaan++) {
    const tA = Date.now();
    try {
      r = await call(KPU_RELAY, {
        method: 'POST',
        // Catatan: localtunnel menampilkan halangan (HTTP 511) ke request ber-User-Agent
        // browser — maka UA ke tunnel dibuat non-browser. Header di dalam JSON di bawah
        // tetap yang diteruskan ke KPU.
        headers: { 'user-agent': 'ceknik-worker-relay/1.0' },
        body: JSON.stringify({
          url: KPU_URL,
          body: 'input_ajx=' + encodeURIComponent(nik),
          headers: { referer: KPU_REFERER, origin: 'https://infopemilu.kpu.go.id', 'x-requested-with': 'XMLHttpRequest', accept: 'application/json' },
        }),
        contentType: 'application/json',
        timeout: KPU_TIMEOUT,
      });
      const code = r.code;
      if (code >= 200 && code < 300) break;
      r = null;
      err = new Error('relai HTTP ' + code);
    } catch (e) {
      r = null;
      err = e;
    }
    if (Date.now() - tA >= 7000) break;
    if (percobaan < 3) await new Promise((res) => setTimeout(res, 600));
  }
  if (!r) throw err || new Error('relai gagal');
  let j = null;
  try { j = JSON.parse(r.text); } catch (_) { /* balasan bukan JSON */ }
  const text = j && typeof j.text === 'string' ? j.text : r.text;
  // status upstream KPU dari amplop relai (bukan status HTTP tunnel-nya):
  // bila KPU membalas 500 (Database Error) lampirkan apa adanya — jangan dianggap sukses.
  const status = j && typeof j.status === 'number' ? j.status : r.code;
  return { text, ms: Date.now() - t0, jalur: 'relai', status: status };
}

async function sipol(nik) {
  const out = { nikMasked: maskNik(nik), galat: [] };
  const kpu = { status: 0, state: 'error', jumlah: 0 };
  const nama = { found: false };
  let data = null;

  // Relai didahulukan bila dikonfigurasi: uji langsung dari IP Cloudflare justru
  // menunggu ±18 dtk sebelum diblokir → tiap cek jadi lambat. Langsung tetap cadangan.
  if (KPU_RELAY) {
    try {
      data = await kpuViaRelay(nik);
      kpu.jalur = 'relai';
      out.galat.length = 0;
    } catch (e) {
      out.galat.push('relai: ' + ((e && e.message) || e));
    }
  }
  if (!data) {
    try {
      data = await kpuFetch(nik, KPU_RELAY ? 6000 : KPU_TIMEOUT);
      out.galat.length = 0; // langsung berhasil → galat (bila ada) dihapus
    } catch (e) {
      out.galat.push('kpu: ' + ((e && e.message) || e));
    }
  }

  if (data) {
    kpu.status = data.status || 200;
    if (kpu.status < 200 || kpu.status >= 300) {
      // KPU membalas error (mis. 500 Database Error) — bukan salah parser.
      kpu.state = 'bad';
      out.galat.push('kpu: server KPU HTTP ' + kpu.status);
    } else {
      try {
        const arr = JSON.parse(data.text);
        if (!Array.isArray(arr)) throw new Error('bukan daftar');
        kpu.state = arr.length ? 'found' : 'empty';
        kpu.jumlah = arr.length;
        kpu.ms = data.ms;
        if (arr.length) {
          const r0 = arr[0] || {};
          const n = String(r0.nama || '').trim();
          nama.found = !!n;
          if (n) nama.value = n; // nama SIPOL publik — ditampilkan utuh (tanpa bintang)
          if (r0.nama_parpol) nama.partai = r0.nama_parpol;
          if (r0.jabatan) nama.jabatan = r0.jabatan;
          const unit = r0.unit || r0.nama_wilayah;
          if (unit) nama.unit = unit;
          // Untuk tiruan kartu SIPOL (tes-tiru-sipol.html meniru halaman KPU persis):
          if (r0.tingkat_wilayah_kepengurusan) nama.tingkat = r0.tingkat_wilayah_kepengurusan;
          if (r0.nama_wilayah) nama.wilayah = r0.nama_wilayah;
        }
      } catch (e) {
        kpu.state = 'bad';
        out.galat.push('kpu: JSON tidak terbaca');
      }
    }
  }
  out.nama = nama;
  out.sumber = { kpu };
  return out;
}

// ------------------------------------------------------- 2) CAPTCHA DTSEN
async function bansosCaptcha() {
  const home = await call(BANSOS + '/', { headers: { accept: 'text/html,application/xhtml+xml' } });
  if (home.code !== 200) throw new Error('halaman cekbansos HTTP ' + home.code);
  let cookie = mergeCookies(null, home.setCookies);
  if (!cookie) throw new Error('cekbansos tidak memberi cookie (kemungkinan IP diblokir)');
  const token = extractToken(home.text);
  if (!token) throw new Error('token CSRF tidak ditemukan di halaman');

  const cap = await call(BANSOS + '/captcha/flat?' + Date.now().toString(36), {
    cookie,
    headers: { referer: BANSOS + '/', accept: 'image/*,*/*' },
  });
  if (cap.code !== 200) throw new Error('gambar captcha HTTP ' + cap.code);
  if (cap.bytes.byteLength < 100) throw new Error('gambar captcha kosong');

  const mime = (cap.header('content-type') || 'image/jpeg').split(';')[0];
  cookie = mergeCookies(cookie, cap.setCookies) || cookie;
  return { ok: true, id: encState({ token, cookie }), img: 'data:' + mime + ';base64,' + toB64(cap.bytes) };
}

// --------------------------------------------------------- 3) CEK DTSEN
function stripTags(s) {
  return String(s).replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ').trim();
}
function parseHasil(html) {
  const tb = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (tb) {
    const trs = tb[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
    for (const tr of trs) {
      const cells = (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(stripTags);
      if (cells.length >= 11) {
        return {
          state: 'found',
          nama: cells[0], desil: cells[1], dtsen: cells[2],
          sembako: { status: cells[3], periode: cells[4] },
          pkh: { status: cells[5], periode: cells[6] },
          pbi: { status: cells[7], periode: cells[8], ket: cells[9] },
          kpd: cells[10],
        };
      }
    }
  }
  const alert = html.match(/<div[^>]*class=["'][^"']*alert[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  const pesan = alert ? stripTags(alert[1]) : '';
  return { state: 'empty', pesan: pesan || 'NIK tidak ditemukan dalam data DTSEN.' };
}

async function bansosCheck(id, nik, captcha) {
  let st;
  try {
    st = decState(id);
  } catch (e) {
    return { state: 'session', pesan: 'Sesi captcha tidak terbaca — muat ulang captcha lalu ulangi.' };
  }
  if (!st || !st.token || !st.cookie) {
    return { state: 'session', pesan: 'Sesi captcha kedaluwarsa — muat ulang captcha lalu ulangi.' };
  }

  const body = '_token=' + encodeURIComponent(st.token) +
    '&nik_input=' + encodeURIComponent(nik) +
    '&captcha=' + encodeURIComponent(captcha);

  const post = await call(BANSOS + '/cekbansos_nik', {
    method: 'POST',
    body,
    contentType: 'application/x-www-form-urlencoded',
    cookie: st.cookie,
    headers: {
      origin: BANSOS,
      referer: BANSOS + '/',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    follow: false, // 302 harus dibaca dulu (persis server.js)
  });
  const cookie = mergeCookies(st.cookie, post.setCookies) || st.cookie;
  const loc = post.location;
  if (!loc) return { state: 'error', pesan: 'Respons tidak terduga dari cekbansos (HTTP ' + post.code + ').' };
  if (!/hasil-nik/i.test(loc)) {
    return {
      state: 'captcha',
      pesan: 'Permintaan ditolak (kode captcha salah / sesi kedaluwarsa / NIK tidak diterima). ' +
        'Muat ulang captcha lalu coba lagi.',
    };
  }

  const target = new URL(loc, BANSOS + '/').toString();
  const r = await call(target, {
    cookie,
    headers: { referer: BANSOS + '/', accept: 'text/html,application/xhtml+xml' },
  });
  if (r.code < 200 || r.code >= 300) return { state: 'error', pesan: 'Gagal membaca hasil (HTTP ' + r.code + ').' };
  return Object.assign(parseHasil(r.text), { sumber: 'cekbansos.kemensos.go.id — DTSEN' });
}

// -------------------------------------------------------------- SELFTEST
async function selftest(nik) {
  const target = /^\d{16}$/.test(nik || '') ? nik : '3175010101900001';
  const langkah = [];

  // --- KPU: relai dulu bila dikonfigurasi (firewall KPU menolak IP Cloudflare),
  //     lalu uji langsung sebagai pembanding.
  let relayOk = false;
  if (KPU_RELAY) {
    const t = Date.now();
    try {
      const d = await kpuViaRelay(target);
      relayOk = true;
      let arr = null;
      try { arr = JSON.parse(d.text); } catch (_) { /* bukan JSON */ }
      langkah.push({
        nama: 'Relai KPU (KPU_RELAY)',
        ok: Array.isArray(arr),
        detail: d.ms + ' ms, jalur=' + d.jalur +
          (Array.isArray(arr) ? ', daftar JSON ' + arr.length + ' baris' : ', balasan: ' + String(d.text).slice(0, 120)),
      });
    } catch (e) {
      langkah.push({
        nama: 'Relai KPU (KPU_RELAY)', ok: false,
        detail: String((e && e.message) || e) + ' (' + (Date.now() - t) +
          ' ms) — apakah jalankan_relay.bat di PC masih hidup?',
      });
    }
  }

  const tHost = Date.now();
  let hostOk = false;
  try {
    const r = await call('https://infopemilu.kpu.go.id/', { headers: { accept: 'text/html' }, timeout: 8000 });
    hostOk = r.code >= 200 && r.code < 400;
    langkah.push({
      nama: 'Host KPU dijangkau langsung (GET /)', ok: hostOk,
      detail: 'HTTP ' + r.code + ' dalam ' + (Date.now() - tHost) + ' ms',
    });
  } catch (e) {
    langkah.push({
      nama: 'Host KPU dijangkau langsung (GET /)', ok: relayOk,
      detail: String((e && e.message) || e) + ' — ' + (Date.now() - tHost) + ' ms. ' +
        (relayOk
          ? 'IP Cloudflare diblokir firewall KPU (wajar) — data diperoleh lewat relai.'
          : 'Koneksi diblokir/timeout: firewall KPU menolak IP Cloudflare dan relai belum disiapkan.'),
    });
  }

  if (hostOk) {
    const t = Date.now();
    try {
      const d = await kpuFetch(target);
      langkah.push({ nama: 'POST data SIPOL diterima', ok: true, detail: d.ms + ' ms' });
      try {
        const arr = JSON.parse(d.text);
        langkah.push({
          nama: 'Balasan berupa daftar JSON', ok: Array.isArray(arr),
          detail: Array.isArray(arr)
            ? arr.length + ' baris' + (arr.length === 0 ? ' (0 = NIK ini tidak terdaftar parpol — itu normal)' : '')
            : String(d.text).slice(0, 150),
        });
      } catch (e) {
        langkah.push({ nama: 'Balasan berupa daftar JSON', ok: false, detail: String(d.text).slice(0, 150) });
      }
    } catch (e) {
      langkah.push({
        nama: 'POST data SIPOL diterima', ok: false,
        detail: String((e && e.message) || e) + ' (' + (Date.now() - t) + ' ms)',
      });
    }
  } else {
    langkah.push({
      nama: 'POST data SIPOL (langsung)', ok: relayOk,
      detail: relayOk ? 'dilewati — data sudah diperoleh lewat relai' : 'dilewati — host KPU tidak terjangkau',
    });
  }

  if (!KPU_RELAY && !hostOk) {
    langkah.push({
      nama: 'Relai KPU (KPU_RELAY)', ok: false,
      detail: 'belum dikonfigurasi — isi KPU_RELAY dengan URL relai agar SIPOL tetap jalan lewat IP lain',
    });
  }

  // 2) cekbansos
  const tBan = Date.now();
  try {
    const h = await call(BANSOS + '/', { headers: { accept: 'text/html,application/xhtml+xml' } });
    langkah.push({ nama: '4. cekbansos dijangkau', ok: h.code === 200, detail: 'HTTP ' + h.code + ' dalam ' + (Date.now() - tBan) + ' ms' });
    const cookie = mergeCookies(null, h.setCookies);
    const token = extractToken(h.text);
    langkah.push({
      nama: '5. Cookie & token CSRF diterima',
      ok: !!cookie && !!token,
      detail: cookie ? (token ? 'lengkap — captcha siap diminta' : 'cookie ada, token tidak ditemukan') : 'tidak ada cookie (situs memblokir IP ini)',
    });
  } catch (e) {
    langkah.push({ nama: '4. cekbansos dijangkau', ok: false, detail: String((e && e.message) || e) });
  }

  const gagal = langkah.filter((l) => !l.ok).length;
  langkah.forEach((l, i) => { l.nama = (i + 1) + '. ' + l.nama.replace(/^\d+\.\s*/, ''); });
  return {
    ok: gagal === 0,
    nik: target,
    kesimpulan: gagal === 0
      ? 'Semua jalur sehat — SIPOL & DTSEN siap dipakai dari halaman blog.'
      : gagal + ' langkah gagal — lihat detail di bawah.',
    langkah,
  };
}

// ---------------------------------------------------------------- ROUTER
export default {
  async fetch(request) {
    const url = new URL(request.url);
    // normalkan path: "//api/health" dan "/api/health/" tetap dianggap /api/health,
    // supaya API_URL yang ditempel lengkap dengan "/" di belakang tidak merusak routing.
    let path = url.pathname.replace(/\/{2,}/g, '/');
    if (path.length > 1) path = path.replace(/\/+$/, '');
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

      if (path === '/api/health') {
        return json({ ok: true, service: 'ceknik-worker', time: new Date().toISOString() });
      }

      if (path === '/api/check') {
        const nik = (url.searchParams.get('nik') || '').trim();
        if (!/^\d{16}$/.test(nik)) return json({ error: 'NIK harus tepat 16 digit angka.' }, 422);
        return json(await sipol(nik));
      }

      if (path === '/api/bansos/captcha') {
        try {
          return json(await bansosCaptcha());
        } catch (e) {
          return json({ ok: false, error: 'captcha gagal: ' + ((e && e.message) || e) }, 502);
        }
      }

      if (path === '/api/bansos/check' && request.method === 'POST') {
        let b;
        try {
          const raw = await request.text();
          if (raw.length > 8192) return json({ ok: false, error: 'body terlalu besar' }, 413);
          b = JSON.parse(raw || '{}');
        } catch (e) {
          return json({ ok: false, error: 'body bukan JSON yang valid' }, 400);
        }
        const nik = String(b.nik || '').trim();
        const captcha = String(b.captcha || '').trim();
        const id = String(b.id || '');
        if (!/^\d{16}$/.test(nik)) return json({ ok: false, error: 'NIK harus tepat 16 digit angka.' }, 422);
        if (!/^[A-Za-z0-9]{4,10}$/.test(captcha)) return json({ ok: false, error: 'Kode captcha tidak valid.' }, 422);
        if (id.length > 8000) return json({ ok: false, error: 'sesi captcha tidak valid.' }, 422);
        try {
          const h = await bansosCheck(id, nik, captcha);
          return json(Object.assign({ ok: true, nik }, h));
        } catch (e) {
          return json({ ok: false, error: 'server gagal: ' + ((e && e.message) || e) }, 500);
        }
      }

      if (path === '/api/selftest') {
        return json(await selftest(url.searchParams.get('nik') || ''));
      }

      if (path.startsWith('/api/')) return json({ error: 'not found' }, 404);

      return json({
        ok: true,
        service: 'Cek NIK API (SIPOL KPU + DTSEN Kemensos)',
        endpoint: ['/api/health', '/api/check?nik=16digit', '/api/bansos/captcha', '/api/bansos/check (POST)', '/api/selftest?nik='],
        cara_pakai: "Isi URL ini ke var API_URL di cek_nik.html, lalu jalankan: node buat-single.js <URL>",
      });
    } catch (e) {
      return json({ error: 'server gagal: ' + ((e && e.message) || e) }, 500);
    }
  },
};
