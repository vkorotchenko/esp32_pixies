package com.pixies.controller

import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors

class PixiesInstallerModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    private val worker = Executors.newSingleThreadExecutor()
    override fun getName() = "PixiesInstaller"
    override fun invalidate() {
        worker.shutdown()
        super.invalidate()
    }

    @ReactMethod
    fun canInstall(promise: Promise) {
        promise.resolve(Build.VERSION.SDK_INT < 26 || context.packageManager.canRequestPackageInstalls())
    }

    @ReactMethod
    fun openSettings(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            promise.resolve(null)
        } catch (error: Exception) {
            promise.reject("install_settings", "Cannot open Android installation settings", error)
        }
    }

    @Suppress("DEPRECATION")
    private fun flags() = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES

    @Suppress("DEPRECATION")
    private fun signatures(info: PackageInfo): Set<String> {
        val values = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures
        require(!values.isNullOrEmpty()) { "APK signing certificate is missing" }
        return values.map { hash(it.toByteArray()) }.toSet()
    }

    private fun hash(bytes: ByteArray) = MessageDigest.getInstance("SHA-256")
        .digest(bytes).joinToString("") { "%02x".format(it) }

    @Suppress("DEPRECATION")
    private fun code(info: PackageInfo) = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()

    @ReactMethod
    fun install(path: String, version: String, expectedCode: Double, sha256: String, promise: Promise) {
        worker.execute {
            try {
                require(Build.VERSION.SDK_INT < 26 || context.packageManager.canRequestPackageInstalls()) {
                    "Allow Install unknown apps for Pixies in Android settings, then retry"
                }
                val file = File(path).canonicalFile
                val directory = File(context.cacheDir, "pixies-updates").canonicalFile
                require(file.parentFile == directory && file.name.startsWith("pixies-") && file.extension == "apk") {
                    "APK must be in the private update cache"
                }
                require(sha256.matches(Regex("[a-f0-9]{64}"))) { "Invalid expected checksum" }
                val digest = MessageDigest.getInstance("SHA-256")
                file.inputStream().use { input ->
                    val buffer = ByteArray(65536)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        digest.update(buffer, 0, count)
                    }
                }
                require(digest.digest().joinToString("") { "%02x".format(it) } == sha256) { "APK checksum changed" }
                val manager = context.packageManager
                val archive = manager.getPackageArchiveInfo(file.path, flags())
                    ?: throw IllegalArgumentException("Downloaded file is not an Android package")
                val installed = manager.getPackageInfo(context.packageName, flags())
                require(archive.packageName == context.packageName && archive.versionName == version) {
                    "APK application/version does not match this release"
                }
                require(expectedCode.isFinite() && expectedCode == expectedCode.toLong().toDouble() &&
                    code(archive) == expectedCode.toLong() && code(archive) > code(installed)) {
                    "APK version code must be newer than the installed app"
                }
                require(signatures(archive) == signatures(installed)) {
                    "APK uses a different signing key. Switching from a development build requires a one-time uninstall/reinstall"
                }
                val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", file)
                context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
                promise.resolve("installer_opened")
            } catch (error: Exception) {
                promise.reject("apk_install", error.message ?: "Android installer failed", error)
            }
        }
    }
}
