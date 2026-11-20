package com.blockcolc.preview

import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.cloud.CloudTransport
import com.blockcolc.domain.DomainEngine
import com.blockcolc.presentation.DraftSchedule
import com.blockcolc.presentation.FocusDecision
import com.blockcolc.presentation.FocusDraft
import com.blockcolc.presentation.FocusEndReason
import com.blockcolc.storage.PlanMode
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.net.InetSocketAddress
import java.net.Proxy
import java.util.UUID
import java.util.concurrent.TimeUnit.SECONDS

/** Run the two participants in separate Android users against the same
 * isolated HTTPS service. Each uses its own SQLite, Keystore and device ID. */
class P4CloudDevicesTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val arguments get() = InstrumentationRegistry.getArguments()
    private val runtime get() = PreviewRuntime.get(context)

    @Test fun phone() = participant("phone") { client, matrix, username, password ->
        runtime.create("Device matrix project", false)
        await("initial local project") { runtime.latest.projects.size == 1 && !runtime.latest.busy }
        client.login(username, password, true)
        await("register and upload") { client.snapshot().lastSync != null && client.snapshot().owned && !client.snapshot().busy }
        val project = runtime.latest.projects.single()
        val task = runtime.latest.choices.first { it.id == project.id }.tasks.first().id
        saved { runtime.beginFocus(FocusDraft(project.id, task, PlanMode.ROUNDS, DraftSchedule.Rounds(2)), it) }
        val active = runtime.testRead().get(10, SECONDS).domain.activeFocusSession()!!
        sync(client)
        matrix.mark("focus-in-cloud", JSONObject().put("session", active.getString("id")).put("endsAt", active.getString("endsAt")))
        matrix.waitFor("tablet-observing")
        matrix.mark("phone-disconnected")
        val before = client.snapshot().lastSync
        saved { runtime.decideFocus(FocusDecision.Interrupt(FocusEndReason.OTHER), it) }
        client.refresh()
        await("offline request rejected") { client.snapshot().error == "NETWORK_UNAVAILABLE" && !client.snapshot().busy }
        assertEquals(before, client.snapshot().lastSync)
        val offline = runtime.testRead().get(10, SECONDS)
        assertNull(offline.domain.activeFocusSession())
        assertEquals(1, offline.domain.projectionJson().getJSONArray("focusHistory").length())
        matrix.mark("phone-offline-recorded")
        matrix.waitFor("tablet-recorded")
        matrix.mark("phone-reconnected")
        client.refresh()
        await("execution conflict reported") { client.snapshot().choiceRequired && !client.snapshot().busy }
        assertEquals("EXECUTION_CHANGED", client.snapshot().error)
        assertFalse(client.snapshot().owned)
        assertTrue(client.snapshot().conflicts.any { it.startsWith("focusHistory/") })
        assertEquals(offline.domain.sha256, runtime.testRead().get(10, SECONDS).domain.sha256)
        val revision = client.snapshot().lastSync
        client.choose("cloud")
        await("accept tablet branch") { client.snapshot().lastSync != revision && !client.snapshot().choiceRequired && !client.snapshot().busy }
        val restored = runtime.testRead().get(10, SECONDS)
        assertEquals(matrix.get("tablet-recorded").getString("sha256"), restored.domain.sha256)
        saved(runtime::refreshBackups)
        assertTrue(runtime.latest.roots.any { it.kind == "rollback" && it.domainSha == offline.domain.sha256 })
        matrix.mark("phone-conflict-verified")
        matrix.waitFor("tablet-backup-restored")
        client.refresh()
        await("detect remote restore") { client.snapshot().choiceRequired && !client.snapshot().busy }
        assertEquals("WORKSPACE_REPLACED", client.snapshot().error)
        val beforeRestore = client.snapshot().lastSync
        client.choose("cloud")
        await("accept remote restore") { client.snapshot().lastSync != beforeRestore && !client.snapshot().choiceRequired && !client.snapshot().busy }
        val after = runtime.testRead().get(10, SECONDS)
        assertNull(after.recovery.plan)
        assertNull(after.recovery.automatic)
        assertEquals(restored.domain.sha256, after.domain.sha256)
        matrix.mark("phone-restore-verified")
    }

    @Test fun tablet() = participant("tablet") { client, matrix, username, password ->
        matrix.waitFor("focus-in-cloud")
        client.login(username, password, false)
        await("second device login") { client.snapshot().lastSync != null && !client.snapshot().busy }
        assertFalse(client.snapshot().owned)
        val active = matrix.get("focus-in-cloud")
        fun assertSameRound() {
            val seen = runtime.testRead().get(10, SECONDS).domain.activeFocusSession()!!
            assertEquals(active.getString("session"), seen.getString("id"))
            assertEquals(active.getString("endsAt"), seen.getString("endsAt"))
        }
        assertSameRound()
        val denied = receipt { runtime.decideFocus(FocusDecision.Interrupt(FocusEndReason.OTHER), it) }
        assertFalse(denied.saved)
        assertSameRound()
        matrix.mark("tablet-observing")
        matrix.waitFor("phone-offline-recorded")
        val old = client.snapshot().lastSync
        client.takeover()
        await("take over saved round") { client.snapshot().owned && client.snapshot().lastSync != old && !client.snapshot().busy }
        assertSameRound()
        saved { runtime.decideFocus(FocusDecision.CompleteEarly, it) }
        sync(client)
        val after = runtime.testRead().get(10, SECONDS)
        assertNull(after.domain.activeFocusSession())
        assertEquals(1, after.domain.projectionJson().getJSONArray("focusHistory").length())
        matrix.mark("tablet-recorded", JSONObject().put("sha256", after.domain.sha256))
        matrix.waitFor("phone-conflict-verified")
        val beforeBackup = client.snapshot().lastSync
        client.captureBackup()
        await("save cloud backup") { client.snapshot().backup != null && client.snapshot().lastSync != beforeBackup && !client.snapshot().busy }
        saved { runtime.command(DomainEngine.command("AddQuickNote", "noteId" to "after-backup", "text" to "After backup"), it) }
        sync(client)
        assertTrue(runtime.latest.notes.any { it.id == "after-backup" })
        val beforeRestore = client.snapshot().lastSync
        client.restoreBackup()
        await("restore cloud backup") { client.snapshot().lastSync != beforeRestore && !client.snapshot().busy }
        assertNull(client.snapshot().error)
        val restored = runtime.testRead().get(10, SECONDS)
        assertEquals(after.domain.sha256, restored.domain.sha256)
        assertNull(restored.recovery.plan)
        assertNull(restored.recovery.automatic)
        matrix.mark("tablet-backup-restored")
        matrix.waitFor("phone-restore-verified")
    }

    private fun participant(role: String, run: (NativeCloudController, Matrix, String, String) -> Unit) {
        check(BuildConfig.NATIVE_DIAGNOSTICS)
        assumeTrue("Requires the isolated HTTPS matrix fixture", arguments.containsKey("p4CloudControl"))
        val control = checkNotNull(arguments.getString("p4CloudControl")).toInt()
        val data = checkNotNull(arguments.getString("p4CloudData")).toInt()
        val matrix = Matrix(role, transport(control))
        val setup = matrix.get("setup")
        check(setup.getBoolean("localOnly"))
        val directory = File(context.noBackupFilesDir, "cloud-test-" + UUID.randomUUID())
        val database = runtime.testDatabase(true, prepareAssets = false).get(30, SECONDS)
        var controller: NativeCloudController? = null
        var preferences = false
        var cloud = false
        try {
            runtime.testClientPreferences(true).get(20, SECONDS)
            preferences = true
            runtime.testCloud(true).get(20, SECONDS)
            cloud = true
            val client = NativeCloudController.isolated(context, runtime, transport(data), directory)
            controller = client
            client.start()
            await("local controller") { client.snapshot().ready }
            run(client, matrix, setup.getString("username"), setup.getString("password"))
            client.logout()
            await("log out") { client.snapshot().account == null && !client.snapshot().busy }
        } finally {
            controller?.testClose()
            if (cloud) runtime.testCloud(false).get(20, SECONDS)
            if (preferences) runtime.testClientPreferences(false).get(20, SECONDS)
            runtime.testDatabase(false, prepareAssets = false).get(30, SECONDS)
            context.deleteDatabase(database)
            if (directory.isDirectory) directory.deleteRecursively()
        }
    }

    private fun transport(port: Int) = CloudTransport(context, proxy = Proxy(Proxy.Type.HTTP, InetSocketAddress("127.0.0.1", port)),
        totalTimeoutMillis = 6000)

    private fun sync(client: NativeCloudController) {
        val before = client.snapshot().lastSync
        client.refresh()
        await("workspace sync") { client.snapshot().lastSync != before && !client.snapshot().busy }
        assertNull(client.snapshot().error)
    }

    private fun receipt(run: (String) -> Unit): UiReceipt {
        val request = UUID.randomUUID().toString()
        run(request)
        await("focus or workspace command") { runtime.latest.receipts.any { it.id == request } && !runtime.latest.busy }
        return runtime.latest.receipts.first { it.id == request }
    }

    private fun saved(run: (String) -> Unit) {
        val result = receipt(run)
        assertTrue("Operation rejected: ${result.reason}", result.saved)
    }

    private class Matrix(private val role: String, private val transport: CloudTransport) {
        fun get(step: String): JSONObject = transport.request("/v1/test/device-matrix/$step", timeoutMillis = 3000)
        fun mark(step: String, facts: JSONObject = JSONObject()) {
            transport.request("/v1/test/device-matrix/$step", "POST", body = facts.put("role", role).toString(), timeoutMillis = 3000)
        }
        fun waitFor(step: String) = await(step) { get(step).optBoolean("ready") }
    }

    private companion object {
        fun await(label: String, condition: () -> Boolean) {
            val end = SystemClock.elapsedRealtime() + 40_000
            while (!condition() && SystemClock.elapsedRealtime() < end) SystemClock.sleep(50)
            assertTrue("Timed out: $label", condition())
        }
    }
}
