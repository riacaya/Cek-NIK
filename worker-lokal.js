// worker-lokal.js — menjalankan cloudflare-worker.js SECARA LOKAL di http://127.0.0.1:8789
//
// Tujuan: menguji API (SIPOL + DTSEN) persis seperti perilakunya di Cloudflare,
// sebelum file di-deploy. Kodenya worker yang sama, cuma dibungkus http server.
//
// Jalankan : node worker-lokal.js
// Uji      : http://127.0.0.1:8789/api/health
//            http://127.0.0.1:8789/api/selftest?nik=3175010101900001
//            node buat-single.js http://127.0.0.1:8789   (biar halaman single memakai ini)
//
// Catatan: server.js (port 8788) melayani halaman + API versi PC.
//          worker-lokal.js (port 8789) hanya menyalakan API versi cloud.
const fs = require('fs');
const http = require('http');
const path = require('path');

const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 8789;
const SKIP = new Set(['host', 'connection', 'content-length', 'transfer-encoding']);

async function main() {
  const src = fs.readFileSync(path.join(__dirname, 'cloudflare-worker.js'), 'utf8');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
  const worker = mod.default;

  http
    .createServer(async (req, res) => {
      try {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = Buffer.concat(chunks);
        const headers = {};
        for (const k in req.headers) if (!SKIP.has(k)) headers[k] = req.headers[k];

        const r = await worker.fetch(
          new Request('http://127.0.0.1:' + PORT + req.url, {
            method: req.method,
            headers,
            body: body.length ? body : undefined,
          })
        );
        const out = {};
        r.headers.forEach((v, k) => { out[k] = v; });
        res.writeHead(r.status, out);
        res.end(Buffer.from(await r.arrayBuffer()));
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
        res.end(JSON.stringify({ error: String((e && e.message) || e) }));
      }
    })
    .listen(PORT, '127.0.0.1', () => {
      console.log('worker lokal → http://127.0.0.1:' + PORT + '/');
      console.log('  uji : /api/health   /api/selftest   /api/check?nik=16digit');
      console.log('  hubungkan halaman single:  node buat-single.js http://127.0.0.1:' + PORT);
    });
}

main().catch((e) => {
  console.error('gagal menjalankan worker:', e);
  process.exit(1);
});
