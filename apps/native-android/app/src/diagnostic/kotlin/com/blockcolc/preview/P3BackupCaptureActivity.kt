package com.blockcolc.preview

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import java.io.File
import java.util.UUID

/** Local, explicitly selected share destination for paired startup experiments.
 * Never opens a domain store or sends the captured backup over the network. */
class P3BackupCaptureActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        check(BuildConfig.NATIVE_DIAGNOSTICS)
        @Suppress("DEPRECATION")
        val uri = intent.takeIf { it.action == Intent.ACTION_SEND }
            ?.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
        if (uri?.scheme != "content") { finish(); return }
        Thread({
            val result = runCatching {
                val target = File(filesDir, "p3-startup-capture-${UUID.randomUUID()}.json")
                try {
                    contentResolver.openInputStream(uri).use { input ->
                        checkNotNull(input)
                        target.outputStream().use { out ->
                            val buffer = ByteArray(64 * 1024); var count = 0L
                            while (true) {
                                val n = input.read(buffer); if (n < 0) break
                                count += n; require(count <= 100L * 1024 * 1024)
                                out.write(buffer, 0, n)
                            }
                            out.fd.sync()
                        }
                    }
                    // Preserve the exact exported bytes first. Validation
                    // belongs to the separate fixture importer; a rejected
                    // archive is still useful diagnostic evidence.
                    check(target.length() > 0)
                    android.util.Log.i("BlockcolcCapture", "Local backup copied: ${target.length()} bytes")
                    target.name
                } catch (error: Throwable) {
                    target.renameTo(File(filesDir, target.name + ".incomplete"))
                    android.util.Log.e("BlockcolcCapture", "Local backup copy failed", error)
                    throw error
                }
            }
            runOnUiThread {
                Toast.makeText(this, if (result.isSuccess) "实验备份已保存在本机" else "实验备份接收失败", Toast.LENGTH_LONG).show()
                finish()
            }
        }, "p3-backup-capture").start()
    }
}
