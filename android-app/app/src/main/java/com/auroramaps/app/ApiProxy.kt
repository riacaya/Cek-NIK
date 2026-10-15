package com.riacaya.ceknik

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Klien HTTP native untuk server loopback milik APK (port 8789).
 * Bentuk JSON respons DISAMAKAN dengan server.js (versi PC) supaya cek_nik.html
 * bisa dipakai apa adanya di PC maupun di HP.
 */
class ApiProxy {

    companion object {
        private const val KPU_URL = "https://infopemilu.kpu.go.id/Pemilu/Cari_nik_parpol/getDataFromAjx"
        private const val KPU_REFERER = "https://infopemilu.kpu.go.id/Pemilu/Cari_nik"
        private const val BANSOS = "https://cekbansos.kemensos.go.id"
        private const val UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        private const val SESSION_TTL = 5 * 60 * 1000L
    }

    private data class Session(val token: String, val cookie: String, val t: Long)
    private val sessions = ConcurrentHashMap<String, Session>()

    // ------------------------------------------------------- masking NIK (log saja)
    private fun maskNik(nik: String) = nik.take(6) + "********" + nik.takeLast(4)

    // ------------------------------------------------------------ http helper
    private class Res(
        val code: Int,
        val body: ByteArray,
        val headers: Map<String, List<String>> // kunci sudah huruf kecil
    ) {
        val text: String get() = String(body, Charsets.UTF_8)
        val location: String? get() = header("location")
        val setCookies: List<String> get() = headers["set-cookie"] ?: emptyList()
        fun header(name: String): String? = headers[name.lowercase()]?.firstOrNull()
        val ok: Boolean get() = code in 200..299
    }

    /**
     * GET/POST manual: redirect ditangani sendiri supaya Set-Cookie tiap hop
     * tetap terkumpul (jar cookie) — persis perilaku server.js di Node.
     */
    private fun call(
        url: String,
        method: String = "GET",
        body: ByteArray? = null,
        contentType: String? = null,
        cookie: String? = null,
        headers: Map<String, String> = emptyMap(),
        follow: Boolean = true,
        readTimeout: Int = 20000
    ): Res {
        var cur = url
        var curMethod = method
        var curBody = body
        var curCookie = cookie
        repeat(6) {
            val conn = URL(cur).openConnection() as HttpURLConnection
            conn.requestMethod = curMethod
            conn.connectTimeout = 15000
            conn.readTimeout = readTimeout
            conn.instanceFollowRedirects = false
            conn.setRequestProperty("User-Agent", UA)
            conn.setRequestProperty("Accept-Language", "id-ID,id;q=0.9")
            headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
            if (contentType != null) conn.setRequestProperty("Content-Type", contentType)
            if (curCookie != null) conn.setRequestProperty("Cookie", curCookie)
            if (curBody != null) {
                conn.doOutput = true
                conn.setFixedLengthStreamingMode(curBody!!.size)
                conn.outputStream.use { it.write(curBody) }
            }

            val code = try { conn.responseCode } catch (e: Exception) {
                conn.disconnect(); throw e
            }
            val map = LinkedHashMap<String, MutableList<String>>()
            conn.headerFields?.forEach { (k, v) ->
                if (k != null) map.getOrPut(k.lowercase()) { ArrayList() }.addAll(v)
            }
            val stream = try { if (code >= 400) conn.errorStream else conn.inputStream } catch (_: Exception) { null }
            val bytes = try { stream?.readBytes() ?: ByteArray(0) } catch (_: Exception) { ByteArray(0) }
            conn.disconnect()
            val res = Res(code, bytes, map)

            val loc = res.location
            if (!follow || loc == null || code !in 300..399) return res

            curCookie = mergeCookies(curCookie, res.setCookies)
            cur = URL(URL(cur), loc).toString()
            if (code == 303 || ((code == 301 || code == 302) && curMethod == "POST")) {
                curMethod = "GET"
                curBody = null
            }
        }
        throw IllegalStateException("terlalu banyak redirect")
    }

    private fun mergeCookies(prev: String?, incoming: List<String>): String? {
        val jar = LinkedHashMap<String, String>()
        prev?.split(";")?.map { it.trim() }?.filter { it.contains("=") }?.forEach {
            val i = it.indexOf('=')
            jar[it.substring(0, i).trim()] = it.substring(i + 1).trim()
        }
        incoming.forEach { c ->
            val first = c.split(";")[0]
            val i = first.indexOf('=')
            if (i > 0) jar[first.substring(0, i).trim()] = first.substring(i + 1).trim()
        }
        return if (jar.isEmpty()) null else jar.entries.joinToString("; ") { "${it.key}=${it.value}" }
    }

