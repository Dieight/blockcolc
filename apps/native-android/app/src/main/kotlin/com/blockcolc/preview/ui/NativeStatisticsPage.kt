package com.blockcolc.preview.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.drawText
import com.blockcolc.presentation.*
import com.blockcolc.preview.WorkspaceUiState
import java.time.LocalDate

@Composable fun NativeStatisticsPage(s:WorkspaceUiState,runtime:WorkspaceActions){
    val ui=LocalNativeUi.current;val workspace=s.workspace?:return
    val colors=MaterialTheme.colorScheme
    var first by rememberNativePageState("statistics/first"){workspace.today};var last by rememberNativePageState("statistics/last"){workspace.today}
    val summary=remember(workspace,first,last){workspace.range(first,last)}
    val label=if(summary.start==summary.end)if(summary.end==workspace.today)ui.text("今天")else summary.end.replace('-','.')else "${summary.start.replace('-','.')} — ${summary.end.replace('-','.')}"
    var achievementsOpen by rememberSaveable{mutableStateOf(false)}
    var monumentsOpen by rememberSaveable{mutableStateOf(false)}

    NativePageScroll{
        // Pure clean title, zero duplicate header actions
        NativePageTitle(ui.text("统计"))

        // Naked hero stats + frameless 26-week heatmap directly on canvas
        Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(12.dp)){
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
                PixelGlyph("clock",Modifier.size(15.dp),colors.primary)
                NativeText(ui.text("{0}的投入",label),NativeTextRole.CAPTION,Modifier.weight(1f),colors.onSurfaceVariant)
                NativeOccasionEmblems(workspace.today,2,workspace.settings.birthday)
            }
            FormalStatisticDuration(summary.durationMs)
            Row(Modifier.fillMaxWidth().padding(bottom=6.dp),horizontalArrangement=Arrangement.spacedBy(20.dp)){
                Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(6.dp)){
                    PixelGlyph("flag",Modifier.size(14.dp),colors.primary)
                    NativeText("${summary.completed} / ${summary.goal}",NativeTextRole.BODY,accent=true)
                    NativeText(ui.text("轮"),NativeTextRole.CAPTION,color=colors.onSurfaceVariant)
                }
                Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(6.dp)){
                    NativeText("${summary.activeDays}",NativeTextRole.BODY,accent=true)
                    NativeText(ui.text("活跃日"),NativeTextRole.CAPTION,color=colors.onSurfaceVariant)
                }
            }
            NativeHeatmap(workspace,first,last){a,b->first=a;last=b}
        }

        if(workspace.details!=WorkspaceDetails.READY){
            FormalCard{NativeHistoryDetailsStatus(s,runtime)}
            return@NativePageScroll
        }

        // Frameless L14 Golden-Angle Constellation
        FormalCard(padding=16.dp){
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                NativeText(ui.text("时间花在了哪里"),NativeTextRole.CAPTION,Modifier.weight(1f),color=colors.onSurfaceVariant)
                NativeInfoAction(ui.text("时间花在了哪里"),ui.text("每个像素约占 1%；文字为实际投入。"))
            }
            val groups=summary.targets.groupBy{it.projectId}.values.map{items->items.first() to items.sumOf{it.durationMs}}.sortedWith(compareBy<Pair<TimeTarget,Long>>{it.first.unknown}.thenByDescending{it.second})
            if(groups.isEmpty())NativeText(ui.text("开始一次专注，投入会在这里留下记录。"),NativeTextRole.CAPTION,Modifier.padding(vertical=12.dp),colors.onSurfaceVariant)
            else {
                val visible=if(groups.size<=6)groups else {
                    val unknown=groups.filter{it.first.unknown};val known=groups.filterNot{it.first.unknown};val limit=if(unknown.isEmpty())5 else 4
                    val rest=known.drop(limit)
                    known.take(limit)+if(rest.isEmpty())emptyList()else listOf(rest.first().first.copy(key="other",projectId="other",projectTitle=ui.text("其他 {0} 项任务",rest.size)) to rest.sumOf{it.second})+unknown
                }
                NativeAllocationField(visible)
            }
        }

        // Two Frameless Bottom Exhibition Plates (Achievements & Monuments)
        FormalCard(padding=16.dp){
            val unlockedCount=workspace.achievements.count{it.unlocked}
            val totalCount=workspace.achievements.size
            val achInteraction=remember{MutableInteractionSource()}
            Column(
                Modifier
                    .fillMaxWidth()
                    .clickable(role=Role.Button,interactionSource=achInteraction,indication=null){achievementsOpen=true}
                    .nativePressMotion(achInteraction)
                    .padding(vertical=6.dp),
                verticalArrangement=Arrangement.spacedBy(10.dp),
            ){
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)){
                    PixelGlyph("trophy",Modifier.size(20.dp),colors.primary)
                    NativeText(ui.text("成就与书房陈设"),NativeTextRole.SECTION,Modifier.weight(1f))
                    NativeText("$unlockedCount / $totalCount",NativeTextRole.BODY,color=colors.primary,accent=true)
                    PixelGlyph("chevron",Modifier.size(16.dp).graphicsLayer{rotationZ=-90f},colors.onSurfaceVariant)
                }
                // 20-cell micro architectural pixel seal strip
                if(totalCount>0){
                    Canvas(Modifier.fillMaxWidth().height(5.dp).clearAndSetSemantics{}){
                        val gap=3.dp.toPx()
                        val cell=((size.width-gap*(totalCount-1))/totalCount).coerceAtLeast(1f)
                        workspace.achievements.forEachIndexed{i,entry->
                            drawRect(if(entry.unlocked)colors.primary else colors.outlineVariant,Offset(i*(cell+gap),0f),Size(cell,size.height))
                        }
                    }
                }
            }
            Spacer(Modifier.height(10.dp))
            NativeSeparator()
            Spacer(Modifier.height(10.dp))
            val monInteraction=remember{MutableInteractionSource()}
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min=48.dp)
                    .clickable(role=Role.Button,interactionSource=monInteraction,indication=null){monumentsOpen=true}
                    .nativePressMotion(monInteraction)
                    .padding(vertical=6.dp),
                verticalAlignment=Alignment.CenterVertically,
                horizontalArrangement=Arrangement.spacedBy(10.dp),
            ){
                PixelGlyph("chest",Modifier.size(20.dp),colors.primary)
                NativeText(ui.text("纪念建筑"),NativeTextRole.SECTION,Modifier.weight(1f))
                NativeText(ui.text("{0} 座已完成",workspace.memories.archives.size),NativeTextRole.CAPTION,color=colors.onSurfaceVariant)
                PixelGlyph("chevron",Modifier.size(16.dp).graphicsLayer{rotationZ=-90f},colors.onSurfaceVariant)
            }
        }
    }

    // Redesigned Gallery Achievements Sheet
    NativeSheet(Unit.takeIf{achievementsOpen},{ui.text("成就与书房陈设")},{achievementsOpen=false},initiallyExpanded=true,contentSpacing=0.dp){
        var filter by rememberSaveable{mutableStateOf("all")}
        val unlockedCount=workspace.achievements.count{it.unlocked}
        val totalCount=workspace.achievements.size
        Row(Modifier.fillMaxWidth().padding(bottom=12.dp),verticalAlignment=Alignment.Bottom,horizontalArrangement=Arrangement.spacedBy(6.dp)){
            Text("$unlockedCount",style=MaterialTheme.typography.displayMedium,color=colors.primary,maxLines=1)
            NativeText("/ $totalCount",NativeTextRole.TITLE,Modifier.padding(bottom=6.dp),color=colors.onSurfaceVariant,accent=true)
        }
        NativeSegments(
            listOf("all" to ui.text("全部"),"unlocked" to ui.text("已解锁"),"locked" to ui.text("未解锁")),
            filter,
            {filter=it},
        )
        Spacer(Modifier.height(8.dp))
        val filtered=workspace.achievements.filter{
            when(filter){"unlocked"->it.unlocked;"locked"->!it.unlocked;else->true}
        }
        for((idx,achievement) in filtered.withIndex())key(achievement.definition.id){
            if(idx>0)NativeSeparator()
            Row(Modifier.fillMaxWidth().heightIn(min=64.dp).padding(vertical=12.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)){
                PixelGlyph("trophy",Modifier.size(20.dp),if(achievement.unlocked)colors.primary else colors.onSurfaceVariant)
                Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)){
                    NativeText(ui.text(achievement.definition.title),NativeTextRole.BODY)
                    NativeText(ui.text(achievement.definition.description),NativeTextRole.CAPTION,color=colors.onSurfaceVariant)
                    RoomPresentationProjection.items.firstOrNull{it.achievementId==achievement.definition.id}?.let{item->
                        NativeText(ui.text("解锁摆设：{0}",if(ui.language=="en")item.englishTitle else item.title),NativeTextRole.CAPTION,color=colors.primary)
                    }
                    if(achievement.unlocked){
                        Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(6.dp)){
                            PixelGlyph("check",Modifier.size(14.dp),colors.primary)
                            NativeText(achievement.unlockedAt?.let{sourceDisplayDate(it,workspace.settings.timeZone,ui.language)}?:ui.text("已解锁"),NativeTextRole.CAPTION,color=colors.primary)
                        }
                    }else{
                        Column(Modifier.widthIn(max=220.dp).fillMaxWidth().padding(top=2.dp),verticalArrangement=Arrangement.spacedBy(4.dp)){
                            FormalProgress(achievement.progress,max=achievement.definition.target,height=3.dp)
                            NativeText("${achievement.progress} / ${achievement.definition.target} "+ui.text(achievement.definition.unit),NativeTextRole.CAPTION,color=colors.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }

    // Redesigned Gallery Monuments Sheet
    NativeSheet(Unit.takeIf{monumentsOpen},{ui.text("纪念建筑")},{monumentsOpen=false},initiallyExpanded=true,contentSpacing=0.dp){
        if(workspace.memories.archives.isEmpty()){
            NativeText(ui.text("完成一项大型任务或习惯建筑后，这里会保留它的投入记忆。"),NativeTextRole.CAPTION,Modifier.padding(vertical=16.dp),color=colors.onSurfaceVariant)
        }
        for((idx,archive) in workspace.memories.archives.withIndex())key(archive.id){
            if(idx>0)NativeSeparator()
            var expanded by rememberNativePageState("statistics/archive/${archive.id}"){false}
            val title=if(archive.cycleNumber==null)archive.title else ui.text("{0} · 第 {1} 座",archive.title,archive.cycleNumber)
            val caption=ui.text(if(archive.cycleNumber==null)"已完成大型任务"else"已完成习惯建筑")+" · "+(if(archive.expectedRounds!=null)ui.text("{0} / {1} 轮可追溯",archive.rounds,archive.expectedRounds)else ui.text("{0} 轮可追溯",archive.rounds))
            NativeDisclosure(title,caption,expanded,{expanded=it},valueLabel=formatDuration(archive.durationMs),titleStyle=MaterialTheme.typography.bodyLarge,valueStyle=MaterialTheme.typography.bodyLarge){
                Column(Modifier.fillMaxWidth().padding(bottom=12.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
                    FormalStatisticDuration(archive.durationMs)
                    NativeSeparator()
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){
                        Column{NativeText(ui.text("完成轮次"),NativeTextRole.CAPTION,color=colors.onSurfaceVariant);NativeText(ui.rounds(archive.rounds),NativeTextRole.BODY)}
                        Column{NativeText(ui.text("中断投入"),NativeTextRole.CAPTION,color=colors.onSurfaceVariant);NativeText(if(archive.interrupted>0)ui.text("{0} 条 · {1}",archive.interrupted,formatDuration(archive.interruptedMs))else ui.text("无"),NativeTextRole.CAPTION)}
                    }
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){NativeText(ui.text("完成时间"),NativeTextRole.CAPTION,color=colors.onSurfaceVariant);NativeText(archive.completedAt?.let{sourceDisplayDate(it,workspace.settings.timeZone,ui.language)}?:ui.text("未知"),NativeTextRole.CAPTION)}
                    NativeSeparator()
                    if(archive.unknownRounds>0)NativeText(ui.text("另有 {0} 条无法追溯，未分摊。",archive.unknownRounds),NativeTextRole.CAPTION,color=colors.onSurfaceVariant)
                    NativeText(ui.text("旗下小任务投入"),NativeTextRole.CAPTION,Modifier.padding(top=6.dp),color=colors.onSurfaceVariant)
                    val maximum=archive.tasks.maxOfOrNull{it.durationMs}?:0
                    if(maximum<=0)NativeText(ui.text("暂时没有可追溯的小任务投入。"),NativeTextRole.CAPTION,color=colors.onSurfaceVariant)
                    for(task in archive.tasks){
                        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){NativeText(task.title,NativeTextRole.CAPTION,Modifier.weight(1f));NativeText(formatDuration(task.durationMs)+(task.share?.let{" · $it%"}?:""),NativeTextRole.CAPTION,color=colors.onSurfaceVariant)}
                        FormalProgress(if(maximum>0)(task.durationMs.toDouble()/maximum*10000).toInt()else 0,segments=20,height=3.dp)
                    }
                }
            }
        }
        val unknown=workspace.memories.unallocated
        if(unknown.rounds>0){
            NativeSeparator()
            Row(Modifier.fillMaxWidth().padding(vertical=12.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)){
                PixelGlyph("clock",Modifier.size(20.dp),colors.onSurfaceVariant)
                Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)){
                    NativeText(ui.text("未分配的投入"),NativeTextRole.BODY)
                    NativeText(listOfNotNull(if(unknown.completed>0)ui.text("{0} 个完成轮次",unknown.completed)else null,if(unknown.interrupted>0)ui.text("{0} 条中断记录",unknown.interrupted)else null).joinToString(" · "),NativeTextRole.CAPTION,color=colors.onSurfaceVariant)
                    NativeText(formatDuration(unknown.durationMs),NativeTextRole.BODY)
                }
                NativeInfoAction(ui.text("未分配的投入"),ui.text("展示可追溯投入；旧记录单列，不估算分配。"))
            }
        }
    }
}

