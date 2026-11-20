package com.blockcolc.preview

import android.content.ContextWrapper
import android.content.SharedPreferences
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.test.filters.SdkSuppress
import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.domain.DigestHex
import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.DomainEngine
import com.blockcolc.domain.DomainTime
import com.blockcolc.domain.StrictJson
import com.blockcolc.focus.FocusCoordinator
import com.blockcolc.presentation.ClientPreferences
import com.blockcolc.preview.migration.LegacyBackupReader
import com.blockcolc.preview.migration.LegacyFocusPlan
import com.blockcolc.preview.migration.LegacyUpgradeInstaller
import com.blockcolc.preview.migration.LegacyWorkspaceReader
import com.blockcolc.storage.NativeStateStore
import com.blockcolc.storage.PlanPhase
import com.blockcolc.storage.android.AndroidStateDatabase
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import java.security.MessageDigest
import java.util.UUID

@SdkSuppress(minSdkVersion = 28)
class LegacyWorkspaceReaderTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Test fun completedMigrationOpensTheNativeDatabaseSelectedByBackupRecovery() = runBlocking {
        check(BuildConfig.NATIVE_DIAGNOSTICS)
        val name = "p2-recovered-" + UUID.randomUUID() + ".db"
        val preferenceName = "p4-upgrade-recovered-" + UUID.randomUUID()
        val preferences = context.getSharedPreferences(preferenceName, 0)
        val isolated = object : ContextWrapper(context) {
            override fun getApplicationContext() = this
            override fun getSharedPreferences(name: String, mode: Int): SharedPreferences {
                check(name == "p2-storage")
                return preferences
            }
        }
        val restored = DomainEngine.initial("Asia/Shanghai")
        try {
            AndroidStateDatabase(context, name).use { database ->
                NativeStateStore(database).initialize(restored)
            }
            val legacySha = "1".repeat(64)
            assertTrue(preferences.edit().putString("legacyWorkspaceSha", legacySha).putString("database", name).commit())
            LegacyUpgradeInstaller.prepare(isolated)
            assertEquals(name, preferences.getString("database", null))
            assertEquals(legacySha, preferences.getString("legacyWorkspaceSha", null))
            AndroidStateDatabase(context, name).use { database ->
                assertEquals(restored.sha256, NativeStateStore(database).load()?.domain?.sha256)
            }
        } finally {
            context.deleteDatabase(name)
            context.deleteSharedPreferences(preferenceName)
        }
    }

    @Test fun readsTheLegacyOriginWithoutCreatingOrChangingItsDatabases() = runBlocking {
        check(BuildConfig.NATIVE_DIAGNOSTICS)
        val suffix = "p4-legacy-" + UUID.randomUUID().toString().take(8)
        WebView.setDataDirectorySuffix(suffix)
        val reader = LegacyWorkspaceReader(context)
        assertNull(reader.capture())
        assertEquals("empty", runPage("""
            const databases = await indexedDB.databases();
            document.title = "result:" + (databases.length === 0 ? "empty" : "created");
        """))

        val start = DomainTime.millis("2026-11-16T08:00:00.000Z")
        val original = activeSecondRound(start)
        val dailyDomain = activeSecondRound(start, includeSecond = false)
        val settings = """{"focusMinutes":25,"breakMinutes":4,"language":"en","autoContinueFocus":true}"""
        val plan = activeLegacyPlan(start).toString()
        val dayBlocks = linkedMapOf<String, String>()
        fun block(value: JSONObject): String = value.toString().let { body ->
            StrictJson.sha(body).also { dayBlocks[it] = body }
        }
        val fields = JSONObject()
        val legacy = dailyDomain.json()
        for (key in legacy.keys()) {
            val value = legacy.get(key)
            val field = if (value is JSONArray) {
                val parts = JSONArray()
                for (offset in 0 until value.length() step 16) {
                    val rows = JSONArray()
                    for (index in offset until minOf(value.length(), offset + 16)) rows.put(value.get(index))
                    val body = rows.toString()
                    parts.put(StrictJson.sha(body).also { dayBlocks[it] = body })
                }
                JSONObject().put("kind", "array").put("parts", parts).put("length", value.length())
            } else JSONObject().put("kind", "value").put("value", value)
            fields.put(key, field)
        }
        val dayId = block(JSONObject().put("format", "blockcolc-daily-merged-v2").put("properties", fields))
        val dayBytes = dayBlocks.getValue(dayId).toByteArray(Charsets.UTF_8)
        val archive = ByteArray(280_701) { ((it * 19) xor (it shr 5)).toByte() }
        val archiveId = DigestHex.encode(MessageDigest.getInstance("SHA-256").digest(archive))
        assertEquals("seeded", runPage("""
            const workspace = await create("blockcolc-v1", 3, database => {
                for (const name of ["appState", "metadata", "dailyBackups", "dailyBackupBlocks", "rollbackBackups"]) {
                    database.createObjectStore(name, { keyPath: "id" });
                }
            });
            const daily = Object.entries(${JSONObject(dayBlocks).toString()}).map(([id, text]) => ({
                id, data: new TextEncoder().encode(text)
            }));
            await write(workspace, ["appState", "metadata", "dailyBackups", "dailyBackupBlocks", "rollbackBackups"], transaction => {
                transaction.objectStore("appState").put({id:"current", revision:36, state:${original.canonical}});
                transaction.objectStore("metadata").put({id:"last-domain-replacement", revision:15});
                transaction.objectStore("dailyBackups").put({
                    id:"2026-11-16", date:"2026-11-16", createdAt:"2026-11-16T23:10:00.000Z", timeZone:"Asia/Shanghai",
                    sourceRevision:35, stateBlock:"$dayId", snapshotBytes:daily.reduce((sum, block) => sum + block.data.length, 0),
                    blocks:daily.map(block => ({id:block.id,bytes:block.data.length}))
                });
                for (const block of daily) transaction.objectStore("dailyBackupBlocks").put(block);
                transaction.objectStore("rollbackBackups").put({
                    id:"rollback-before-import", createdAt:"2026-11-16T23:00:00.000Z", reason:"before-import",
                    sourceChecksum:"$dayId", state:${original.canonical}
                });
            });
            workspace.close();
            const resources = await create("blockcolc-resource-packs-v1", 1, database => {
                database.createObjectStore("resourcePacks", {keyPath:"id"});
                database.createObjectStore("metadata", {keyPath:"key"});
            });
            const archive = Uint8Array.from({length:280701}, (_, index) => (index * 19) ^ (index >> 5));
            await write(resources, ["resourcePacks", "metadata"], transaction => {
                transaction.objectStore("resourcePacks").put({
                    id:"sha256:$archiveId", name:"测试资源包 📦", importedAt:"2026-11-16T08:00:00.000Z", archive
                });
                transaction.objectStore("metadata").put({key:"active-pack", packId:"sha256:$archiveId"});
            });
            resources.close();
            localStorage.setItem("blockcolc-focus-preferences-v1", ${JSONObject.quote(settings)});
            localStorage.setItem("blockcolc-round-plan-v1", ${JSONObject.quote(plan)});
            localStorage.setItem("blockcolc-first-project-setup-v1", "1");
            document.title = "result:seeded";
        """))
        val digestBefore = checkNotNull(reader.capture()).use { capture ->
            assertEquals(original.sha256, capture.readDomain()?.sha256)
            assertEquals(3, capture.metadata.getInt("version"))
            assertEquals(36, capture.metadata.getInt("revision"))
            assertEquals(15, capture.metadata.getInt("replacementRevision"))
            assertEquals(settings, capture.metadata.getString("settings"))
            assertEquals(plan, capture.metadata.getString("plan"))
            assertEquals("1", capture.metadata.getString("setup"))
            assertEquals(1, capture.metadata.getInt("dailyBackups"))
            assertEquals(1, capture.metadata.getInt("rollbacks"))
            assertArrayEquals(dayBytes, capture.dailyBlock(dayId).readBytes())
            val rollback = JSONObject(capture.rollbackFiles.single().readText())
            assertEquals("rollback-before-import", rollback.getString("id"))
            assertEquals(original.sha256, DomainDocument.fromJson(rollback.getJSONObject("state")).sha256)
            assertEquals(archiveId, capture.metadata.getJSONObject("resources").getString("activeId"))
            val exported = capture.resources.single()
            assertEquals("测试资源包 📦", exported.name)
            assertEquals(archiveId, exported.id)
            assertArrayEquals(archive, exported.archive.readBytes())
            val preferred = ClientPreferences.parseText(capture.metadata.getString("settings"))
            assertTrue(preferred.autoContinueFocus)
            val recovery = LegacyFocusPlan.decode(original, capture.metadata, preferred)
            assertEquals("old-explicit-grant", recovery.automatic?.id)
            val staleMarker = JSONObject(capture.metadata.toString()).put("replacementRevision", 16)
            assertNull(LegacyFocusPlan.decode(original, staleMarker, preferred).automatic)
            val temporary = "p2-upgrade-reader-" + UUID.randomUUID() + ".db"
            try {
                AndroidStateDatabase(context, temporary).use { database ->
                    val staging = NativeStateStore(database)
                    val domain = checkNotNull(capture.readDomain())
                    val archives = LegacyBackupReader.archives(capture, "Asia/Shanghai")
                    val blocked = runCatching {
                        staging.initialize(domain, recovery, sequence {
                            yield(archives.first())
                            error("Fixture interruption while adopting archives")
                        })
                    }
                    assertNotNull(blocked.exceptionOrNull())
                    assertNull(staging.load())
                    staging.initialize(domain, recovery, archives)
                }
                AndroidStateDatabase(context, temporary).use { database ->
                    val store = NativeStateStore(database)
                    val coordinator = FocusCoordinator(store, temporary)
                    val reopened = coordinator.resume(start + 37_200) { error("A live round must retain its deadline") }.state
                    assertEquals(original.sha256, reopened.domain.sha256)
                    assertEquals(DomainTime.format(start + 55_000), reopened.recovery.plan?.phaseEndsAt)
                    val rest = coordinator.resume(start + 55_000) { "deadline-second" }.state
                    assertEquals(PlanPhase.REST, rest.recovery.plan?.phase)
                    val third = coordinator.resume(start + 67_200) { "deadline-rest" }.state
                    assertEquals(PlanPhase.FOCUS, third.recovery.plan?.phase)
                    assertEquals(2, third.recovery.plan?.completedSessionIds?.size)
                    assertEquals(DomainTime.format(start + 60_000), third.domain.activeFocusSession()?.getString("startedAt"))
                    assertEquals(DomainTime.format(start + 85_000), third.recovery.plan?.phaseEndsAt)
                    val archives = store.backupRoots().associateBy { it.kind }
                    assertEquals(original.sha256, archives.getValue("rollback").domainSha)
                    val daily = archives.getValue("daily")
                    assertEquals(dailyDomain.sha256, daily.domainSha)
                    store.restore(third.token, "restore-daily", daily.id, DomainTime.format(start + 67_200))
                    val restored = coordinator.load()
                    assertEquals(dailyDomain.sha256, restored.domain.sha256)
                    assertNull(restored.recovery.automatic)
                }
            } finally {
                context.deleteDatabase(temporary)
            }
            capture.sourceStateSha
        }
        checkNotNull(reader.capture()).use { capture ->
            assertEquals(digestBefore, capture.sourceStateSha)
            assertEquals(36, capture.metadata.getInt("revision"))
            assertEquals(archiveId, capture.resources.single().id)
        }
        assertEquals("damaged", runPage("""
            const workspace = await create("blockcolc-v1", 3, () => {});
            await write(workspace, ["dailyBackupBlocks"], transaction => {
                transaction.objectStore("dailyBackupBlocks").put({id:"$dayId", data: new Uint8Array(${dayBytes.size})});
            });
            workspace.close();
            document.title = "result:damaged";
        """))
        val invalidCopy = runCatching { reader.capture()?.close() }
        assertTrue("The reader must reject a corrupted daily block", invalidCopy.exceptionOrNull() is IllegalArgumentException)
    }

    @Test fun recoversLegacySplitWritesWithoutRepeatingARound() {
        val start = DomainTime.millis("2026-11-16T08:00:00.000Z")
        val reservedId = "auto-old-explicit-grant-round-2"
        val active = activeSecondRound(start, secondId = reservedId)
        val result = DomainEngine.execute(active, DomainEngine.command("CompleteFocus"), start + 57_000)
        assertTrue(result.ok)
        val meta = JSONObject().put("replacementRevision", 15)
        val preferences = ClientPreferences(autoContinueFocus = true)
        val focus = activeLegacyPlan(start).put("currentSessionId", reservedId)
        val beforePlanWrite = JSONObject(focus.toString()).put("status", "ready").apply { remove("currentSessionId") }
        val resumed = LegacyFocusPlan.decode(active, meta.put("plan", beforePlanWrite.toString()), preferences)
        assertEquals(PlanPhase.FOCUS, resumed.plan?.phase)
        assertEquals(reservedId, resumed.plan?.currentSessionId)
        assertEquals(DomainTime.format(start + 55_000), resumed.plan?.phaseEndsAt)
        fun checkRest(source: JSONObject) {
            val state = LegacyFocusPlan.decode(result.state, meta.put("plan", source.toString()), preferences)
            assertEquals(listOf("old-first", reservedId), state.plan?.completedSessionIds)
            assertEquals(PlanPhase.REST, state.plan?.phase)
            assertEquals(DomainTime.format(start + 55_000), state.plan?.restStartedAt)
            assertEquals(DomainTime.format(start + 60_000), state.plan?.phaseEndsAt)
            assertEquals(reservedId, state.automatic?.predecessorSessionId)
        }
        checkRest(focus)
        val reserved = JSONObject(focus.toString()).put("status", "ready").apply { remove("currentSessionId") }
        val at = DomainTime.format(start + 30_000)
        reserved.getJSONObject("automaticContinuation").put("nextRoundStartsAt", at)
            .put("reservation", JSONObject().put("round", 2).put("sessionId", reservedId).put("scheduledAt", at))
        checkRest(reserved)
        val cancelling = focus.put("cancellationRequested", true).put("cancellationReason", "other")
        val report = LegacyFocusPlan.decode(result.state, meta.put("plan", cancelling.toString()), preferences)
        assertEquals(PlanPhase.REPORT, report.plan?.phase)
        assertEquals(listOf("old-first", reservedId), report.plan?.completedSessionIds)
        assertEquals(true, report.plan?.cancelled)
        assertEquals("other", report.plan?.cancellationCategory)
        assertNull(report.automatic)
    }

    private fun activeLegacyPlan(start: Long) = JSONObject().put("projectId", "old-project").put("subtaskId", JSONObject.NULL)
        .put("status", "focus").put("mode", "marathon").put("deferredSettlement", true)
        .put("totalRounds", 3).put("completedRounds", 1).put("reportedSessionIds", JSONArray().put("old-first"))
        .put("currentSessionId", "old-session").put("hasStarted", true)
        .put("deadlinePolicy", "exact").put("endAt", DomainTime.format(start + 85_000))
        .put("automaticContinuation", JSONObject().put("replacementRevision", 15).put("authorizationId", "old-explicit-grant")
            .put("focusDurationMs", 25_000).put("breakDurationMs", 5_000))

    private fun activeSecondRound(start: Long, includeSecond: Boolean = true, secondId: String = "old-session"): DomainDocument {
        var domain = DomainEngine.initial("Asia/Shanghai")
        fun apply(command: JSONObject, at: Long) {
            val result = DomainEngine.execute(domain, command, at)
            check(result.ok) { result.error.orEmpty() }
            domain = result.state
        }
        val project = "old-project"
        apply(DomainEngine.command("CreateProject", "projectId" to project, "title" to "迁移练习", "blueprintId" to "cottage",
            "subtasks" to JSONArray().put(JSONObject().put("id", "old-task").put("title", "测试"))), start)
        fun startRound(id: String, at: Long) {
            apply(DomainEngine.command("StartFocus", "sessionId" to id, "projectId" to project, "subtaskId" to null,
                "plannedDurationMs" to 25_000, "marathon" to true, "deferredSettlement" to true,
                "deadlineAt" to DomainTime.format(start + 85_000)), at)
        }
        startRound("old-first", start)
        apply(DomainEngine.command("CompleteFocus"), start + 25_000)
        if (includeSecond) startRound(secondId, start + 30_000)
        return domain
    }

    private suspend fun runPage(script: String): String = withTimeout(20_000) {
        withContext(Dispatchers.Main.immediate) {
            val result = CompletableDeferred<String>()
            val view = WebView(context)
            try {
                view.settings.javaScriptEnabled = true
                view.settings.domStorageEnabled = true
                view.settings.blockNetworkLoads = true
                view.webChromeClient = object : WebChromeClient() {
                    override fun onReceivedTitle(view: WebView, title: String) {
                        if (title.startsWith("result:")) result.complete(title.removePrefix("result:"))
                    }
                }
                val html = """
                    <!doctype html><meta charset="utf-8"><script>
                    function create(name, version, configure) {
                        return new Promise((resolve, reject) => {
                            const request = indexedDB.open(name, version);
                            request.onupgradeneeded = () => configure(request.result);
                            request.onerror = () => reject(request.error);
                            request.onsuccess = () => resolve(request.result);
                        });
                    }
                    function write(database, stores, writeItems) {
                        return new Promise((resolve, reject) => {
                            const transaction = database.transaction(stores, "readwrite");
                            writeItems(transaction);
                            transaction.oncomplete = resolve;
                            transaction.onabort = () => reject(transaction.error);
                        });
                    }
                    (async () => { $script })().catch(() => { document.title = "result:fixture-error"; });
                    </script>
                """.trimIndent()
                view.loadDataWithBaseURL("https://localhost/", html, "text/html", "UTF-8", null)
                result.await()
            } finally {
                view.destroy()
            }
        }
    }
}
