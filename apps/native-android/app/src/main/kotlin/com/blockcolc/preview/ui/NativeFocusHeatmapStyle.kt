package com.blockcolc.preview.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

internal fun heatmapBand(durationMs:Long)=when{
    durationMs<=0->0
    durationMs<3*3_600_000L->1
    durationMs<6*3_600_000L->2
    durationMs<9*3_600_000L->3
    else->4
}

@Composable internal fun nativeFocusHeatmapColors():List<Color>{
    val scheme=MaterialTheme.colorScheme
    return if(scheme.background.luminance()<.5f)
        listOf(scheme.outlineVariant,Color(0xff294c38),Color(0xff417d57),Color(0xff5ba671),Color(0xff87d59c))
    else listOf(scheme.outlineVariant,Color(0xffc8dbd2),Color(0xff99b8aa),Color(0xff639780),Color(0xff276749))
}

internal fun DrawScope.drawFocusHeatmapCell(palette:List<Color>,band:Int,origin:Offset,edge:Float,alpha:Float=1f){
    if(band>0)drawRect(palette[band].copy(alpha=alpha),origin,Size(edge,edge))
}

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun NativeFocusHeatmapLegend(
    palette:List<Color>,selectedBand:Int?=null,onBand:((Int)->Unit)?=null,extra:@Composable ()->Unit={},
){
    val ui=LocalNativeUi.current
    FlowRow(Modifier.fillMaxWidth().padding(top=4.dp),horizontalArrangement=Arrangement.spacedBy(6.dp,Alignment.End)){
        for(band in palette.indices){
            val label=if(band==0)"0MIN"else "${(band-1)*3}–${band*3}H"
            val interaction=remember{MutableInteractionSource()}
            val action=if(onBand==null)Modifier else Modifier.sizeIn(minWidth=44.dp,minHeight=44.dp)
                .clickable(role=Role.Button,interactionSource=interaction,indication=null){onBand(band)}
                .semantics{contentDescription=ui.text("高亮 {0}",label);selected=band==selectedBand}
            Row(action.nativePressMotion(interaction,onBand!=null).padding(horizontal=2.dp,vertical=4.dp),verticalAlignment=Alignment.CenterVertically,
                horizontalArrangement=Arrangement.spacedBy(3.dp)){
                Box(Modifier.size(8.dp).then(if(band==0)Modifier else Modifier.background(palette[band])))
                NativeText(label,NativeTextRole.CAPTION)
            }
        }
        extra()
    }
}
