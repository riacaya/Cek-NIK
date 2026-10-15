package com.riacaya.ceknik

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.util.concurrent.Executors

/**
 * Server HTTP loopback (127.0.0.1) yang menyajikan assets/index.html + API,
 * sehingga cek_nik.html berjalan persis seperti di PC (node server.js):
 * - GET  /api/health
 * - GET  /api/check?nik=...          → SIPOL KPU
 * - GET  /api/bansos/captcha         → gambar captcha DTSEN
 * - POST /api/bansos/check           → hasil DTSEN
 * - selain itu file statis dari assets/
 */
class LocalServer(private val context: Context, private val preferredPort: Int = DEFAULT_PORT) {

    companion object {
        const val DEFAULT_PORT = 8789
        private const val TAG = "CekNIK"
    }

    /** Port yang benar-benar terpakai (fallback bila port utama sibuk). */
    var port: Int = preferredPort
        private set

    private val api = ApiProxy()
    private var server: ServerSocket? = null
    private var thread: Thread? = null
    private val pool = Executors.newCachedThreadPool { r ->
        Thread(r, "CekNIK-http").apply { isDaemon = true }
    }

    fun start(): Boolean {
        if (server != null) return true
        var sock: ServerSocket? = null
        for (p in preferredPort until preferredPort + 12) {
            try {
                sock = ServerSocket(p, 50, InetAddress.getByName("127.0.0.1"))
                port = p
                break
            } catch (_: Exception) {
            }
        }
        if (sock == null) {
            Log.e(TAG, "semua port lokal sibuk ($preferredPort..${preferredPort + 11})")
            return false
        }
        server = sock
        thread = Thread {
            while (!Thread.currentThread().isInterrupted) {
                try {
                    val s = sock.accept()
                    pool.execute { handle(s) }   // koneksi paralel: API lambat tak memblokir aset
                } catch (_: Exception) {
                    break
                }
            }
        }.apply {
            isDaemon = true
            name = "CekNIK-accept"
            start()
        }
        Log.i(TAG, "server loopback siap di 127.0.0.1:$port")
        return true
    }

    fun stop() {
        try { server?.close() } catch (_: Exception) {
        }
        thread?.interrupt()
        pool.shutdownNow()
        server = null
    }

    // ------------------------------------------------------------ request
    private fun handle(socket: Socket) {
        socket.use { s ->
            try {
                s.soTimeout = 30000
                val input = BufferedInputStream(s.getInputStream())
                val output = BufferedOutputStream(s.getOutputStream())
                val requestLine = readLine(input) ?: return
                val parts = requestLine.split(" ")
                val method = (parts.getOrNull(0) ?: "GET").uppercase()
                val rawPath = parts.getOrNull(1) ?: "/"

                var contentLength = 0
                while (true) {
                    val line = readLine(input) ?: break
                    if (line.isEmpty()) break
                    val i = line.indexOf(':')
                    if (i > 0 && line.substring(0, i).trim().equals("content-length", true)) {
                        contentLength = line.substring(i + 1).trim().toIntOrNull() ?: 0
                    }
                }
                val body = if (contentLength > 0) readBody(input, minOf(contentLength, 16 * 1024)) else ByteArray(0)
                route(method, rawPath, body, output)
            } catch (e: Exception) {
                Log.e(TAG, "gagal melayani request", e)
            }
        }
    }

