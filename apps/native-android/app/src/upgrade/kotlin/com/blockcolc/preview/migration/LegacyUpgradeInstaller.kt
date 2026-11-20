package com.blockcolc.preview.migration

import android.content.Context
import com.blockcolc.audio.NativeAudioController
import com.blockcolc.domain.DomainEngine
import com.blockcolc.domain.DomainTime
import com.blockcolc.presentation.ClientPreferences
import com.blockcolc.preview.AndroidPreferencesStorage
import com.blockcolc.preview.resources.AndroidResourceLibraryIndex
import com.blockcolc.storage.NativeStateStore
import com.blockcolc.storage.android.AndroidStateDatabase
import com.blockcolc.world.resource.ResourcePackLibrary
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.util.TimeZone

/** Publish a native workspace only after its data and local choices can be
 * reopened. Restarts before publication replay from the immutable old store. */
internal object LegacyUpgradeInstaller {
    private val lock = Mutex()
    private const val marker = "legacyWorkspaceSha"
    private const val database = "database"
    private val recoveredDatabase = Regex("p2-recovered-[a-f0-9-]{36}\\.db")
    private fun databaseName(sha: String) = "p2-web-upgrade-${sha.take(32)}.db"

    suspend fun prepare(context: Context) = withContext(Dispatchers.IO) {
        lock.withLock {
            val app = context.applicationContext
            val storage = app.getSharedPreferences("p2-storage", Context.MODE_PRIVATE)
            val recorded = storage.getString(marker, null)
            val selected = storage.getString(database, null)
            if (recorded != null) {
                // The marker records completion of the legacy import. The
                // native recovery flow may have since selected a fresh DB.
                require(recorded.matches(Regex("[a-f0-9]{64}")) && selected != null &&
                    (selected == databaseName(recorded) || recoveredDatabase.matches(selected)))
                check(app.getDatabasePath(selected).isFile) { "UPGRADE_DATABASE_MISSING" }
                return@withLock
            }
            if (selected != null || app.getDatabasePath("p2-state.db").isFile) return@withLock
            if (!File(app.applicationInfo.dataDir, "app_webview").isDirectory) return@withLock

            inStage("read-legacy") { LegacyWorkspaceReader(app).capture() }?.use { capture ->
                val name = databaseName(capture.sourceContentSha)
                val preferences = inStage("verify-workspace") { stageDatabase(app, name, capture) }
                inStage("adopt-resources") { adoptResources(app, capture) }
                inStage("adopt-audio") { NativeAudioController.get(app).adoptLegacyImports().get() }
                inStage("adopt-preferences") {
                    val settings = AndroidPreferencesStorage(app)
                    val canonical = preferences.canonical()
                    settings.write(canonical)
                    check(settings.read() == canonical) { "UPGRADE_PREFERENCES_UNCONFIRMED" }
                }

                if (!storage.edit().putString(database, name).putString(marker, capture.sourceContentSha).commit()) {
                    // SharedPreferences also updates its in-memory values when a
                    // disk commit fails. A retry must not treat those as adopted.
                    storage.edit().remove(database).remove(marker).commit()
                    throw LegacyUpgradeFailure("select-workspace")
                }
            }
            Unit
        }
    }

    private suspend inline fun <T> inStage(stage: String, action: () -> T): T = try {
        action()
    } catch (failure: LegacyUpgradeFailure) {
        throw failure
    } catch (failure: Exception) {
        currentCoroutineContext().ensureActive()
        throw LegacyUpgradeFailure(stage, failure)
    }

    private fun stageDatabase(app: Context, name: String, capture: LegacyWorkspaceCapture): ClientPreferences {
        val metadata = capture.metadata
        val zone = TimeZone.getDefault().id
        val preferences = metadata.optionalText("settings")?.let(ClientPreferences::parseText) ?: ClientPreferences()
        val domain = capture.readDomain() ?: DomainEngine.initial(zone)
        val recovery = LegacyFocusPlan.decode(domain, metadata, preferences)
        AndroidStateDatabase(app, name).use { database ->
            val store = NativeStateStore(database)
            if (store.load() == null) {
                store.initialize(domain, recovery, LegacyBackupReader.archives(capture, zone))
            }
        }
        AndroidStateDatabase(app, name).use { database ->
            val store = NativeStateStore(database)
            val reopened = checkNotNull(store.load())
            check(reopened.token.revision == 0L && reopened.token.replacementGeneration == 0L &&
                reopened.domain.sha256 == domain.sha256 && reopened.recovery == recovery) { "UPGRADE_DATABASE_UNCONFIRMED" }
            val roots = store.backupRoots()
            check(roots.count { it.kind == "rollback" } == metadata.getInt("rollbacks") &&
                roots.count { it.kind == "daily" } == metadata.getInt("dailyBackups")) { "UPGRADE_BACKUPS_UNCONFIRMED" }
        }
        val setup = metadata.optionalText("setup") != "1" && !domain.hasFocusFacts() && domain.projectionJson().let { facts ->
            facts.getJSONArray("projects").length() == 0 && facts.getJSONArray("habitBuildings").length() == 0
        }
        val tutorial = setup && metadata.optionalText("tutorial") != "1"
        check(app.getSharedPreferences("native-ui", Context.MODE_PRIVATE).edit()
            .putBoolean("setupRequired", setup).putBoolean("tutorialPending", tutorial).commit()) { "UPGRADE_FIRST_USE_UNCONFIRMED" }
        return preferences
    }

    private fun adoptResources(app: Context, capture: LegacyWorkspaceCapture) {
        val selection = capture.metadata.getJSONObject("resources")
        if (!selection.getBoolean("databaseExists")) return
        val directory = File(app.filesDir, "native-resource-packs")
        var importedAt = 0L
        val library = ResourcePackLibrary(directory, AndroidResourceLibraryIndex(directory)) { importedAt }
        for (row in capture.resources) {
            importedAt = DomainTime.millis(row.importedAt)
            val saved = library.importPack(row.name, row.archive::inputStream)
            check(saved.id == row.id && saved.bytes == row.archive.length() && saved.importedAt == importedAt)
        }
        val base = selection.optionalText("baseId")
        val active = selection.optionalText("activeId")
        library.select(base, base = true)
        val saved = library.select(active)
        check(saved.activeId == active && saved.baseId == base) { "UPGRADE_RESOURCE_CHOICE_UNCONFIRMED" }
    }

    private fun JSONObject.optionalText(key: String): String? = if (isNull(key)) null else get(key) as String
}
