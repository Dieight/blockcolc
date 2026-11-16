package com.blockcolc.preview

import android.util.AtomicFile
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.presentation.*
import com.blockcolc.preview.ui.*
import com.blockcolc.domain.*
import com.blockcolc.focus.*
import com.blockcolc.storage.*
import com.blockcolc.storage.android.AndroidStateDatabase
import com.blockcolc.world.generation.BuiltinBlueprintCatalog
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.util.UUID

/** Component tests use isolated in-memory callbacks and a unique cache file.
 * They never select a runtime database or change the device calendar. */
class P3NativeRewardsTest {
    @get:Rule val compose=createComposeRule()
    private fun theme(content:@Composable ()->Unit){
        compose.setContent{NativeTheme(ClientPreferences(),UiResources.load()){content()}}
    }
    @Test fun holidayAndBirthdayAreSeparatePixelButtonsAndOnlyTheClickedIntroductionAppears(){
        theme{NativeOccasionEmblems("2026-12-25",0,BirthdaySettings(true,12,25))}
        compose.onNodeWithContentDescription("圣诞节 · 常青树").assertIsDisplayed().performClick()
        compose.onNodeWithText("常青树、礼物与铃铛，是广泛使用的庆祝意象。").assertIsDisplayed()
        compose.onNodeWithText("今天属于你。小蛋糕留在聚落，祝你新的一岁自在生长。").assertDoesNotExist()
        compose.onNodeWithContentDescription("关闭节日介绍").performClick()
        compose.onNodeWithContentDescription("生日快乐 · 生日蛋糕").assertIsDisplayed().performClick()
        compose.onNodeWithText("今天属于你。小蛋糕留在聚落，祝你新的一岁自在生长。").assertIsDisplayed()
        compose.onNodeWithText("常青树、礼物与铃铛，是广泛使用的庆祝意象。").assertDoesNotExist()
        compose.onNodeWithContentDescription("关闭节日介绍").performClick()
    }
    private class Receipts:AchievementReceiptActions {
        var saved=emptySet<String>();var requested=emptyList<String>();var writes=0
        var completion:((Set<String>?,Boolean)->Unit)?=null
        override fun readAchievementReceipts(done:(Set<String>?,Boolean)->Unit){done(saved,false)}
        override fun acknowledgeAchievements(ids:List<String>,done:(Set<String>?,Boolean)->Unit){requested=ids.toList();writes++;completion=done}
        fun finish(failed:Boolean){if(!failed)saved=saved+requested;val done=checkNotNull(completion);completion=null;done(if(failed)null else saved,failed)}
    }
    private fun achievements(excluded:String?=null)=AchievementProjection.definitions.map{AchievementProgress(it,if(it.id==excluded)0 else it.target,it.id!=excluded,null)}
    @Test fun historicalBatchWaitsForReceiptRetryThenOnlyNewAchievementsShow(){
        val port=Receipts();var entries by mutableStateOf(achievements("goals-seven"));var visit by mutableIntStateOf(0)
        theme{key(visit){NativeAchievementUnlock(entries,port)}}
        compose.onNodeWithText("全部关闭").performScrollTo().performClick()
        compose.runOnIdle{assertEquals(19,port.requested.size);assertTrue(port.saved.isEmpty());port.finish(true)}
        compose.onNodeWithText("展示回执未保存，请重试。").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("重试").performClick()
        compose.runOnIdle{port.finish(false)}
        compose.onNodeWithText("新的成就").assertDoesNotExist()
        compose.runOnIdle{visit++};compose.onNodeWithText("新的成就").assertDoesNotExist()
        compose.runOnIdle{assertEquals(19,port.saved.size);entries=achievements()}
        compose.onNodeWithText("七次如约").assertIsDisplayed()
        compose.onNodeWithText("全部关闭").performScrollTo().performClick()
        compose.runOnIdle{assertEquals(listOf("goals-seven"),port.requested);port.finish(false)}
        compose.onNodeWithText("新的成就").assertDoesNotExist()
    }
    @Test fun celebrationWaitsForVisibleWorldPausesAndDoesNotInterceptThePage(){
        val queue=NativeCelebrations();var ready by mutableStateOf(false);var foreground by mutableStateOf(true);var taps by mutableIntStateOf(0)
        compose.mainClock.autoAdvance=false
        queue.accept(listOf("{\"type\":\"ProjectSealedAsMonument\"}"),false)
        theme{Box(Modifier.fillMaxSize()){
            Text("Tap $taps",Modifier.size(100.dp).clickable{taps++})
            NativeCelebrationOverlay(queue,foreground,ready)
        }}
        compose.mainClock.advanceTimeBy(100)
        compose.onNodeWithContentDescription("建筑落成！").assertDoesNotExist()
        compose.runOnIdle{ready=true};compose.mainClock.advanceTimeBy(1000)
        compose.onNodeWithContentDescription("建筑落成！").assertExists()
        compose.onNodeWithText("Tap 0").performClick();compose.runOnIdle{assertEquals(1,taps);foreground=false}
        compose.mainClock.advanceTimeBy(10000);compose.onNodeWithContentDescription("建筑落成！").assertDoesNotExist()
        compose.runOnIdle{foreground=true};compose.mainClock.advanceTimeBy(1000)
        compose.onNodeWithContentDescription("建筑落成！").assertExists()
        compose.mainClock.advanceTimeBy(2500);compose.onNodeWithContentDescription("建筑落成！").assertDoesNotExist()
    }
    @Test fun actualAtomicReceiptsReopenAndBadBytesRemainRecoverable(){
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val folder=File(context.cacheDir,"p3-rewards-${UUID.randomUUID()}");check(folder.mkdir());val file=File(folder,"receipts.json")
        try{
            val receipts=AchievementReceipts(AndroidAchievementReceiptStorage(AtomicFile(file)))
            assertTrue(receipts.read().isEmpty());assertEquals(setOf("focus-first"),receipts.acknowledge(listOf("focus-first")))
            assertEquals(setOf("focus-first"),AchievementReceipts(AndroidAchievementReceiptStorage(AtomicFile(file))).read())
            file.writeText("{}");assertTrue(runCatching{receipts.acknowledge(listOf("focus-ten"))}.isFailure);assertEquals("{}",file.readText())
        }finally{folder.listFiles()?.forEach{check(it.delete())};check(folder.delete())}
    }
    @Test fun actualPackagedDailyPoolRegistersOnceAndGoalAwardsItsSavedBlueprint(){
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val name="p3-rewards-${UUID.randomUUID()}.db";val db=AndroidStateDatabase(context,name)
        try{
            val store=NativeStateStore(db);store.initialize(DomainEngine.initial("UTC"));val c=FocusCoordinator(store,name)
            val catalog=BuiltinBlueprintCatalog.load();val ids=catalog.entries.filter{it.category=="daily"}.map{it.id};assertTrue(ids.isNotEmpty())
            val now=DomainTime.millis("2026-12-25T08:00:00.000Z")
            WorkspaceCommands.commit(c,"create",WorkspaceMutation.CreateProject("p","Work","builtin-timber-house",listOf(WorkspaceMutation.NewSubtask("t","Task"))),now)
            WorkspaceCommands.commit(c,"goal",WorkspaceMutation.DailyGoal("2026-12-25",1),now)
            c.begin("begin",PlanRequest("one","p","t",PlanMode.ROUNDS,1,1000,0),false,now)
            assertEquals(ids.size,DailyRewardRegistration.prepare(c,ids,{catalog.content(it).json()},{"register-$it"},now+2000))
            val registered=c.load()
            assertFalse(registered.domain.json().isNull("activeFocusSession"));assertEquals(0,registered.domain.json().getJSONArray("focusHistory").length())
            assertEquals(0,DailyRewardRegistration.prepare(c,ids,{error("Restart must not reload saved payloads")},{error("Restart must not write")},now))
            assertEquals(registered,c.load())
            val completed=c.reconcile("due",now+2000)
            assertEquals(1,completed.state.domain.json().getJSONArray("decorationRewards").length())
            val world=WorldFacts.from(completed.state.domain);val daily=world.buildings.single().rewards.single{it.blueprint.kind==WorldAssetKind.EMBEDDED}
            assertTrue(daily.resourceId in ids);assertTrue(checkNotNull(daily.blueprint.embeddedCanonical).contains("voxels"))
        }finally{db.close();check(context.deleteDatabase(name))}
    }
}
