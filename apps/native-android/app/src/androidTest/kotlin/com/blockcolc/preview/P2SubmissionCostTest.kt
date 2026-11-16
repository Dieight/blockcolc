package com.blockcolc.preview

import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.domain.*
import com.blockcolc.focus.*
import com.blockcolc.storage.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.concurrent.TimeUnit

/** Same real actor, SQLite writer and host adoption as the integrated route,
 * without a renderer competing for CPU. Five groups, seven committed actions.
 * Synthetic fixture only; the selected DB is restored even if a case fails. */
class P2SubmissionCostTest {
    @Test fun measureRealSubmissionPipeline() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val runtime=PreviewRuntime.get(context)
        val initial=DomainDocument.parse(context.assets.open("p2-fixture-domain.json").bufferedReader().use{it.readText()})
        val cases=JSONArray();val report=JSONObject().put("schema",1).put("completed",false).put("cases",cases)
            .put("scope","Actual actor/coordinator/SQLite and host adoption, without world/Compose contention. Five groups of the same 25-building fixture; first start and report remain separate. Not a whole-App latency or engine-only durability benchmark.")
            .put("fixtureSha256",initial.sha256).put("fixtureCharacters",initial.canonical.length)
        var selected=false
        try {
            runtime.testDatabase(true).get(45,TimeUnit.SECONDS);selected=true
            repeat(5) { group ->
                val at=System.currentTimeMillis()+3600000
                val backup=BackupCodec.read(BackupCodec.write(initial,DomainTime.format(at)))
                runtime.testOperation{c->c.importBackup("profile-seed-$group",backup,at)}.get(45,TimeUnit.SECONDS)
                runtime.testRecording(true).get(45,TimeUnit.SECONDS)
                val ops=JSONArray();val sample=JSONObject().put("group",group).put("initial",initial.canonical).put("operations",ops).put("completed",false)
                cases.put(sample)
                listOf("start","early","start","early","start","early","report").forEachIndexed { seq,action ->
                    val input=System.nanoTime();val timing=P2OperationCost();val now=at+seq*1000
                    val result=runtime.testMeasuredOperation(timing){c->when(action){
                        "start"->{if(c.load().recovery.plan==null)c.confirm("confirm",PlanRequest("cost-plan","complex-0",null,PlanMode.MINIMAL,3,60000,0),now);c.start("start-$seq",false,now)}
                        "early"->c.manual("early-$seq",true,false,"other",null,now)
                        else->c.report("report",JSONArray().put(JSONObject().put("reportId","cost-report").put("projectId","complex-0").put("subtaskId","read").put("progressBasisPoints",5000).put("rounds",3)),JSONArray(),now)
                    }}.get(45,TimeUnit.SECONDS)
                    ops.put(JSONObject().put("action",action).put("sequence",seq).put("inputNs",input.toString()).put("savedNs",System.nanoTime().toString()).put("timing",timing.json()))
                    if(action=="report") {
                        assertNull(result.state.recovery.plan)
                        assertEquals(3,result.state.domain.json().getJSONArray("focusHistory").length()-initial.json().getJSONArray("focusHistory").length())
                        sample.put("final",result.state.domain.canonical).put("attribution",FocusProjection.attribution(result.state.domain))
                    }
                }
                sample.put("commands",JSONArray(runtime.testRecording().get(45,TimeUnit.SECONDS))).put("completed",true)
            }
            report.put("completed",true)
        } finally {
            if(selected)runtime.testDatabase(false).get(45,TimeUnit.SECONDS)
            report.put("databaseRestored",!context.getSharedPreferences("p2-storage",0).contains("beforeTest"))
            File(context.filesDir,"p2-submission-cost.json").writeText(report.toString())
        }
    }
}
