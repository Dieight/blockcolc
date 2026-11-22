package com.blockcolc.preview.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.blockcolc.presentation.*
import com.blockcolc.preview.NativeCelebrations

@Composable fun NativeOccasionEmblems(date:String,slot:Int,birthday:BirthdaySettings?=null){
    val entries=remember(date,slot,birthday){HolidayEmblems.at(date,slot,birthday)}
    var open by remember(date,slot,birthday){mutableStateOf<String?>(null)}
    Row(verticalAlignment=Alignment.CenterVertically){entries.forEach{entry->key(entry.id,entry.emblem){
        NativeOccasion(entry,open==entry.id,{open=if(open==entry.id)null else entry.id},{open=null},slot==1)
    }}}
}

@Composable private fun NativeOccasion(entry:HolidayEmblemEntry,open:Boolean,onToggle:()->Unit,onClose:()->Unit,goal:Boolean){
    val ui=LocalNativeUi.current
    val glyph=remember(entry.emblem){HolidayPixels.glyph(entry.emblem)}
    val label=ui.text(entry.name)+" · "+ui.text(entry.emblem)
    Box{
        val interaction=remember{androidx.compose.foundation.interaction.MutableInteractionSource()}
        Box(Modifier.size(if(goal)76.dp else 44.dp).clickable(role=Role.Button,interactionSource=interaction,indication=null,onClick=onToggle)
            .nativePressMotion(interaction).semantics{contentDescription=label},contentAlignment=Alignment.Center){
            Canvas(Modifier.size(if(goal)64.dp else 32.dp)){
                val cell=size.minDimension/12f
                glyph.rows.forEachIndexed{y,row->row.forEachIndexed{x,ch->
                    if(ch in 'a'..'c')drawRect(Color(glyph.colors[ch-'a']),Offset((x+.5f)*cell,(y+(12-glyph.rows.size)/2f)*cell),Size(cell,cell))
                }}
            }
        }
        DropdownMenu(expanded=open,onDismissRequest=onClose,modifier=Modifier.widthIn(max=290.dp).background(MaterialTheme.colorScheme.surface)){
            Column(Modifier.padding(horizontal=16.dp,vertical=8.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                Row(verticalAlignment=Alignment.CenterVertically){Text(ui.text(entry.name),Modifier.weight(1f),style=MaterialTheme.typography.titleMedium);NativeIconAction(ui.text("关闭节日介绍"),"close",onClose)}
                Text(ui.text(entry.description),color=MaterialTheme.colorScheme.onSurface,style=MaterialTheme.typography.bodyLarge)
            }
        }
    }
}

/** Runs on Compose's frame clock only while its host and visible world are
 * active. Canvas reads the elapsed value in draw, not in the world tree. */
@Composable fun NativeCelebrationOverlay(queue:NativeCelebrations,foreground:Boolean,worldReady:Boolean){
    var current by remember(queue){mutableStateOf<CelebrationBurst?>(null)}
    val version=queue.version
    LaunchedEffect(queue,version,foreground,worldReady,current){
        val next=queue.peek(worldReady)
        if(current==null&&foreground&&next!=null)current=queue.take(worldReady)
    }
    val burst=current?:return
    key(burst.serial){NativeCelebrationBurst(burst,foreground&&(worldReady||burst.preview)){if(current?.serial==burst.serial)current=null}}
}

@Composable private fun NativeCelebrationBurst(burst:CelebrationBurst,active:Boolean,onFinished:()->Unit){
    val ui=LocalNativeUi.current;val kind=burst.kind
    val duration=if(ui.reduceMotion)1200 else CelebrationFrames.DURATION_MS
    val timeline=remember{CelebrationTimeline()}
    var elapsed by remember{mutableLongStateOf(0L)}
    val finish by rememberUpdatedState(onFinished)
    LaunchedEffect(active,duration){
        if(active){
            try{
                while(elapsed<duration)withFrameNanos{elapsed=timeline.frame(it)}
                finish()
            }finally{timeline.pause()}
        }
    }
    if(!active)return
    val announcement=ui.text(when(kind){
        CelebrationKind.BIRTHDAY->"生日快乐！小蛋糕已送到聚落。"
        CelebrationKind.BUILDING->"建筑落成！"
        CelebrationKind.GOAL->"今日目标达成！"
        CelebrationKind.ACHIEVEMENT->"新的成就！"
        else->"彩纸预览"
    })
    Box(Modifier.fillMaxSize().semantics{contentDescription=announcement;liveRegion=LiveRegionMode.Polite}){
        if(ui.reduceMotion)Text(announcement,Modifier.align(Alignment.TopCenter).padding(24.dp).background(MaterialTheme.colorScheme.surface).padding(12.dp),color=MaterialTheme.colorScheme.onSurface)
        else {
            val colors=remember{listOf(0xffe3ad42L,0xff4c9873L,0xffcc6257L,0xff73b2c8L,0xffb98acbL,0xffeee4c4L).map(::Color)}
            Canvas(Modifier.fillMaxSize()){
                CelebrationFrames.frame(kind,elapsed,size.width/density,size.height/density).forEach{pixel->
                    val w=if(pixel.turn%2==0)pixel.width else pixel.height;val h=if(pixel.turn%2==0)pixel.height else pixel.width
                    drawRect(colors[pixel.color],Offset(pixel.x*density,pixel.y*density),Size(w*density,h*density))
                }
            }
        }
    }
}

/** Entering statistics reads local receipts. A failed write keeps the batch
 * visible and retryable; it is never treated as an acknowledgement. */
@Composable fun NativeAchievementUnlock(entries:List<AchievementProgress>,runtime:AchievementReceiptActions,canPresent:Boolean=true,includeHistorical:Boolean=true,eligible:Set<String> = emptySet()){
    val ui=LocalNativeUi.current
    var seen by remember{mutableStateOf<Set<String>?>(null)}
    var loading by remember{mutableStateOf(false)};var saving by remember{mutableStateOf(false)}
    var error by remember{mutableStateOf(false)}
    var deferred by remember{mutableStateOf(false)}
    val alive=remember(runtime){java.util.concurrent.atomic.AtomicBoolean(true)}
    DisposableEffect(runtime){onDispose{alive.set(false)}}
    fun read(){if(loading)return;loading=true;error=false;runtime.readAchievementReceipts{value,failed->if(alive.get()){loading=false;seen=value;error=failed||value==null}}}
    LaunchedEffect(runtime){read()}
    val pending=seen?.let{known->entries.filter{it.unlocked&&it.definition.id !in known&&(includeHistorical||it.definition.id in eligible)}}.orEmpty()
    fun acknowledge(){if(saving||pending.isEmpty())return;saving=true;error=false
        runtime.acknowledgeAchievements(pending.map{it.definition.id}){value,failed->if(alive.get()){saving=false;if(!failed&&value!=null)seen=value;error=failed||value==null}}
    }
    if(includeHistorical&&canPresent&&error&&(seen==null||deferred))Column(Modifier.fillMaxWidth().padding(vertical=12.dp)){
        Text(ui.text(if(seen==null)"成就展示回执读取失败，请重试。" else "展示回执未保存，请重试。"),color=MaterialTheme.colorScheme.error)
        NativeAction(ui.text("重试"),{if(seen==null)read()else deferred=false},primary=false,pending=loading)
    }
    // The explicit batch button waits for the durable receipt before closing.
    // A failed write can be deferred openly, without adopting an in-memory
    // success or trapping the user behind a persistently failing disk.
    NativeSheet(pending.takeIf{canPresent&&it.isNotEmpty()&&!deferred},{ui.text("新的成就")},{},dismissible=false){batch->
        val batchKey=batch.joinToString("|"){it.definition.id}
        key(batchKey){
            var finished by remember{mutableStateOf(false)}
            if(!finished&&batch.any{it.definition.id in eligible})Box(Modifier.fillMaxWidth().height(112.dp)){
                NativeCelebrationBurst(CelebrationBurst(1,CelebrationKind.ACHIEVEMENT),canPresent){finished=true}
            }
        }
        Text(ui.text("这些事实已经满足。关闭后只会在新的成就出现时再次提示。"),style=MaterialTheme.typography.bodyLarge)
        for(entry in batch){
            Text(ui.text(entry.definition.title),style=MaterialTheme.typography.titleMedium)
            Text(ui.text(entry.definition.description),style=MaterialTheme.typography.bodyLarge)
            Text(entry.unlockedAt?.let{ui.text("获得于 {0}",it)}?:ui.text("获得时间未知（历史记录无法推导）"),style=MaterialTheme.typography.bodySmall)
            RoomPresentationProjection.items.firstOrNull{it.achievementId==entry.definition.id}?.let{item->
                Text(ui.text("解锁摆设：{0}",if(ui.language=="en")item.englishTitle else item.title),style=MaterialTheme.typography.bodyLarge)
            }
            NativeSeparator()
        }
        if(error)Text(ui.text("展示回执未保存，请重试。"),color=MaterialTheme.colorScheme.error)
        NativeAction(ui.text(if(error)"重试" else "全部关闭"),::acknowledge,Modifier.fillMaxWidth(),pending=saving)
        if(error&&!saving)NativeAction(ui.text("稍后再试"),{deferred=true},Modifier.fillMaxWidth(),primary=false)
    }
}
