package com.riacaya.ceknik

import android.annotation.SuppressLint
import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.webkit.GeolocationPermissions
import android.view.ViewGroup
import androidx.activity.result.contract.ActivityResultContracts
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.ValueCallback
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.widget.Toast
import java.io.File
import java.io.FileOutputStream
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import android.os.Handler
import android.os.Looper
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var localServer: LocalServer

    private var pendingGeolocationOrigin: String? = null
    private var pendingGeolocationCallback: GeolocationPermissions.Callback? = null
    private var pendingFileCallback: ValueCallback<Array<Uri>>? = null
    private var loadAttempts = 0

    private inner class FileSaver {
        @JavascriptInterface
        fun saveFile(filename: String, mimeType: String, base64: String): Boolean {
            return try {
                val cleanName = filename.replace(Regex("[^a-zA-Z0-9._-]"), "_")
                val bytes = Base64.decode(base64, Base64.DEFAULT)
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                    val values = android.content.ContentValues().apply {
                        put(MediaStore.Downloads.DISPLAY_NAME, cleanName)
                        put(MediaStore.Downloads.MIME_TYPE, mimeType)
                        put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                        put(MediaStore.Downloads.IS_PENDING, 1)
                    }
                    val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                        ?: return false
                    try {
                        contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                        values.clear()
                        values.put(MediaStore.Downloads.IS_PENDING, 0)
                        contentResolver.update(uri, values, null, null)
                    } catch (e: Exception) {
                        contentResolver.delete(uri, null, null)
                        throw e
                    }
                } else {
                    @Suppress("DEPRECATION")
                    val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                    dir.mkdirs()
                    FileOutputStream(File(dir, cleanName)).use { it.write(bytes) }
                }
                runOnUiThread { Toast.makeText(this@MainActivity, "Disimpan di Download/$cleanName", Toast.LENGTH_SHORT).show() }
                true
            } catch (e: Exception) {
                false
            }
        }
    }

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.GetMultipleContents()
    ) { uris ->
        pendingFileCallback?.onReceiveValue(uris.toTypedArray())
        pendingFileCallback = null
    }

    private val locationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val granted = permissions[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
            permissions[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        pendingGeolocationCallback?.invoke(pendingGeolocationOrigin, granted, false)
        pendingGeolocationOrigin = null
        pendingGeolocationCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        localServer = LocalServer(this)
        localServer.start()
        WindowCompat.setDecorFitsSystemWindows(window, true)
        window.statusBarColor = Color.rgb(17, 24, 39)
        window.navigationBarColor = Color.rgb(17, 24, 39)

        webView = WebView(this).apply {
            setBackgroundColor(Color.TRANSPARENT)
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = true
                allowContentAccess = true
                mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
                builtInZoomControls = false
                displayZoomControls = false
            }
            webViewClient = object : WebViewClient() {
                override fun onReceivedError(
                    view: WebView?,
                    request: WebResourceRequest?,
                    error: WebResourceError?
                ) {
                    super.onReceivedError(view, request, error)
                    if (request?.isForMainFrame != true) return
                    if (loadAttempts < 3) {
                        loadAttempts++
                        Handler(Looper.getMainLooper()).postDelayed({ loadApp() }, 1500L)
                    } else {
                        Toast.makeText(
                            this@MainActivity,
                            "Server lokal tidak merespons. Tutup dan buka lagi aplikasi.",
                            Toast.LENGTH_LONG
                        ).show()
                    }
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    view: WebView?,
                    filePathCallback: ValueCallback<Array<Uri>>?,
                    fileChooserParams: FileChooserParams?
                ): Boolean {
                    pendingFileCallback?.onReceiveValue(null)
                    pendingFileCallback = filePathCallback
                    fileChooserLauncher.launch("*/*")
                    return true
                }

                override fun onGeolocationPermissionsShowPrompt(
                    origin: String?,
                    callback: GeolocationPermissions.Callback?
                ) {
                    if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
                        checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
                    ) {
                        callback?.invoke(origin, true, false)
                    } else {
                        pendingGeolocationOrigin = origin
                        pendingGeolocationCallback = callback
                        locationPermissionLauncher.launch(
                            arrayOf(
                                Manifest.permission.ACCESS_FINE_LOCATION,
                                Manifest.permission.ACCESS_COARSE_LOCATION
                            )
                        )
                    }
                }
            }
            addJavascriptInterface(FileSaver(), "AndroidFileSaver")
        }
        setContentView(webView, ViewGroup.LayoutParams(-1, -1))
        waitForLocalServer()
    }

    /**
     * Tunggu server loopback siap, lalu MUAT HALAMAN.
     * (Dulu blok ini keluar dari thread begitu health-check sukses sehingga
     * loadUrl tidak pernah dipanggil → layar kosong. Sekarang selalu memuat.)
     */
    private fun waitForLocalServer() {
        val port = localServer.port
        Thread {
            var ready = false
            for (i in 0 until 50) {                 // maksimal ~5 detik
                ready = try {
                    val c = URL("http://127.0.0.1:$port/api/health").openConnection() as HttpURLConnection
                    c.connectTimeout = 300
                    c.readTimeout = 300
                    val ok = c.responseCode == 200
                    c.disconnect()
                    ok
                } catch (_: Exception) {
                    false
                }
                if (ready) break
                Thread.sleep(100)
            }
            if (!ready) {
                Handler(Looper.getMainLooper()).post {
                    Toast.makeText(this@MainActivity, "Server lokal belum siap, mencoba tetap memuat…", Toast.LENGTH_SHORT).show()
                }
            }
            Handler(Looper.getMainLooper()).post {
                loadApp()
            }
        }.start()
    }

    private fun loadApp() {
        val port = localServer.port
        webView.loadUrl("http://127.0.0.1:$port/index.html")
    }

    override fun onDestroy() {
        localServer.stop()
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }
}
