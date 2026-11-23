package com.blockcolc.preview.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.offset
import androidx.compose.ui.unit.sp
import com.blockcolc.presentation.*
import kotlinx.coroutines.delay

internal class SettingsJump {
    var target by mutableStateOf<SettingsEntry?>(null)
    var serial by mutableIntStateOf(0)
    fun go(entry:SettingsEntry){target=entry;serial++}
    fun opens(key:String)=target?.let{it.id==key||key in it.parents}==true
}
internal val LocalSettingsJump=staticCompositionLocalOf<SettingsJump?>{null}

@Composable internal fun NativeSettingsNavigation(jump:SettingsJump){
    val ui=LocalNativeUi.current;val keyboard=LocalSoftwareKeyboardController.current;val focus=LocalFocusManager.current
    var query by rememberNativePageState("settings/query"){""}
    val results=remember(query){SettingsCatalog.search(query)}
    fun go(entry:SettingsEntry){focus.clearFocus();keyboard?.hide();jump.go(entry);query=""}
    val searchLabel=ui.text("搜索设置")
    val colors=MaterialTheme.colorScheme
    OutlinedTextField(query,{query=it},Modifier.fillMaxWidth().layout{measurable,constraints->
        // The existing title-to-card gap has room for the floating label.
        val inset=8.sp.roundToPx()
        val field=measurable.measure(constraints.offset(vertical=inset))
        layout(field.width,(field.height-inset).coerceAtLeast(0)){field.placeRelative(0,-inset)}
    }.testTag("settings-search").semantics{contentDescription=searchLabel},
        singleLine=true,label={Text(searchLabel)},shape=RectangleShape,textStyle=MaterialTheme.typography.bodyLarge,
        leadingIcon={PixelGlyph("search",Modifier.size(20.dp),colors.onSurfaceVariant)},
        trailingIcon=if(query.isNotEmpty()){{NativeIconAction(ui.text("清除搜索"),"close",{query=""})}}else null,
        keyboardOptions=KeyboardOptions(imeAction=ImeAction.Search),
        keyboardActions=KeyboardActions(onSearch={results.firstOrNull()?.let(::go)}))
    if(query.isNotBlank()){
        if(results.isEmpty())Text(ui.text("没有找到设置"),style=MaterialTheme.typography.bodySmall)
        else Column(Modifier.fillMaxWidth().border(1.dp,colors.outlineVariant).background(colors.surface).padding(1.dp).padding(horizontal=16.dp)){
            for((index,entry) in results.withIndex()){
                if(index>0)NativeSeparator()
                NativeSettingLink(ui.text(entry.title),{go(entry)},description=ui.text(SettingsCatalog.group(entry.group).title),modifier=Modifier.testTag("settings-result-${entry.id}"))
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable internal fun NativeSettingAnchor(id:String,content:@Composable ()->Unit){
    val jump=LocalSettingsJump.current;val requester=remember{BringIntoViewRequester()}
    var measured by remember{mutableStateOf(IntSize.Zero)}
    // Scale the revealed region with this app window. A fixed 220dp clips the
    // third option after large-font segments switch to their vertical layout.
    val cap=with(LocalDensity.current){(LocalConfiguration.current.screenHeightDp.dp*.6f).toPx()}
    val serial=jump?.serial?:0
    LaunchedEffect(serial){if(jump?.target?.id==id){delay(300);withFrameNanos{}
        // Reveal the control itself, not a one-pixel header at the bottom edge.
        // Bound large expanded libraries so a whole page isn't requested.
        requester.bringIntoView(Rect(0f,0f,measured.width.toFloat(),minOf(measured.height.toFloat(),cap)))
    }}
    Column(Modifier.fillMaxWidth().testTag("setting-$id").bringIntoViewRequester(requester).onSizeChanged{measured=it}){
        content()
    }
}
