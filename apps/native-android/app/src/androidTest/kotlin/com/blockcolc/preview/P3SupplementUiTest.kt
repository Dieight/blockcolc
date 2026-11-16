package com.blockcolc.preview

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.width
import com.blockcolc.presentation.ClientPreferences
import com.blockcolc.presentation.UiResources
import com.blockcolc.preview.ui.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class P3SupplementUiTest {
    @get:Rule val compose=createComposeRule()
    @Test fun revealingAnEndControlIsSeparateFromEndingTheFocus(){
        var ended=0
        compose.setContent{NativeTheme(ClientPreferences(),UiResources.load()){NativeFocusExitControl(true,{ended++})}}
        compose.onNodeWithText("结束本次专注").assertDoesNotExist()
        compose.onNodeWithContentDescription("专注操作区").performTouchInput{click()}
        compose.onNodeWithText("结束本次专注").assertDoesNotExist()
        compose.onNodeWithContentDescription("专注操作区").performTouchInput{doubleClick()}
        compose.onNodeWithText("结束本次专注").assertIsDisplayed()
        compose.runOnIdle{assertEquals(0,ended)}
        compose.onNodeWithText("结束本次专注").performClick()
        compose.runOnIdle{assertEquals(1,ended)}
    }
    @Test fun pixelToggleHasOneAccessibleSwitchAndDisabledStateCannotChangeIt(){
        var checked by mutableStateOf(false);var enabled by mutableStateOf(true);var changes=0
        compose.setContent{NativeTheme(ClientPreferences(),UiResources.load()){
            NativeToggle("Demo switch",null,checked,enabled){checked=it;changes++}
        }}
        val off=SemanticsMatcher.expectValue(SemanticsProperties.ToggleableState,ToggleableState.Off)
        val on=SemanticsMatcher.expectValue(SemanticsProperties.ToggleableState,ToggleableState.On)
        compose.onAllNodes(off).assertCountEquals(1);compose.onNode(off).performClick()
        compose.onAllNodes(on).assertCountEquals(1)
        compose.runOnIdle{assertTrue(checked);assertEquals(1,changes);enabled=false}
        compose.onNode(on).assertIsNotEnabled().performTouchInput{click()}
        compose.runOnIdle{assertTrue(checked);assertEquals(1,changes)}
    }
    @Test fun mixedTypographyRendersBodyInSystemFontAndTheClockInPixelFont(){
        compose.setContent{NativeTheme(ClientPreferences(fontStyle="mixed"),UiResources.load()){
            androidx.compose.foundation.layout.Column{
                Text("Read this",style=MaterialTheme.typography.bodyLarge)
                Text("25:00",style=MaterialTheme.typography.displayLarge)
            }
        }}
        fun style(text:String):TextLayoutResult {
            val layouts=mutableListOf<TextLayoutResult>()
            compose.onNodeWithText(text).performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.GetTextLayoutResult){assertTrue(it(layouts))}
            return layouts.single()
        }
        assertEquals(FontFamily.Default,style("Read this").layoutInput.style.fontFamily)
        assertNotEquals(FontFamily.Default,style("25:00").layoutInput.style.fontFamily)
    }
    @Test fun largeTextSegmentsStackWholeLabelsAndStillSelectTheSavedOption(){
        var choice by mutableStateOf("system")
        compose.setContent{
            val density=LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density,2f)){
                NativeTheme(ClientPreferences(fontStyle="mixed"),UiResources.load()){
                    androidx.compose.foundation.layout.Box(androidx.compose.ui.Modifier.width(320.dp)){
                        NativeSegments(listOf("system" to "System font","pixel" to "Pixel font","mixed" to "Mixed fonts"),choice,{choice=it})
                    }
                }
            }
        }
        var previousBottom=Float.NEGATIVE_INFINITY
        for(label in listOf("System font","Pixel font","Mixed fonts")){
            val node=compose.onNodeWithText(label);val text=mutableListOf<TextLayoutResult>()
            node.performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.GetTextLayoutResult){assertTrue(it(text))}
            assertEquals(1,text.single().lineCount)
            val bounds=node.fetchSemanticsNode().boundsInRoot
            assertTrue("Large labels must occupy separate rows",bounds.top>=previousBottom);previousBottom=bounds.bottom
        }
        compose.onNodeWithText("Mixed fonts").performClick();compose.runOnIdle{assertEquals("mixed",choice)}
    }
}
