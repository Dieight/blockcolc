package com.blockcolc.preview

import androidx.compose.material3.TextField
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.blockcolc.presentation.*
import com.blockcolc.preview.ui.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** No runtime, database, picker or device setting. These retained-composition
 * cases exercise the independent Dialog window, not only page placement. */
class P3PageVisibilityTest {
    @get:Rule val compose=createComposeRule()
    private class Receipts:AchievementReceiptActions {
        var reads=0
        override fun readAchievementReceipts(done:(Set<String>?,Boolean)->Unit){reads++;done(emptySet(),false)}
        override fun acknowledgeAchievements(ids:List<String>,done:(Set<String>?,Boolean)->Unit)=error("No hidden-page acknowledgement is allowed")
    }
    @Test fun precomposedStatisticsDoesNotReadOrOpenAchievementDialogsUntilEntered(){
        val port=Receipts();var active by mutableStateOf(false)
        val entry=AchievementProjection.definitions.first().let{AchievementProgress(it,it.target,true,null)}
        compose.setContent{NativeTheme(ClientPreferences(),UiResources.load(),reduceMotion=true){
            NativePageActivation(active){NativeStatisticsAchievements(listOf(entry),port)}
        }}
        compose.runOnIdle{assertEquals(0,port.reads)}
        compose.onNodeWithText("新的成就").assertDoesNotExist()
        compose.runOnIdle{active=true}
        compose.onNodeWithText("新的成就").assertIsDisplayed()
        compose.runOnIdle{assertEquals(1,port.reads);active=false}
        compose.onNodeWithText("新的成就").assertDoesNotExist()
        compose.runOnIdle{active=true}
        compose.onNodeWithText("新的成就").assertIsDisplayed()
        compose.runOnIdle{assertEquals(2,port.reads)}
    }
    @Test fun hiddenRetainedSheetDropsItsWindowButKeepsAnUnsubmittedFormDraft(){
        var active by mutableStateOf(true);var closes=0
        compose.setContent{NativeTheme(ClientPreferences(),UiResources.load(),reduceMotion=true){
            NativePageActivation(active){NativeSheet(true,{"Draft"},{closes++}){
                var draft by rememberSaveable{mutableStateOf("")}
                TextField(draft,{draft=it},label={androidx.compose.material3.Text("Draft input")})
            }}
        }}
        compose.onNode(hasSetTextAction()).performTextInput("未提交草稿")
        compose.runOnIdle{active=false}
        compose.onNodeWithText("Draft input").assertDoesNotExist()
        compose.runOnIdle{assertEquals(0,closes);active=true}
        compose.onNodeWithText("未提交草稿").assertIsDisplayed()
        compose.runOnIdle{assertEquals(0,closes)}
    }
}
