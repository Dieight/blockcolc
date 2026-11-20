package com.blockcolc.export
import org.junit.Test
import org.junit.Assert.*
import org.json.JSONObject
import org.json.JSONArray
import com.blockcolc.storage.*
import com.blockcolc.domain.*
import java.time.LocalDate
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class FocusExportTest {
 @Test fun sourceOracle(){
  val cases=JSONObject(javaClass.getResource("/focus-oracle.json")!!.readText()).getJSONArray("cases")
  assertTrue(cases.length()>80)
  for(i in 0 until cases.length()){
   val row=cases.getJSONObject(i);val data=row.getJSONObject("state");val before=data.toString()
   val result=FocusExport.projectData(data,RecoveryContext(),LocalDate.parse(row.getString("from")),DomainTime.millis(row.getString("at")))
   assertEquals(StrictJson.render(row.getJSONObject("snapshot")),StrictJson.render(result.first.getJSONObject("value")))
   assertEquals(StrictJson.render(row.getJSONArray("days")),StrictJson.render(result.second));assertEquals(before,data.toString())
  }
 }
 @Test fun delayedReportAndShortenedRestUseExactSavedTransition(){
  val data=JSONObject().put("projects",JSONArray()).put("activeFocusSession",JSONObject.NULL).put("focusHistory",JSONArray().put(JSONObject().put("id","done").put("startedAt","2026-10-29T10:00:00.000Z").put("actualDurationMs",300000).put("completedAt","2026-10-29T10:05:00.000Z")))
  val plan=SavedPlan("plan","p",null,PlanMode.MARATHON,1,listOf("done"),PlanPhase.REST,600000,300000,phaseEndsAt="2026-10-29T10:12:00.000Z",terminalRest=true,restStartedAt="2026-10-29T10:10:00.000Z")
  val value=FocusExport.projectData(data,RecoveryContext(plan),LocalDate.parse("2026-10-29"),DomainTime.millis("2026-10-29T10:11:00.000Z")).first.getJSONObject("value")
  assertThrows(Exception::class.java){FocusExport.projectData(data,RecoveryContext(plan.copy(restStartedAt=null)),LocalDate.parse("2026-10-29"),DomainTime.millis("2026-10-29T10:11:00.000Z"))}
  assertEquals("2026-10-29T10:10:00.000Z",value.getString("startedAt"));assertEquals(60000,value.getLong("estimatedElapsedMs"));assertEquals("休息",value.getString("currentName"));assertEquals(5,value.length())
 }
 @Test fun cloudUsesTheWholeTimedPlanAndOpenEndedExtension(){
  val now=DomainTime.millis("2026-10-29T10:11:00.000Z")
  val active=JSONObject().put("startedAt",DomainTime.format(now-60000)).put("endsAt",DomainTime.format(now+240000)).put("marathon",true).put("deferredSettlement",true)
  val data=JSONObject().put("projects",JSONArray()).put("activeFocusSession",active).put("focusHistory",JSONArray())
  val plan=SavedPlan("plan","project",null,PlanMode.MINIMAL,2,emptyList(),PlanPhase.FOCUS,300000L,0L,exactEndAt=DomainTime.format(now+540000L))
  val day=FocusExport.date(now)
  val planned=FocusExport.projectData(data,RecoveryContext(plan),day,now,cloudPresence=true).first.getJSONObject("value")
  assertEquals("专注中",planned.getString("currentName"))
  assertEquals(plan.exactEndAt,planned.getString("estimatedEndsAt"))
  val extension=plan.copy(extendAfterPlan=true,extensionStartedAt=DomainTime.format(now-360000L))
  val live=FocusExport.projectData(data,RecoveryContext(extension),day,now,cloudPresence=true).first.getJSONObject("value")
  assertEquals("专注中",live.getString("currentName"));assertTrue(live.isNull("estimatedEndsAt"))
  assertEquals(360000L,live.getLong("estimatedElapsedMs"));assertEquals(extension.extensionStartedAt,live.getString("startedAt"))
 }
 @Test fun noopDoesNotReadClockOrProject(){
  val lane=ExportLane(null){error("standard must not scan")}
  lane.offer("db",StoredState(StateToken(0,0),DomainEngine.initial("UTC"),RecoveryContext()));lane.close()
 }
 @Test fun failedInflightConflatesToNewestCommittedInput(){
  val entered=CountDownLatch(1);val release=CountDownLatch(1);val done=CountDownLatch(1);val sources=java.util.Collections.synchronizedList(mutableListOf<String>())
  val sink=object:ExportSink {
   override val enrolledDate=LocalDate.parse("2026-10-29")
   override fun publish(source:String,snapshot:JSONObject,days:JSONArray){sources.add(source);if(sources.size==1){entered.countDown();check(release.await(2,TimeUnit.SECONDS));throw IllegalStateException("synthetic failure")};done.countDown()}
  }
  val lane=ExportLane(sink){DomainTime.millis("2026-10-29T10:00:00.000Z")}
  val doc=DomainEngine.initial("UTC")
  lane.offer("db",StoredState(StateToken(1,0),doc,RecoveryContext()));assertTrue(entered.await(2,TimeUnit.SECONDS))
  lane.offer("db",StoredState(StateToken(2,1),doc,RecoveryContext()));lane.offer("db",StoredState(StateToken(3,1),doc,RecoveryContext()));lane.offer("db",StoredState(StateToken(99,0),doc,RecoveryContext()));release.countDown()
  assertTrue(done.await(8,TimeUnit.SECONDS));assertEquals(listOf("db:0","db:1"),sources.toList());lane.close()
 }
 @Test fun databaseBarrierJoinsInflightAndDiscardsPendingAndPausedOffers(){
  val entered=CountDownLatch(1);val release=CountDownLatch(1);val paused=CountDownLatch(1);val done=CountDownLatch(1)
  val sources=java.util.Collections.synchronizedList(mutableListOf<String>())
  val sink=object:ExportSink{
   override val enrolledDate=LocalDate.parse("2026-10-29")
   override fun publish(source:String,snapshot:JSONObject,days:JSONArray){
    sources.add(source);if(source=="real-old:0"){entered.countDown();check(release.await(2,TimeUnit.SECONDS))}else done.countDown()
   }
  }
  val lane=ExportLane(sink){DomainTime.millis("2026-10-29T10:00:00.000Z")}
  val state=StoredState(StateToken(1,0),DomainEngine.initial("UTC"),RecoveryContext())
  try{
   lane.offer("real-old",state);assertTrue(entered.await(2,TimeUnit.SECONDS))
   lane.offer("queued-old",state)
   val switch=Thread{lane.pauseAndDiscard();paused.countDown()};switch.start()
   // pause cannot finish while a real publish already owns the gate.
   val until=System.nanoTime()+TimeUnit.SECONDS.toNanos(2)
   while(!lane.suspended&&System.nanoTime()<until)Thread.yield()
   assertTrue(lane.suspended);assertEquals(1L,paused.count);release.countDown();assertTrue(paused.await(2,TimeUnit.SECONDS))
   lane.offer("synthetic",state);lane.resume();lane.offer("restored",state)
   assertTrue(done.await(2,TimeUnit.SECONDS));assertEquals(listOf("real-old:0","restored:0"),sources.toList())
  }finally{release.countDown();lane.close()}
 }

}
