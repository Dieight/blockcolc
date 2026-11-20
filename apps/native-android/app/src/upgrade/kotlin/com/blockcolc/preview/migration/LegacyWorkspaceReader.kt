package com.blockcolc.preview.migration

import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.Base64
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebMessage
import android.webkit.WebMessagePort
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import com.blockcolc.domain.DigestHex
import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.DomainTime
import com.blockcolc.domain.StrictJson
import com.blockcolc.world.resource.NativeResourceArchive
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.UUID

private const val CONTROL_LIMIT = 2 * 1024 * 1024
private const val CHUNK_LIMIT = 128 * 1024
private const val DAILY_CONTENT_LIMIT = 200 * 1024 * 1024
private const val LEGACY_ORIGIN = "https://localhost"
private const val READER_URL = "$LEGACY_ORIGIN/__blockcolc_native_upgrade"
private val archiveName = Regex("resource-([0-9]{1,3})\\.bin")
private val dailyBlockName = Regex("daily-([a-f0-9]{64})\\.bin")

internal data class LegacyResourceArchive(val id: String, val name: String, val importedAt: String, val archive: File)
internal class LegacyUpgradeFailure(val stage: String, cause: Exception? = null) : IllegalStateException(stage, cause)

/** A verified copy in the app's private cache. The source profile stays read-only. */
internal class LegacyWorkspaceCapture(
    private val directory: File,
    fileDigests: Map<String, String>,
) : AutoCloseable {
    val metadata = StrictJson.parse(File(directory, "metadata.json").readText(), CONTROL_LIMIT) as JSONObject
    val sourceStateSha = fileDigests.getValue("domain.json")
    val sourceContentSha = StrictJson.sha(fileDigests.toSortedMap().entries.joinToString("\n") { (name, digest) -> "$name:$digest" })
    val resources: List<LegacyResourceArchive>
    val rollbackFiles: List<File>
    val dailyManifests: File? = if (metadata.getInt("dailyBackups") > 0) File(directory, "daily-index.json") else null

    init {
        require(metadata.getInt("schema") == 1)
        val registry = metadata.getJSONObject("resources")
        val rows = registry.getJSONArray("items")
        resources = List(rows.length()) { index ->
            val row = rows.getJSONObject(index)
            val fileName = "resource-$index.bin"
            val id = row.getString("id")
            require(row.getString("file") == fileName && fileDigests[fileName] == id)
            LegacyResourceArchive(id, row.getString("name"), DomainTime.instant(row.getString("importedAt")), File(directory, fileName))
        }
        require(resources.map { it.id }.distinct().size == rows.length())
        for (selection in listOf("activeId", "baseId")) {
            require(registry.isNull(selection) || resources.any { it.id == registry.getString(selection) })
        }
        val count = metadata.getInt("rollbacks").also { require(it in 0..2) }
        val order = metadata.optJSONArray("rollbackOrder")
        val indices = List(count) { index -> checkNotNull(order).getInt(index) }
        require(indices.sorted() == (0 until count).toList())
        rollbackFiles = indices.map { index ->
            File(directory, "rollback-$index.json")
        }
        val expectedFiles = mutableSetOf("domain.json", "metadata.json")
        expectedFiles += resources.map { it.archive.name }
        expectedFiles += rollbackFiles.map { it.name }
        dailyManifests?.let { manifestFile ->
            expectedFiles += manifestFile.name
            expectedFiles += verifyDailyBlocks(manifestFile, fileDigests)
        }
        require(fileDigests.keys == expectedFiles)
    }

    fun readDomain(): DomainDocument? {
        val text = File(directory, "domain.json").readText()
        return if (text == "null") null else DomainDocument.parse(text)
    }

    fun dailyBlock(id: String): File {
        require(id.matches(Regex("[a-f0-9]{64}")))
        return File(directory, "daily-$id.bin")
    }

    private fun verifyDailyBlocks(manifestFile: File, digests: Map<String, String>): Set<String> {
        val manifests = StrictJson.parse(manifestFile.readText(), CONTROL_LIMIT) as JSONArray
        require(manifests.length() == metadata.getInt("dailyBackups"))
        val expected = mutableSetOf<String>()
        var totalBytes = manifestFile.length()
        for (index in 0 until manifests.length()) {
            val manifest = manifests.getJSONObject(index)
            val blocks = manifest.getJSONArray("blocks")
            val stateBlock = manifest.getString("stateBlock")
            val referenced = mutableSetOf<String>()
            var snapshotBytes = 0L
            for (part in 0 until blocks.length()) {
                val block = blocks.getJSONObject(part)
                val id = block.getString("id")
                val file = dailyBlock(id)
                val size = block.getLong("bytes")
                require(referenced.add(id) && size > 0 && file.length() == size && digests[file.name] == id)
                if (expected.add(file.name)) totalBytes += size
                snapshotBytes += size
            }
            require(stateBlock in referenced && snapshotBytes == manifest.getLong("snapshotBytes"))
        }
        require(totalBytes <= DAILY_CONTENT_LIMIT)
        return expected
    }

    override fun close() {
        directory.deleteRecursively()
    }
}

/** Uses the same WebView origin as v2.9.0. Only the bundled reader receives
 * a message port. Each chunk is acknowledged after it reaches the staging file. */
internal class LegacyWorkspaceReader(private val context: Context) {
    suspend fun capture(): LegacyWorkspaceCapture? = withContext(Dispatchers.IO) {
        val page = context.assets.open("legacy-workspace.html").bufferedReader().use { it.readText() }
        val directory = File(context.cacheDir, "legacy-workspace-" + UUID.randomUUID())
        check(directory.mkdir())
        var retained = false
        try {
            val copied = withTimeout(180_000) {
                withContext(Dispatchers.Main.immediate) { copy(page, directory) }
            }
            copied?.let { LegacyWorkspaceCapture(directory, it).also { retained = true } }
        } finally {
            if (!retained) directory.deleteRecursively()
        }
    }