@Composable internal fun NativeHistoryDetailsStatus(s:WorkspaceUiState,runtime:WorkspaceActions){
    val ui=LocalNativeUi.current
    if(s.workspace?.details==WorkspaceDetails.FAILED){
        val retry=rememberNativeRequest(s)
        NativeText(ui.text("统计明细暂不可用"),NativeTextRole.CAPTION)
        NativeAction(ui.text("重试"),{retry.submit{runtime.refreshWorkspace(it)}},pending=retry.busy,enabled=!s.busy,primary=false)
        NativeRequestError(retry)
    }else NativeText(ui.text("正在整理统计明细"),NativeTextRole.CAPTION)
}

@Composable internal fun NativeStatisticsAchievements(entries:List<AchievementProgress>,runtime:AchievementReceiptActions){
    if(LocalNativePageActive.current)NativeAchievementUnlock(entries,runtime)
}

/** Same 26-week calendar as the formal page, rendered framelessly on canvas. */
@OptIn(ExperimentalLayoutApi::class)
@Composable private fun NativeHeatmap(workspace:WorkspaceProjection,first:String,last:String,onSelection:(String,String)->Unit){
    val ui=LocalNativeUi.current;val today=LocalDate.parse(workspace.today)
    val start=remember(today){today.minusDays((today.dayOfWeek.value-1).toLong()+25*7)}
    val dates=remember(start){List(26*7){start.plusDays(it.toLong()).toString()}}
    val days=remember(workspace){workspace.days.associateBy{it.date}}
    var band by rememberNativePageState<Int?>("statistics/band"){null};var cursor by rememberNativePageState("statistics/cursor"){workspace.today};var keyboardAnchor by rememberNativePageState<String?>("statistics/keyboard-anchor"){null}
    var width by remember{mutableFloatStateOf(1f)}
    val progress=remember{Animatable(if(ui.reduceMotion)26f else 0f)};val active=LocalNativePageActive.current
    LaunchedEffect(active,ui.reduceMotion){if(active)progress.animateTo(26f,tween(if(ui.reduceMotion)0 else ((26f-progress.value).coerceAtLeast(0f)/26f*900).toInt(),easing=LinearEasing))}
    val palette=nativeFocusHeatmapColors()
    val longest=days.values.filter{it.date<=workspace.today}.maxByOrNull{it.durationMs}?.date
    fun move(offset:Int,extend:Boolean):Boolean{
        val next=LocalDate.parse(cursor).plusDays(offset.toLong()).coerceIn(start,today).toString()
        if(extend){if(keyboardAnchor==null)keyboardAnchor=cursor;onSelection(keyboardAnchor!!,next)}else{keyboardAnchor=null;onSelection(next,next)};cursor=next;return true
    }
    val ink=MaterialTheme.colorScheme.onSurface;val muted=MaterialTheme.colorScheme.onSurfaceVariant;val todayMark=MaterialTheme.colorScheme.primary
    val selectedFrom=minOf(first,last);val selectedTo=maxOf(first,last)
    val text=androidx.compose.ui.text.rememberTextMeasurer();val textStyle=MaterialTheme.typography.bodySmall
    val density=androidx.compose.ui.platform.LocalDensity.current
    val weekdays=listOf("一","二","三","四","五","六","日").map{ui.text(it)}
    val labels=weekdays.map{text.measure(it,textStyle)}
    val left=labels.maxOf{it.size.width}.toFloat()+with(density){8.dp.toPx()}
    val top=labels.maxOf{it.size.height}.toFloat()+with(density){8.dp.toPx()}
    val rowHeight=labels.maxOf{it.size.height}.toFloat()+with(density){4.dp.toPx()}
    val chartHeight=with(density){(top+rowHeight*7).toDp()}
    val monthMarks=remember(dates){dates.mapIndexedNotNull{i,date->if(i==0||date.endsWith("-01"))i/7 to date.substring(5,7).toInt()else null}}
    fun hit(point:Offset,outside:Boolean=false):String?{
        val cell=(width-left).coerceAtLeast(1f)/26
        val column=kotlin.math.floor((point.x-left)/cell).toInt();val row=kotlin.math.floor((point.y-top)/rowHeight).toInt()
        if(!outside&&(column !in 0..25||row !in 0..6))return null
        return dates[column.coerceIn(0,25)*7+row.coerceIn(0,6)].coerceAtMost(workspace.today)
    }
    val dayFormat=remember(ui.language){java.time.format.DateTimeFormatter.ofPattern(ui.text("M月d日"),if(ui.language=="en")java.util.Locale.ENGLISH else java.util.Locale.SIMPLIFIED_CHINESE)}
    val from=LocalDate.parse(selectedFrom);val to=LocalDate.parse(selectedTo)
    val selection=if(from==to)from.format(dayFormat)+(if(selectedTo==workspace.today)" · "+ui.text("今天")else "")
        else ui.text("{0} – {1} · 共 {2} 天",from.format(dayFormat),to.format(dayFormat),java.time.temporal.ChronoUnit.DAYS.between(from,to)+1)
    Row(Modifier.fillMaxWidth().heightIn(min=44.dp),verticalAlignment=Alignment.CenterVertically){
        NativeIconAction(ui.text("前一天"),"chevron",{move(-1,false)},Modifier.graphicsLayer{rotationZ=90f},enabled=cursor>start.toString())
        Box(Modifier.weight(1f),contentAlignment=Alignment.Center){NativeText(selection,NativeTextRole.BODY,maxLines=2)}
        NativeIconAction(ui.text("后一天"),"chevron",{move(1,false)},Modifier.graphicsLayer{rotationZ=-90f},enabled=cursor<workspace.today)
        if(selectedFrom!=workspace.today||selectedTo!=workspace.today)FormalTextAction(ui.text("今天"),"",{keyboardAnchor=null;cursor=workspace.today;onSelection(workspace.today,workspace.today)})
    }
    Canvas(Modifier.fillMaxWidth().height(chartHeight).onSizeChanged{width=it.width.toFloat()}.semantics{
        contentDescription=ui.text("专注日历");stateDescription=if(first==last)first else "$first — $last"
        progressBarRangeInfo=ProgressBarRangeInfo(dates.indexOf(cursor).coerceAtLeast(0).toFloat(),0f..dates.indexOf(workspace.today).toFloat())
        setProgress{index->dates.getOrNull(index.toInt())?.takeIf{it<=workspace.today}?.let{cursor=it;onSelection(it,it);true}?:false}
        customActions=listOf(CustomAccessibilityAction(ui.text("前一天")){move(-1,false)},CustomAccessibilityAction(ui.text("后一天")){move(1,false)},CustomAccessibilityAction(ui.text("向前扩展一天")){move(-1,true)},CustomAccessibilityAction(ui.text("向后扩展一天")){move(1,true)})
    }.onKeyEvent{e->if(e.type!=KeyEventType.KeyDown)false else when(e.key){Key.DirectionLeft->move(-7,e.isShiftPressed);Key.DirectionRight->move(7,e.isShiftPressed);Key.DirectionUp->move(-1,e.isShiftPressed);Key.DirectionDown->move(1,e.isShiftPressed);Key.Escape,Key.Enter,Key.MoveEnd->{cursor=workspace.today;onSelection(cursor,cursor);true};Key.MoveHome->{cursor=start.toString();onSelection(cursor,cursor);true};else->false}}.focusable().pointerInput(start,workspace.today,left,top,rowHeight){
        awaitEachGesture{
            val down=awaitFirstDown();val anchor=hit(down.position)?:return@awaitEachGesture;down.consume();keyboardAnchor=null;cursor=anchor;onSelection(anchor,anchor)
            while(true){val event=awaitPointerEvent().changes.find{it.id==down.id}?:break;if(event.isConsumed)break;event.consume();hit(event.position,true)?.let{onSelection(anchor,it);cursor=it};if(!event.pressed)break}
        }
    }){
        val step=(size.width-left).coerceAtLeast(1f)/26
        var previousEnd=-1f
        for((index,mark)in monthMarks.withIndex()){
            val (column,month)=mark
            val label=if(ui.language=="en")java.time.Month.of(month).getDisplayName(java.time.format.TextStyle.SHORT,java.util.Locale.ENGLISH)else ui.text("{0}月",month)
            val layout=text.measure(label,textStyle.copy(color=muted));val x=left+column*step
            val span=((monthMarks.getOrNull(index+1)?.first?:26)-column)*step
            if(layout.size.width<=span&&x>=previousEnd&&x+layout.size.width<=size.width){drawText(layout,topLeft=Offset(x,0f));previousEnd=x+layout.size.width+4.dp.toPx()}
        }
        labels.forEachIndexed{index,layout->drawText(layout,color=muted,topLeft=Offset(left-8.dp.toPx()-layout.size.width,top+rowHeight*index+(rowHeight-layout.size.height)/2))}
        val side=minOf(8.dp.toPx(),step*.68f,rowHeight*.68f)
        val clearance=minOf(step,rowHeight)-side
        val selectionStroke=minOf(1.5.dp.toPx(),clearance/2)
        val selectionInset=minOf(2.dp.toPx(),(clearance-selectionStroke)/2)
        val tickHeight=minOf(2.dp.toPx(),(rowHeight-side)/4)
        val tickWidth=minOf(3.dp.toPx(),side)
        for((index,date)in dates.withIndex()){
            if(date>workspace.today)continue
            val column=index/7;val row=index%7;val actual=heatmapBand(days[date]?.durationMs?:0)
            val origin=Offset(left+column*step+(step-side)/2,top+row*rowHeight+(rowHeight-side)/2)
            val opacity=if(band==null||band==actual)1f else .18f
            if(actual>0&&column>=progress.value)drawRect(palette[0].copy(alpha=opacity),origin,Size(side,side))
            else drawFocusHeatmapCell(palette,actual,origin,side,opacity)
            if(date in selectedFrom..selectedTo){
                val edge=side+2*selectionInset
                drawRect(ink,origin-Offset(selectionInset,selectionInset),Size(edge,edge),
                    style=androidx.compose.ui.graphics.drawscope.Stroke(selectionStroke))
            }
            if(date==workspace.today)drawRect(todayMark,Offset(origin.x+(side-tickWidth)/2,top+(row+1)*rowHeight-tickHeight),Size(tickWidth,tickHeight))
            if(band==4&&date==longest&&actual==4){val path=androidx.compose.ui.graphics.Path().apply{moveTo(origin.x,origin.y-2.dp.toPx());lineTo(origin.x+side,origin.y-2.dp.toPx());lineTo(origin.x+side/2,origin.y-side/2-2.dp.toPx());close()};drawPath(path,ink)}
        }
    }
    NativeFocusHeatmapLegend(palette,band,{value->band=if(band==value)null else value}){
        NativeInfoAction(ui.text("专注日历"),ui.text("按住拖动，可选多天"))
    }
    if(band==4&&longest!=null)NativeText(ui.text("最长一天 ·")+longest,NativeTextRole.CAPTION)
}

private fun sourceDisplayDate(value:String,zone:String,language:String):String {
    val date=runCatching{if(value.length>10)java.time.Instant.parse(value).atZone(java.time.ZoneId.of(zone)).toLocalDate()else LocalDate.parse(value)}.getOrNull()?:return value.take(10)
    return if(language=="en")"${date.monthValue}/${date.dayOfMonth}/${date.year}"else "${date.year}/${date.monthValue}/${date.dayOfMonth}"
}
