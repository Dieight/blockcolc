package com.blockcolc.preview

import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.domain.*
import com.blockcolc.focus.*
import com.blockcolc.storage.*
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Host orchestrator handles actual Home/lock/SIGKILL; no pretend lifecycle calls. */
class P2BackgroundControlTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private val runtime get()=PreviewRuntime.get(context)
    @Test fun inspectPlatformCapabilitiesWithoutOpeningStore() {
        // Read the platform APIs after restoring the battery policy. A denied
        // AppOp alone is insufficient while an OEM battery exemption is active.
        // Do not open the runtime, reconcile deadlines or change any setting.
        val platform=FocusPlatform(context)
        val power=context.getSystemService(android.os.PowerManager::class.java)
        File(context.filesDir,"p2-platform-capabilities-after.json").writeText(JSONObject()
            .put("pureRead",true).put("at",System.currentTimeMillis()).put("notify",platform.notificationAllowed())
            .put("exact",platform.exactAllowed()).put("ignoringBatteryOptimizations",power.isIgnoringBatteryOptimizations(context.packageName)).toString())
    }
    @Test fun prepare() {
        val args=InstrumentationRegistry.getArguments();val label=args.getString("case")!!;require(label.matches(Regex("[a-z0-9-]{1,60}")))
        val focus=args.getString("focusMs")?.toLong()?:6000;val rest=args.getString("restMs")?.toLong()?:3000
        val rounds=args.getString("rounds")?.toInt()?:3;val auto=args.getString("auto")!="false"
        runtime.testDatabase(true).get(30,TimeUnit.SECONDS)
        val initial=DomainDocument.parse(context.assets.open("p2-fixture-domain.json").bufferedReader().use{it.readText()})
        var prepared=initial
        val outcome=runtime.testOperation{c->
            val now=System.currentTimeMillis();c.importBackup("fixture",BackupCodec.read(BackupCodec.write(initial,DomainTime.format(now))),now)
            val date=DomainTime.localDate(DomainTime.format(now),"Asia/Shanghai")
            val reward=JSONObject().put("schemaVersion",1).put("id","p2-reward").put("title","奖励样本").put("bounds",JSONObject().put("minX",0).put("maxX",0).put("minY",0).put("maxY",0).put("minZ",0).put("maxZ",0))
                .put("voxels",JSONArray().put(JSONObject().put("x",0).put("y",0).put("z",0).put("materialId","stone").put("stage","foundation").put("buildOrder",1000)))
            c.command("reward-resource",DomainEngine.command("ImportDecorationBlueprint","blueprint" to reward),now)
            c.command("goal",DomainEngine.command("SetDailyGoal","date" to date,"targetPomodoros" to 1),now)
            c.command("birthday",DomainEngine.command("ConfigureBirthday","enabled" to true,"month" to date.substring(5,7).toInt(),"day" to date.substring(8).toInt()),now)
            c.command("observe",DomainEngine.command("ObserveBirthday"),now)
            prepared=c.load().domain
            val exact=args.getString("endDurationMs")?.toLong()?.let{DomainTime.format(now+it)}
            c.confirm("confirm",PlanRequest(UUID.randomUUID().toString(),"complex-0",null,PlanMode.MINIMAL,rounds,focus,rest,exact),now)
            c.start("start",auto,now)
        }.get(30,TimeUnit.SECONDS)
        val report=JSONObject().put("case",label).put("initial",prepared.canonical).put("focusMs",focus).put("restMs",rest).put("rounds",rounds).put("automatic",auto)
            .put("pid",android.os.Process.myPid()).put("database",runtime.latest.ticket!!.database).put("plan",outcome.state.recovery.plan!!.id)
            .put("startedAt",outcome.state.domain.json().getJSONObject("activeFocusSession").getString("startedAt"))
        outcome.state.recovery.plan!!.exactEndAt?.let{report.put("exactEndAt",it)}
        File(context.filesDir,"p2-prepared-$label.json").writeText(report.toString())
        assertEquals(PlanPhase.FOCUS,outcome.state.recovery.plan!!.phase)
    }
    @Test fun inspectSavedStateWithoutResumingOrCompletingAnything() {
        // Used only AFTER host copied the pre-resume live file. Merely loading
        // the DB cannot complete a focus or infer an automatic authorization.
        val result=runtime.testRead().get(30,TimeUnit.SECONDS)
        val args=InstrumentationRegistry.getArguments();val label=args.getString("case")!!;require(label.matches(Regex("[a-z0-9-]{1,60}")))
        File(context.filesDir,"p2-inspected-$label.json").writeText(JSONObject().put("domain",result.domain.json()).put("recovery",JSONObject(result.recovery.canonical())).toString())
    }
    @Test fun restoreOriginalPreviewDatabase() {
        runtime.testDatabase(false).get(30,TimeUnit.SECONDS)
        assertTrue(runtime.latest.error==null)
    }
}