    private fun route(method: String, rawPath: String, body: ByteArray, out: BufferedOutputStream) {
        val path = try {
            URLDecoder.decode(rawPath.substringBefore('?'), "UTF-8")
        } catch (_: Exception) {
            rawPath.substringBefore('?')
        }

        when {
            method == "OPTIONS" -> respond(out, 204, "text/plain", ByteArray(0))

            path == "/api/health" -> json(
                out, 200,
                JSONObject().put("ok", true).put("server", "android").put("port", port).toString()
            )

            path == "/api/check" -> {
                val nik = rawPath.substringAfter("nik=", "").substringBefore('&')
                if (!Regex("\\d{16}").matches(nik)) {
                    json(out, 422, JSONObject().put("error", "NIK harus tepat 16 digit angka.").toString())
                } else {
                    try {
                        val h = api.sipol(nik)
                        Log.i(TAG, "check nik=******" + nik.takeLast(4))
                        json(out, 200, h)
                    } catch (e: Exception) {
                        json(out, 500, JSONObject().put("error", "server gagal: " + (e.message ?: e)).toString())
                    }
                }
            }

            path == "/api/bansos/captcha" -> {
                try {
                    json(out, 200, api.bansosCaptcha().toString())
                } catch (e: Exception) {
                    Log.e(TAG, "captcha gagal", e)
                    json(
                        out, 502,
                        JSONObject().put("ok", false)
                            .put("error", "captcha gagal: " + (e.message ?: e)).toString()
                    )
                }
            }

            path == "/api/bansos/check" && method == "POST" -> {
                try {
                    val b = JSONObject(String(body, Charsets.UTF_8))
                    val nik = b.optString("nik").trim()
                    val captcha = b.optString("captcha").trim()
                    val id = b.optString("id").trim()
                    if (!Regex("\\d{16}").matches(nik)) {
                        json(out, 422, JSONObject().put("ok", false).put("error", "NIK harus tepat 16 digit angka.").toString())
                    } else if (!Regex("[A-Za-z0-9]{4,10}").matches(captcha)) {
                        json(out, 422, JSONObject().put("ok", false).put("error", "Kode captcha tidak valid.").toString())
                    } else {
                        val h = api.bansosCheck(id, nik, captcha)
                        h.put("ok", true).put("nik", nik)
                        Log.i(TAG, "bansos nik=******" + nik.takeLast(4) + " state=" + h.optString("state"))
                        json(out, 200, h.toString())
                    }
                } catch (e: Exception) {
                    json(out, 500, JSONObject().put("ok", false).put("error", "server gagal: " + (e.message ?: e)).toString())
                }
            }

            path.startsWith("/api/") ->
                json(out, 404, JSONObject().put("error", "not found").toString())

            method != "GET" && method != "HEAD" ->
                json(out, 405, JSONObject().put("ok", false).put("error", "Method not supported").toString())

            else -> serveAsset(path, method == "HEAD", out)
        }
    }

    private fun serveAsset(path: String, headOnly: Boolean, out: BufferedOutputStream) {
        val asset = if (path == "/" || path == "/index.html") "index.html" else path.removePrefix("/")
        if (asset.contains("..") || asset.contains('\\')) {
            respond(out, 400, "text/plain", "Bad path".toByteArray()); return
        }
        try {
            context.assets.open(asset).use { source ->
                val bytes = source.readBytes()
                val ext = asset.substringAfterLast('.', "").lowercase()
                val type = when (ext) {
                    "html", "htm" -> "text/html; charset=utf-8"
                    "js" -> "text/javascript; charset=utf-8"
                    "css" -> "text/css; charset=utf-8"
                    "json" -> "application/json; charset=utf-8"
                    "png" -> "image/png"
                    "jpg", "jpeg" -> "image/jpeg"
                    "svg" -> "image/svg+xml"
                    "ico" -> "image/x-icon"
                    "webmanifest" -> "application/manifest+json"
                    else -> "application/octet-stream"
                }
                respond(out, 200, type, if (headOnly) ByteArray(0) else bytes, withLength = bytes.size)
            }
        } catch (_: Exception) {
            respond(out, 404, "text/plain", "Not found".toByteArray())
        }
    }

    // ----------------------------------------------------------- response
    private fun json(out: BufferedOutputStream, code: Int, body: String) =
        respond(out, code, "application/json; charset=utf-8", body.toByteArray(Charsets.UTF_8))

    private fun respond(
        out: BufferedOutputStream,
        code: Int,
        type: String,
        body: ByteArray,
        withLength: Int = body.size
    ) {
        val reason = when (code) {
            200 -> "OK"; 204 -> "No Content"; 400 -> "Bad Request"; 404 -> "Not Found"
            405 -> "Method Not Allowed"; 422 -> "Unprocessable Entity"
            500 -> "Internal Server Error"; 502 -> "Bad Gateway"; else -> "Error"
        }
        val h = "HTTP/1.1 $code $reason\r\n" +
            "Content-Type: $type\r\n" +
            "Content-Length: $withLength\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
            "Access-Control-Allow-Headers: Content-Type\r\n" +
            // tanpa ini WebView bisa menyimpan index.html lama setelah APK diperbarui
            "Cache-Control: no-store\r\n" +
            "Connection: close\r\n\r\n"
        out.write(h.toByteArray())
        out.write(body)
        out.flush()
    }

    // -------------------------------------------------------------- io
    private fun readLine(input: BufferedInputStream): String? {
        val b = StringBuilder()
        while (true) {
            val c = input.read()
            if (c < 0) return if (b.isEmpty()) null else b.toString()
            if (c == 10) break
            if (c != 13) b.append(c.toChar())
        }
        return b.toString()
    }

    private fun readBody(input: BufferedInputStream, n: Int): ByteArray {
        val buf = ByteArray(n)
        var off = 0
        while (off < n) {
            val r = input.read(buf, off, n - off)
            if (r < 0) break
            off += r
        }
        return if (off == n) buf else buf.copyOf(off)
    }
}