    private suspend fun copy(page: String, directory: File): Map<String, String>? {
        val result = CompletableDeferred<Map<String, String>?>()
        val view = WebView(context)
        val writer = HandlerThread("blockcolc-upgrade-reader").apply { start() }
        val sink = TransferFiles(directory)
        var receiver: WebMessagePort? = null
        try {
            view.settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                blockNetworkLoads = true
                allowFileAccess = false
                allowContentAccess = false
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            }
            view.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true

                @Suppress("DEPRECATION")
                override fun shouldOverrideUrlLoading(view: WebView, url: String) = true

                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) =
                    WebResourceResponse("text/plain", "UTF-8", ByteArrayInputStream(ByteArray(0)))

                override fun onPageFinished(view: WebView, url: String) {
                    if (result.isCompleted || receiver != null || url != READER_URL) return
                    try {
                        val ports = view.createWebMessageChannel()
                        receiver = ports[0]
                        ports[0].setWebMessageCallback(object : WebMessagePort.WebMessageCallback() {
                            override fun onMessage(port: WebMessagePort, message: WebMessage) {
                                if (result.isCompleted) return
                                try {
                                    val data = checkNotNull(message.data)
                                    val packet = StrictJson.parse(data, CHUNK_LIMIT * 2) as JSONObject
                                    when (packet.getString("type")) {
                                        "absent" -> {
                                            check(sink.empty)
                                            result.complete(null)
                                        }
                                        "done" -> result.complete(sink.complete())
                                        "error" -> {
                                            val stage = packet.optString("stage").takeIf {
                                                it in setOf("preferences", "resources", "workspace", "transfer")
                                            } ?: "transfer"
                                            result.completeExceptionally(LegacyUpgradeFailure("reader-$stage"))
                                        }
                                        else -> {
                                            sink.write(packet)
                                            port.postMessage(WebMessage("ok"))
                                        }
                                    }
                                } catch (failure: Exception) {
                                    result.completeExceptionally(LegacyUpgradeFailure("reader-wire", failure))
                                }
                            }
                        }, Handler(writer.looper))
                        view.postWebMessage(WebMessage("blockcolc-legacy-reader", arrayOf(ports[1])), Uri.parse(LEGACY_ORIGIN))
                    } catch (failure: Exception) {
                        result.completeExceptionally(LegacyUpgradeFailure("reader-handshake", failure))
                    }
                }

                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (request.isForMainFrame) result.completeExceptionally(LegacyUpgradeFailure("reader-load"))
                }

                @android.annotation.TargetApi(Build.VERSION_CODES.O)
                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                    result.completeExceptionally(LegacyUpgradeFailure("reader-process"))
                    return true
                }
            }
            view.loadDataWithBaseURL(READER_URL, page, "text/html", "UTF-8", READER_URL)
            return result.await()
        } finally {
            result.cancel()
            try {
                receiver?.close()
            } finally {
                try {
                    view.destroy()
                } finally {
                    writer.quitSafely()
                    withContext(NonCancellable + Dispatchers.IO) {
                        writer.join()
                        sink.close()
                    }
                }
            }
        }
    }

    private class TransferFiles(private val directory: File) : AutoCloseable {
        private data class Incoming(
            val name: String,
            val output: FileOutputStream,
            val digest: MessageDigest,
            var left: Long,
        )

        private val finished = linkedMapOf<String, String>()
        private var current: Incoming? = null
        val empty get() = current == null && finished.isEmpty()

        fun write(packet: JSONObject) {
            when (packet.getString("type")) {
                "file" -> start(packet)
                "chunk" -> chunk(packet.getString("data"))
                "end" -> end()
                else -> error("LEGACY_READER_TRANSFER")
            }
        }

        private fun start(packet: JSONObject) {
            check(current == null)
            val name = packet.getString("name")
            val limit = when (name) {
                "domain.json", "rollback-0.json", "rollback-1.json" -> StrictJson.EXPANDED_LIMIT
                "metadata.json", "daily-index.json" -> CONTROL_LIMIT
                else -> if (dailyBlockName.matches(name)) DAILY_CONTENT_LIMIT else {
                    val index = archiveName.matchEntire(name)?.groupValues?.get(1)?.toInt()
                    require(index != null && index in 0..511 && name == "resource-$index.bin")
                    NativeResourceArchive.MAX_JAR_BYTES
                }
            }
            val size = packet.getLong("bytes")
            require(name !in finished && size in 1..limit.toLong() && size <= directory.usableSpace)
            current = Incoming(name, File(directory, name).outputStream(), MessageDigest.getInstance("SHA-256"), size)
        }

        private fun chunk(encoded: String) {
            val open = checkNotNull(current)
            val bytes = Base64.decode(encoded, Base64.NO_WRAP)
            require(bytes.size in 1..CHUNK_LIMIT && bytes.size <= open.left)
            open.output.write(bytes)
            open.digest.update(bytes)
            open.left -= bytes.size
        }

        private fun end() {
            val open = checkNotNull(current)
            check(open.left == 0L)
            open.output.fd.sync()
            open.output.close()
            finished[open.name] = DigestHex.encode(open.digest.digest())
            current = null
        }

        fun complete(): Map<String, String> {
            check(current == null && finished.keys.containsAll(listOf("domain.json", "metadata.json")))
            return finished.toMap()
        }

        override fun close() {
            current?.output?.close()
        }
    }
}
