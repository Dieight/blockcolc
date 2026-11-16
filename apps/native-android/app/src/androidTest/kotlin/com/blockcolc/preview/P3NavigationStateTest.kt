package com.blockcolc.preview

import android.content.Intent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.domain.*
import com.blockcolc.storage.BackupCodec
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.TimeUnit

/** Real composition root; tabs, child scroll gestures and Activity recreation.
 * Facts/preferences use the existing isolated actor and are restored finally. */
class P3NavigationStateTest {
    @get:Rule val compose=createEmptyComposeRule()
    private val context=InstrumentationRegistry.getInstrumentation().targetContext
    private val runtime get()=PreviewRuntime.get(context)

    @Test(timeout=480000) fun routesRetainReadingPositionsDisclosuresAndDraftsAndSwipeBothWays(){
        runtime.testDatabase(true).get(30,TimeUnit.SECONDS)
        var preferences=false;var activity:ActivityScenario<MainActivity>?=null
        try {
            runtime.testClientPreferences(true).get(30,TimeUnit.SECONDS);preferences=true
            val now=System.currentTimeMillis()
            val tasks=JSONArray((0 until 35).map{JSONObject().put("id","task-$it").put("title","施工项目 $it")})
            val created=DomainEngine.execute(DomainEngine.initial("UTC"),DomainEngine.command("CreateProject","projectId" to "navigation-project","title" to "页面状态工坊","blueprintId" to "builtin-small-workshop","subtasks" to tasks),now)
            check(created.ok){created.error!!}
            runtime.testOperation{it.importBackup("navigation-state",BackupCodec.read(BackupCodec.write(created.state,DomainTime.format(now))),now)}.get(30,TimeUnit.SECONDS)
            runtime.testFirstUse(false,false).get(30,TimeUnit.SECONDS)
            runtime.updatePreferences{it.copy(minimalMode=false,themeMode="light",realWeatherEnabled=false,autoCheckUpdates=false,quickNotesEnabled=true)}
            compose.waitUntil(15000){!runtime.latest.preferencesSaving&&runtime.latest.preferences.quickNotesEnabled}
            activity=ActivityScenario.launch(Intent(context,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            compose.waitUntil(60000){compose.onAllNodesWithTag("workspace-ready").fetchSemanticsNodes().isNotEmpty()}
            fun tab(label:String){compose.onNodeWithContentDescription(label).performClick();compose.waitForIdle()}
            fun scroller(page:String)=compose.onAllNodes(hasScrollAction() and hasAnyAncestor(hasTestTag("native-page-$page"))).onFirst()
            fun position(page:String)=scroller(page).fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
            fun selected(label:String)=compose.onNodeWithContentDescription(label).assertIsSelected()
            fun swipe(page:String,left:Boolean,distance:Float=.72f){
                compose.onNodeWithTag("native-page-$page").performTouchInput{
                    // Use the free page heading, not the statistics heatmap:
                    // dragging the heatmap intentionally belongs to date selection.
                    val y=if(page=="timer")height*.78f else height*.04f
                    val a=if(left)width*(.5f+distance/2)else width*(.5f-distance/2)
                    val b=if(left)width*(.5f-distance/2)else width*(.5f+distance/2)
                    swipe(Offset(a,y),Offset(b,y),400)
                };compose.waitForIdle()
            }
            tab("任务")
            scroller("tasks").performTouchInput{swipeUp()};compose.waitForIdle()
            val taskPosition=position("tasks");assertTrue(taskPosition>100)
            tab("设置");tab("任务");assertEquals("Without an editor",taskPosition,position("tasks"),1f)
            tab("设置")
            compose.onNodeWithTag("settings-search").performTextInput("休息")
            tab("任务");assertEquals(taskPosition,position("tasks"),1f)
            tab("设置");compose.onNodeWithTag("settings-search").assertTextContains("休息")
            compose.onNodeWithTag("settings-search").performTextClearance()
            compose.onNodeWithTag("setting-普通任务").performScrollTo().performTouchInput{click()}
            compose.onNodeWithTag("setting-本地备份").performScrollTo().performTouchInput{click()}
            compose.waitForIdle()
            val settingsPosition=position("settings");assertTrue(settingsPosition>100)
            tab("任务");tab("设置");assertEquals(settingsPosition,position("settings"),1f)
            compose.onNodeWithText("导入与导出").assertExists()
            // Recreate the Activity without replacing the database or clearing
            // state. The selected page, open backup section and offset survive.
            activity.recreate();compose.waitForIdle()
            selected("设置");assertEquals(settingsPosition,position("settings"),2f)
            compose.onNodeWithText("导入与导出").assertExists()
            tab("计时")
            swipe("timer",true);selected("任务")
            assertEquals(taskPosition,position("tasks"),1f)
            swipe("tasks",false);selected("计时")
            // Short, slow drag cancels; vertical scroll doesn't change a tab.
            swipe("timer",true,.08f);selected("计时")
            tab("任务");scroller("tasks").performTouchInput{swipeDown()};selected("任务")
            // World drag remains world rotation, never a page swipe.
            tab("计时")
            compose.onNodeWithTag("native-page-timer").performTouchInput{swipe(Offset(width*.75f,height*.2f),Offset(width*.25f,height*.2f),400)}
            selected("计时")
            tab("设置");swipe("settings",false);selected("统计")
            swipe("statistics",false);selected("任务")
            swipe("tasks",true);selected("统计")
            swipe("statistics",true);selected("设置")
            swipe("settings",true);selected("设置")
        }finally{
            try{activity?.close()}finally{
                try{if(preferences)runtime.testClientPreferences(false).get(30,TimeUnit.SECONDS)}
                finally{runtime.testDatabase(false).get(30,TimeUnit.SECONDS)}
            }
        }
    }
}
