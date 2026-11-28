package com.blockcolc.preview.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
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
    var focused by remember{mutableStateOf(false)}
    val results=remember(query){SettingsCatalog.search(query)}
    fun go(entry:SettingsEntry){focus.clearFocus();keyboard?.hide();jump.go(entry);query=""}
    val searchLabel=ui.text("搜索设置")
    val colors=MaterialTheme.colorScheme
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min=48.dp)
            .drawBehind{
                drawLine(if(focused)colors.primary else colors.outlineVariant,Offset(0f,size.height),Offset(size.width,size.height),if(focused)1.5.dp.toPx()else 1.dp.toPx())
            }
            .padding(vertical=6.dp),
        verticalAlignment=Alignment.CenterVertically,
        horizontalArrangement=Arrangement.spacedBy(10.dp),
    ){
        PixelGlyph("search",Modifier.size(18.dp),if(focused)colors.primary else colors.onSurfaceVariant)
        BasicTextField(
            value=query,
            onValueChange={query=it},
            modifier=Modifier
                .weight(1f)
                .onFocusChanged{focused=it.isFocused}
                .testTag("settings-search")
                .semantics{contentDescription=searchLabel},
            singleLine=true,
            textStyle=MaterialTheme.typography.bodyLarge.copy(color=colors.onSurface),
            cursorBrush=SolidColor(colors.primary),
            keyboardOptions=KeyboardOptions(imeAction=ImeAction.Search),
            keyboardActions=KeyboardActions(onSearch={results.firstOrNull()?.let(::go)}),
            decorationBox={inner->
                Box(contentAlignment=Alignment.CenterStart){
                    if(query.isEmpty())Text(searchLabel,style=MaterialTheme.typography.bodyLarge,color=colors.onSurfaceVariant)
                    inner()
                }
            },
        )
        if(query.isNotEmpty()){
            NativeIconAction(ui.text("清除搜索"),"close",{query=""})
        }
    }
    if(query.isNotBlank()){
        if(results.isEmpty())Text(ui.text("没有找到设置"),style=MaterialTheme.typography.bodySmall,color=colors.onSurfaceVariant)
        else Column(Modifier.fillMaxWidth()){
            for((index,entry) in results.withIndex()){
                if(index>0)NativeSeparator()
                NativeSettingLink(ui.text(entry.title),{go(entry)},description=ui.text(SettingsCatalog.group(entry.group).title),modifier=Modifier.testTag("settings-result-${entry.id}"))
            }
            NativeSeparator()
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable internal fun NativeSettingAnchor(id:String,content:@Composable ()->Unit){
    val jump=LocalSettingsJump.current;val requester=remember{BringIntoViewRequester()}
    var measured by remember{mutableStateOf(IntSize.Zero)}
    val cap=with(LocalDensity.current){(LocalConfiguration.current.screenHeightDp.dp*.6f).toPx()}
    val serial=jump?.serial?:0
    LaunchedEffect(serial){if(jump?.target?.id==id){delay(300);withFrameNanos{}
        requester.bringIntoView(Rect(0f,0f,measured.width.toFloat(),minOf(measured.height.toFloat(),cap)))
    }}
    Column(Modifier.fillMaxWidth().testTag("setting-$id").bringIntoViewRequester(requester).onSizeChanged{measured=it}){
        content()
    }
}