    // ----------------------------------------------------------- 1) SIPOL KPU
    fun sipol(nik: String): String {
        val out = JSONObject().put("nikMasked", maskNik(nik))
        val galat = JSONArray()
        val kpu = JSONObject().put("status", 0).put("state", "error").put("jumlah", 0)
        val nama = JSONObject().put("found", false)

        val res = try {
            call(
                KPU_URL, "POST",
                ("input_ajx=" + URLEncoder.encode(nik, "UTF-8")).toByteArray(Charsets.UTF_8),
                "application/x-www-form-urlencoded; charset=UTF-8",
                headers = mapOf("Referer" to KPU_REFERER, "Accept" to "application/json, text/javascript, */*; q=0.01")
            )
        } catch (e: Exception) {
            galat.put("kpu: " + (e.message ?: "gagal terhubung"))
            null
        }

        if (res != null) {
            kpu.put("status", res.code)
            if (res.ok) {
                try {
                    val arr = JSONArray(res.text)
                    kpu.put("state", if (arr.length() > 0) "found" else "empty").put("jumlah", arr.length())
                    if (arr.length() > 0) {
                        val r = arr.getJSONObject(0)
                        val n = r.optString("nama").trim()
                        nama.put("found", n.isNotEmpty())
                        if (n.isNotEmpty()) nama.put("value", n) // nama SIPOL publik — utuh
                        if (r.optString("nama_parpol").isNotEmpty()) nama.put("partai", r.optString("nama_parpol"))
                        if (r.optString("jabatan").isNotEmpty()) nama.put("jabatan", r.optString("jabatan"))
                        val unit = r.optString("unit").ifEmpty { r.optString("nama_wilayah") }
                        if (unit.isNotEmpty()) nama.put("unit", unit)
                    }
                } catch (_: Exception) {
                    kpu.put("state", "bad")
                    galat.put("kpu: JSON tidak terbaca")
                }
            } else {
                galat.put("kpu: HTTP " + res.code)
            }
        }

        out.put("nama", nama)
        out.put("sumber", JSONObject().put("kpu", kpu))
        out.put("galat", galat)
        return out.toString()
    }

    // ------------------------------------------------- 2) BANSOS (DTSEN)
    private fun gcSessions() {
        val now = System.currentTimeMillis()
        sessions.entries.removeAll { now - it.value.t > SESSION_TTL }
    }

    /** GET halaman + gambar captcha → { ok, id, img(data-uri) }. */
    fun bansosCaptcha(): JSONObject {
        gcSessions()

        val home = call(
            BANSOS + "/",
            headers = mapOf(
                "Accept" to "text/html,application/xhtml+xml",
                "Accept-Language" to "id-ID,id;q=0.9"
            )
        )
        if (!home.ok) throw IllegalStateException("halaman cekbansos HTTP " + home.code)
        val cookie0 = mergeCookies(null, home.setCookies)
            ?: throw IllegalStateException("cekbansos tidak memberi cookie")
        val token = extractToken(home.text)
            ?: throw IllegalStateException("token CSRF tidak ditemukan di halaman")

        val cap = call(
            BANSOS + "/captcha/flat?" + UUID.randomUUID().toString().replace("-", ""),
            cookie = cookie0,
            headers = mapOf("Referer" to BANSOS + "/", "Accept" to "image/*,*/*"),
            readTimeout = 20000
        )
        if (!cap.ok) throw IllegalStateException("gambar captcha HTTP " + cap.code)
        if (cap.body.size < 100) throw IllegalStateException("gambar captcha kosong")

        val mime = (cap.header("content-type") ?: "image/jpeg").split(";")[0].trim()
        val cookie = mergeCookies(cookie0, cap.setCookies) ?: cookie0
        val id = UUID.randomUUID().toString().replace("-", "")
        if (sessions.size >= 50) sessions.remove(sessions.keys.first())
        sessions[id] = Session(token, cookie, System.currentTimeMillis())

        // Base64.NO_WRAP penting: newline akan merusak data URI.
        val img = "data:" + mime + ";base64," + Base64.encodeToString(cap.body, Base64.NO_WRAP)
        return JSONObject().put("ok", true).put("id", id).put("img", img)
    }

