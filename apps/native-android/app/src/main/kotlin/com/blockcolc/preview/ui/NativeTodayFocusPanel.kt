package com.blockcolc.preview.ui

import android.graphics.Paint
import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import com.blockcolc.presentation.TodayFocusTimeline

@Composable internal fun NativeMinimalPanelLabel(title:String,icon:String,modifier:Modifier=Modifier){
    Row(modifier.heightIn(min=24.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(6.dp)){
        PixelGlyph(icon,Modifier.size(16.dp),LocalContentColor.current)
        NativeText(title,NativeTextRole.CAPTION)
    }
}

/** Geometry and motion from MinimalTodayPanel.tsx / minimal-today.css. */
@Composable fun NativeTodayFocusPanel(data:TodayFocusTimeline){
    val ui=LocalNativeUi.current;val ink=MaterialTheme.colorScheme.onSurface
    val dark=MaterialTheme.colorScheme.background.luminance()<.5f
    fun duration(ms:Long):String {val minutes=ms/60000;return when{ms in 1..59999->ui.text("不足 1 分钟");minutes<60->ui.text("{0} 分钟",minutes);else->ui.text("{0} 小时 {1} 分钟",minutes/60,minutes%60)}}
    val rows=remember(data){data.series.filter{!it.unallocated}.sortedWith(compareByDescending<com.blockcolc.presentation.TodayFocusSeries>{it.totalMs}.thenBy{it.key})+data.series.filter{it.unallocated}}
    val pixels=remember(rows){List(24){hour->(0..3).mapNotNull{quarter->rows.indices.maxByOrNull{rows[it].milliseconds[hour*4+quarter]}?.takeIf{rows[it].milliseconds[hour*4+quarter]>0}}}}
    val colors=if(dark)listOf(0xff9fc1ad,0xff8eab99,0xff7f9789,0xff6f8376)else listOf(0xff557262,0xff6d8378,0xff87978d,0xff9eaca3)
    fun color(index:Int)=if(rows[index].unallocated)ink else Color(colors[index%4])
    val reveal=remember{Animatable(if(ui.reduceMotion)1f else 0f)}
    LaunchedEffect(Unit){reveal.animateTo(1f,tween(if(ui.reduceMotion)0 else 1044,easing=LinearEasing))}
    Column(Modifier.fillMaxWidth().testTag("minimal-today-timeline")){
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.Bottom){
            Column(verticalArrangement=Arrangement.spacedBy(4.dp)){
                NativeMinimalPanelLabel(ui.text("今日专注"),"chart")
                NativeText(duration(data.totalMs),NativeTextRole.TITLE,accent=true)
            }
            Row(horizontalArrangement=Arrangement.spacedBy(6.dp)){
                PixelGlyph("flag",Modifier.size(14.dp).alignBy{it.measuredHeight},ink)
                NativeText(data.completedRounds.toString(),NativeTextRole.TITLE,Modifier.alignByBaseline(),accent=true)
                NativeText(if(data.targetRounds==null)ui.text("轮")else ui.text(" / {0} 轮",data.targetRounds),NativeTextRole.CAPTION,Modifier.alignByBaseline())
            }
        }
        Spacer(Modifier.height(8.dp))
        Canvas(Modifier.fillMaxWidth().aspectRatio(400f/120f).heightIn(max=136.dp).semantics{contentDescription=ui.text("今日实际专注 {0}，横轴零点至二十四点，每小时最多堆叠四格，每格代表该小时内一段实际专注的十五分钟，颜色代表小任务或习惯。",duration(data.totalMs))}){
            val scale=size.width/400;val left=12f;val width=376f/24;val base=94f;val step=17f
            fun point(x:Float,y:Float)=Offset(x*scale,y*scale)
            for(hour in listOf(6,12,18))drawLine(ink.copy(alpha=if(dark).32f else .25f),point(left+hour*width,18f),point(left+hour*width,base),.9f*scale,pathEffect=PathEffect.dashPathEffect(floatArrayOf(3*scale,4*scale)))
            pixels.forEachIndexed{hour,occupied->val opacity=((reveal.value*1044-hour*28)/400).coerceIn(0f,1f)
                occupied.forEachIndexed{level,owner->
                    val position=point(left+hour*width+.5f,base-(level+1)*step+.5f);val cell=Size((width-1)*scale,(step-1)*scale)
                    drawRect(color(owner).copy(alpha=.76f*opacity),position,cell);drawRect(ink.copy(alpha=.2f*opacity),position,cell,style=Stroke(.5f*scale))
                }
            }
            if(pixels.any{it.isNotEmpty()}){
                val outline=Path();pixels.forEachIndexed{hour,occupied->val x=(left+hour*width)*scale;val y=(base-occupied.size*step)*scale;if(hour==0)outline.moveTo(x,y)else outline.lineTo(x,y);outline.lineTo(x+width*scale,y)}
                drawPath(outline,ink.copy(alpha=.76f*.8f),style=Stroke(.8f*scale))
            }
            drawLine(ink.copy(alpha=.76f*.65f),point(left,base),point(388f,base),.7f*scale)
            for(hour in 0..24)drawLine(ink.copy(alpha=.76f*.65f),point(left+hour*width,base),point(left+hour*width,base+if(hour%6==0)5f else 2f),.7f*scale)
            val paint=Paint(Paint.ANTI_ALIAS_FLAG).apply{color=ink.toArgb();textSize=12*scale;typeface=android.graphics.Typeface.create("sans-serif-medium",android.graphics.Typeface.NORMAL)}
            for(hour in listOf(0,6,12,18,24)){paint.textAlign=if(hour==0)Paint.Align.LEFT else if(hour==24)Paint.Align.RIGHT else Paint.Align.CENTER;drawContext.canvas.nativeCanvas.drawText(hour.toString().padStart(2,'0'),(left+hour*width)*scale,115*scale,paint)}
        }
        if(rows.isEmpty()){Spacer(Modifier.height(6.dp));NativeText(ui.text("今天的专注会留在这里"),NativeTextRole.CAPTION)}
        else Column(Modifier.padding(top=4.dp),verticalArrangement=Arrangement.spacedBy(4.dp)){
            for(pair in rows.indices.chunked(2))Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(12.dp)){
                for(index in pair)Row(Modifier.weight(1f),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(5.dp)){
                    Box(Modifier.size(6.dp).background(color(index)))
                    NativeText(if(rows[index].unallocated)ui.text(rows[index].title)else rows[index].title,NativeTextRole.CAPTION,Modifier.weight(1f),maxLines=1)
                    NativeText(duration(rows[index].totalMs),NativeTextRole.CAPTION)
                }
                if(pair.size==1)Spacer(Modifier.weight(1f))
            }
        }
        Spacer(Modifier.height(6.dp));NativeText(ui.text("时长按今日实际区间 · 轮次按完成日"),NativeTextRole.CAPTION)
    }
}
