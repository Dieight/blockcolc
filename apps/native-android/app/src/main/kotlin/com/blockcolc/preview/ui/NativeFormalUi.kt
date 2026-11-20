package com.blockcolc.preview.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*

/** Roles share one hierarchy in all font modes. Mixed mode reserves pixel
 * glyphs for numbers and short labels; task names and prose remain system text. */
internal enum class NativeTextRole { CAPTION, BODY, SECTION, TITLE, NUMBER, CLOCK, IMMERSIVE_CLOCK }
@Composable internal fun NativeText(text:String,role:NativeTextRole=NativeTextRole.BODY,modifier:Modifier=Modifier,color:Color=LocalContentColor.current,maxLines:Int=Int.MAX_VALUE,accent:Boolean=false){
    val type=MaterialTheme.typography
    val style=when(role){
        NativeTextRole.CAPTION->if(accent)type.labelMedium else type.bodySmall
        NativeTextRole.BODY->if(accent)type.labelLarge else type.bodyLarge
        NativeTextRole.SECTION->type.titleMedium
        NativeTextRole.TITLE->type.titleLarge
        NativeTextRole.NUMBER->type.displaySmall
        NativeTextRole.CLOCK->type.displayMedium
        NativeTextRole.IMMERSIVE_CLOCK->type.displayLarge
    }
    if(role==NativeTextRole.CLOCK||role==NativeTextRole.IMMERSIVE_CLOCK){
        val measure=androidx.compose.ui.text.rememberTextMeasurer();val density=androidx.compose.ui.platform.LocalDensity.current
        BoxWithConstraints(modifier.fillMaxWidth(),contentAlignment=Alignment.Center){
            val width=with(density){maxWidth.toPx()};val measured=measure.measure(text,style,softWrap=false,maxLines=1).size.width
            val ratio=if(measured>0)(width/measured).coerceAtMost(1f)else 1f
            Text(text,color=color,style=style.copy(fontSize=style.fontSize*ratio,lineHeight=style.lineHeight*ratio),maxLines=1)
        }
    }else Text(text,modifier,color=color,style=style,maxLines=maxLines,overflow=TextOverflow.Ellipsis)
}
@Composable internal fun FormalCard(modifier:Modifier=Modifier,padding:Dp=16.dp,content:@Composable ColumnScope.()->Unit){
    Column(modifier.fillMaxWidth().border(1.dp,MaterialTheme.colorScheme.outlineVariant).background(MaterialTheme.colorScheme.surface).padding(1.dp).padding(padding),content=content)
}
@Composable internal fun FormalTextAction(label:String,icon:String,onClick:()->Unit,modifier:Modifier=Modifier,enabled:Boolean=true){
    val ui=LocalNativeUi.current;var motion by remember{mutableIntStateOf(0)}
    val interaction=remember{MutableInteractionSource()};val pressed by interaction.collectIsPressedAsState()
    Row(modifier.sizeIn(minWidth=44.dp,minHeight=44.dp).graphicsLayer{translationY=if(pressed&&enabled&&!ui.reduceMotion)1.dp.toPx()else 0f}.clickable(enabled=enabled,role=Role.Button,interactionSource=interaction,indication=null){motion++;onClick()},
        horizontalArrangement=Arrangement.spacedBy(8.dp,Alignment.CenterHorizontally),verticalAlignment=Alignment.CenterVertically){
        if(icon.isNotEmpty())NativeMotionGlyph(icon,motion,Modifier.size(20.dp),if(enabled)LocalContentColor.current else MaterialTheme.colorScheme.onSurfaceVariant)
        NativeText(label,NativeTextRole.BODY,Modifier.weight(1f,fill=false),color=if(enabled)LocalContentColor.current else MaterialTheme.colorScheme.onSurfaceVariant,accent=true)
    }
}
/** The source uses this quieter glass action for immersed settlement/end. */
@OptIn(ExperimentalFoundationApi::class)
@Composable internal fun FormalGlassAction(label:String,onClick:()->Unit,modifier:Modifier=Modifier,pending:Boolean=false,enabled:Boolean=true,danger:Boolean=false,reading:Boolean=false,selected:Boolean=false,onDoubleClick:(()->Unit)?=null){
    val colors=MaterialTheme.colorScheme;val dark=colors.background.luminance()<.5f;val reduced=LocalNativeUi.current.reduceMotion
    val ink=if(reading)LocalContentColor.current else if(danger)colors.error else if(dark)Color(0xff7fd6a1)else Color(0xff276749)
    val tint=if(dark)Color(0xff1b2d23)else Color(0xffdeebe2)
    val interaction=remember{MutableInteractionSource()};val pressed by interaction.collectIsPressedAsState()
    val shift by androidx.compose.animation.core.animateFloatAsState(if(pressed&&enabled&&!pending)1f else 0f,androidx.compose.animation.core.tween(70),label="glass-press")
    val touch=if(onDoubleClick!=null)Modifier.combinedClickable(enabled=enabled&&!pending,role=Role.Button,
        interactionSource=interaction,indication=null,onClick=onClick,onDoubleClick=onDoubleClick)
    else Modifier.clickable(enabled=enabled&&!pending,role=Role.Button,interactionSource=interaction,indication=null,onClick=onClick)
    Row(modifier.fillMaxWidth().heightIn(min=if(reading)44.dp else 48.dp).graphicsLayer{translationY=if(reduced)0f else shift*density}.border(1.dp,ink.copy(alpha=if(selected)1f else if(reading).12f else .35f)).background(if(reading)Color.Transparent else tint.copy(alpha=.96f))
        .then(touch).semantics{if(reading)this.selected=selected}.padding(if(reading)10.dp else 12.dp),
        verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp,Alignment.CenterHorizontally)){
        CompositionLocalProvider(LocalContentColor provides ink){if(pending)NativeBusy();NativeText(label,NativeTextRole.BODY,color=ink)}
    }
}
@Composable internal fun FormalProgress(value:Int,max:Int=10000,segments:Int=16,modifier:Modifier=Modifier){
    val colors=MaterialTheme.colorScheme
    Canvas(modifier.fillMaxWidth().height(8.dp).semantics{progressBarRangeInfo=ProgressBarRangeInfo(value.toFloat(),0f..max.coerceAtLeast(1).toFloat())}){
        val gap=3.dp.toPx();val width=((size.width-gap*(segments-1))/segments).coerceAtLeast(1f)
        val filled=if(max<=0)0f else (value.toFloat()/max*segments).coerceIn(0f,segments.toFloat())
        repeat(segments){
            val origin=Offset(it*(width+gap),0f);drawRect(colors.outlineVariant,origin,Size(width,size.height))
            val fraction=(filled-it).coerceIn(0f,1f);if(fraction>0)drawRect(colors.primary,origin,Size(width*fraction,size.height))
        }
    }
}

@Composable internal fun FormalStatisticDuration(ms:Long,modifier:Modifier=Modifier){
    val value=formatDuration(ms);val type=MaterialTheme.typography;val color=LocalContentColor.current
    val text=androidx.compose.ui.text.buildAnnotatedString{
        append(value)
        addStyle(type.bodyLarge.toSpanStyle(),0,length)
        for(match in Regex("[0-9]+").findAll(value))addStyle(type.displaySmall.toSpanStyle(),match.range.first,match.range.last+1)
    }
    Text(text,modifier,color=color,style=type.displaySmall)
}