    /** POST cekbansos_nik (captcha diisi manusia) → parse tabel DTSEN. */
    fun bansosCheck(id: String, nik: String, captcha: String): JSONObject {
        gcSessions()
        val s = sessions.remove(id)
            ?: return obj("session", "Sesi captcha kedaluwarsa — muat ulang captcha lalu ulangi.")

        val body = "_token=" + URLEncoder.encode(s.token, "UTF-8") +
            "&nik_input=" + URLEncoder.encode(nik, "UTF-8") +
            "&captcha=" + URLEncoder.encode(captcha, "UTF-8")

        val post = call(
            BANSOS + "/cekbansos_nik", "POST",
            body.toByteArray(Charsets.UTF_8),
            "application/x-www-form-urlencoded",
            cookie = s.cookie,
            headers = mapOf(
                "Origin" to BANSOS,
                "Referer" to BANSOS + "/",
                "Accept" to "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
            ),
            follow = false // 302 harus dibaca dulu (server.js juga manual)
        )
        val cookie = mergeCookies(s.cookie, post.setCookies) ?: s.cookie
        val loc = post.location
            ?: return obj("error", "Respons tidak terduga dari cekbansos (HTTP " + post.code + ").")

        if (!loc.contains("hasil-nik", ignoreCase = true)) {
            return obj(
                "captcha",
                "Permintaan ditolak (kode captcha salah / sesi kedaluwarsa / NIK tidak diterima). " +
                    "Muat ulang captcha lalu coba lagi."
            )
        }

        val target = URL(URL(BANSOS + "/"), loc).toString()
        val r = call(
            target,
            cookie = cookie,
            headers = mapOf("Referer" to BANSOS + "/", "Accept" to "text/html,application/xhtml+xml")
        )
        if (!r.ok) return obj("error", "Gagal membaca hasil (HTTP " + r.code + ").")
        return parseHasil(r.text).put("sumber", "cekbansos.kemensos.go.id — DTSEN")
    }

    private fun obj(state: String, pesan: String) = JSONObject().put("state", state).put("pesan", pesan)

    private fun extractToken(html: String): String? {
        val a = Regex("name=[\"']csrf-token[\"']\\s+content=[\"']([^\"']+)[\"']", RegexOption.IGNORE_CASE)
            .find(html)?.groupValues?.get(1)
        if (a != null) return a
        return Regex("name=[\"']_token[\"']\\s+value=[\"']([^\"']+)[\"']", RegexOption.IGNORE_CASE)
            .find(html)?.groupValues?.get(1)
    }

    private fun stripTags(s: String) = s
        .replace(Regex("<[^>]+>"), "")
        .replace(Regex("&nbsp;|&#160;", RegexOption.IGNORE_CASE), " ")
        .replace(Regex("\\s+"), " ")
        .trim()

    private fun parseHasil(html: String): JSONObject {
        val tbody = Regex("<tbody[^>]*>([\\s\\S]*?)</tbody>", RegexOption.IGNORE_CASE).find(html)
        if (tbody != null) {
            val trs = Regex("<tr[^>]*>[\\s\\S]*?</tr>", RegexOption.IGNORE_CASE).findAll(tbody.groupValues[1])
            for (tr in trs) {
                val cells = Regex("<t[dh][^>]*>[\\s\\S]*?</t[dh]>", RegexOption.IGNORE_CASE)
                    .findAll(tr.value).map { stripTags(it.value) }.toList()
                if (cells.size >= 11) {
                    return JSONObject()
                        .put("state", "found")
                        .put("nama", cells[0]).put("desil", cells[1]).put("dtsen", cells[2])
                        .put("sembako", JSONObject().put("status", cells[3]).put("periode", cells[4]))
                        .put("pkh", JSONObject().put("status", cells[5]).put("periode", cells[6]))
                        .put(
                            "pbi",
                            JSONObject().put("status", cells[7]).put("periode", cells[8]).put("ket", cells[9])
                        )
                        .put("kpd", cells[10])
                }
            }
        }
        val alert = Regex(
            "<div[^>]*class=[\"'][^\"']*alert[^\"']*[\"'][^>]*>([\\s\\S]*?)</div>",
            RegexOption.IGNORE_CASE
        ).find(html)
        val pesan = alert?.groupValues?.get(1)?.let { stripTags(it) } ?: ""
        return obj("empty", pesan.ifEmpty { "NIK tidak ditemukan dalam data DTSEN." })
    }
}
