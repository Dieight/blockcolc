package com.blockcolc.preview.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import com.blockcolc.cloud.CloudFailure
import com.blockcolc.preview.CloudView
import com.blockcolc.preview.NativeCloudController
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

private fun CloudView.orderedFriends(preferred:List<String> = friendOrder):List<JSONObject>{
    val ranks=preferred.withIndex().associate{(index,id)->id to index}
    return friends.filter{it.optString("status")=="accepted"}.sortedWith(
        compareBy<JSONObject>{ranks[it.getString("id")]?:Int.MAX_VALUE}.thenBy{it.optString("name")}.thenBy{it.getString("id")},
    )
}

private data class FriendRowBounds(val top:Float,val height:Int){
    val center get()=top+height/2f
    val bottom get()=top+height
}

private class FriendDrag(val id:String,val order:List<String>,val rows:Map<String,FriendRowBounds>){
    val from=order.indexOf(id)
    private val row=rows.getValue(id)
    private val gap=(rows.getValue(order[1]).top-rows.getValue(order[0]).bottom).coerceAtLeast(0f)
    fun target(offset:Float):Int{
        val center=row.center+offset
        val index=if(offset>0)order.indices.lastOrNull{it>from&&rows.getValue(order[it]).center<=center}
            else order.indices.firstOrNull{it<from&&rows.getValue(order[it]).center>=center}
        return index?:from
    }
    fun offset(index:Int,target:Int):Float{
        val step=row.height+gap
        return when {
            target>from&&index in from+1..target -> -step
            target<from&&index in target until from -> step
            else -> 0f
        }
    }
    fun landing(target:Int):Float{
        val destination=rows.getValue(order[target])
        return if(target>from)destination.bottom-row.bottom else destination.top-row.top
    }
    fun orderAt(target:Int)=order.toMutableList().apply{add(target,removeAt(from))}
}

@Composable internal fun NativeOrderedFriendList(
    accountId:String,view:CloudView,onOrder:(List<String>)->Unit,
    card:@Composable (JSONObject,Modifier,Boolean)->Unit,
){
    val reduced=LocalNativeUi.current.reduceMotion
    var previewOrder by remember(accountId){mutableStateOf<List<String>?>(null)}
    var drag by remember(accountId){mutableStateOf<FriendDrag?>(null)}
    var landing by remember(accountId){mutableStateOf(false)}
    var target by remember(accountId){mutableIntStateOf(0)}
    val rowBounds=remember(accountId){mutableMapOf<String,FriendRowBounds>()}
    val accepted=view.orderedFriends(drag?.order?:previewOrder?:view.friendOrder)
    val ids=accepted.map{it.getString("id")}
    val latestIds by rememberUpdatedState(ids)
    val dragOffset=remember(accountId){mutableFloatStateOf(0f)}
    val scope=rememberCoroutineScope()
    val moveUp=cloudText("上移","Move up")
    val moveDown=cloudText("下移","Move down")
    val saveOrder by rememberUpdatedState(onOrder)
    LaunchedEffect(view.friendOrder){
        if(previewOrder==view.friendOrder)previewOrder=null
    }

    fun start(id:String):FriendDrag?{
        val order=latestIds
        if(drag!=null||order.size<2||id !in order||order.any{it !in rowBounds})return null
        return FriendDrag(id,order,rowBounds.toMap()).also{
            dragOffset.floatValue=0f
            target=it.from
            drag=it
        }
    }

    fun land(to:Int){
        val held=drag?:return
        if(landing)return
        landing=true
        target=to
        if(to!=held.from){
            val next=held.orderAt(to)
            previewOrder=next
            saveOrder(next)
        }
        scope.launch{
            val motion=Animatable(dragOffset.floatValue)
            motion.animateTo(held.landing(to),tween(if(reduced)0 else 250,easing=FastOutSlowInEasing)){
                dragOffset.floatValue=value
            }
            drag=null
            landing=false
        }
    }

    fun move(id:String,to:Int):Boolean{
        val order=latestIds
        if(to !in order.indices||order.getOrNull(to)==id||start(id)==null)return false
        land(to)
        return true
    }

    for((index,friend) in accepted.withIndex())key(accountId,friend.getString("id")){
        val id=friend.getString("id")
        val held=drag
        val currentIndex=held?.order?.indexOf(id)?:index
        val offset=key(held){
            animateFloatAsState(held?.offset(currentIndex,target)?:0f,
                tween(if(reduced)0 else 190,easing=FastOutSlowInEasing),label="friend-row-move")
        }
        val pickup=animateFloatAsState(if(held?.id==id&&!landing&&!reduced)1.014f else 1f,
            tween(if(reduced)0 else 150,easing=FastOutSlowInEasing),label="friend-row-pickup")
        val reorder=if(ids.size<2)Modifier else Modifier
            .onGloballyPositioned{coordinates->
                rowBounds[id]=FriendRowBounds(coordinates.positionInRoot().y,coordinates.size.height)
            }
            .pointerInput(accountId,id){
                detectDragGesturesAfterLongPress(
                    onDragStart={start(id)},
                    onDragEnd={if(drag?.id==id)land(target)},
                    onDragCancel={drag?.takeIf{it.id==id}?.let{land(it.from)}},
                ){change,amount->
                    val current=drag
                    if(current!=null&&current.id==id&&!landing){
                        change.consume()
                        dragOffset.floatValue+=amount.y
                        target=current.target(dragOffset.floatValue)
                    }
                }
            }.zIndex(if(held?.id==id)1f else 0f)
            .graphicsLayer{
                translationY=if(held?.id==id)dragOffset.floatValue else offset.value
                scaleX=pickup.value
                scaleY=pickup.value
            }
            .semantics{
                customActions=buildList{
                    if(index>0)add(CustomAccessibilityAction(moveUp){move(id,index-1)})
                    if(index<ids.lastIndex)add(CustomAccessibilityAction(moveDown){move(id,index+1)})
                }
            }
        card(friend,reorder,held?.id==id)
    }
}

/** Invite codes are 18 hexadecimal characters. Pasted text may contain
 * spaces, dashes, lower case or surrounding words. */
internal fun normalizeFriendCode(raw:String):String=raw.filterNot{it.isWhitespace()||it=='-'||it=='·'}.uppercase()
internal fun isFriendCode(code:String)=code.length==18&&code.all{it in '0'..'9'||it in 'A'..'F'}
private val friendCodeToken=Regex("(?<![A-Za-z0-9])(?:[0-9A-Fa-f]{18}|[0-9A-Fa-f]{6}(?:[ \\t·-]+[0-9A-Fa-f]{6})+)(?![A-Za-z0-9])")
internal fun pastedFriendCode(raw:String):String?=friendCodeToken.findAll(raw)
    .map{normalizeFriendCode(it.value)}.filter(::isFriendCode).distinct().singleOrNull()
internal fun groupedFriendCode(code:String)=code.chunked(6).joinToString(" ")

@Composable internal fun NativeFriendsPanel(controller:NativeCloudController,view:CloudView,onRemove:(String)->Unit){
    val account=checkNotNull(view.account)
    val accountId=account.getString("id")
    val pending=view.friends.filter{it.optString("status")=="pending"}
    val empty=view.friends.none{it.optString("status")=="accepted"}
    val clipboard=LocalClipboardManager.current
    val context=androidx.compose.ui.platform.LocalContext.current
    val focus=LocalFocusManager.current
    val keyboard=LocalSoftwareKeyboardController.current
    var invite by rememberSaveable(accountId){mutableStateOf("")}
    var pasteFailed by remember(accountId){mutableStateOf(false)}
    var adding by rememberSaveable(accountId){mutableStateOf(empty)}
    LaunchedEffect(accountId){
        while(true){
            controller.refreshFriends()
            delay(10_000)
        }
    }
    if(empty)Text(cloudText("还没有好友","No friends yet"),style=MaterialTheme.typography.bodyMedium)
    NativeOrderedFriendList(accountId,view,{controller.saveFriendOrder(accountId,it)}){friend,modifier,dragging->
        NativeFriendCard(
            friend=friend,
            defaultSharing=account.optJSONObject("sharing")?:JSONObject(),
            enabled=!view.busy,
            fetchHistory={controller.friendHistory(accountId,friend.getString("id"))},
            changeSharing={controller.sharing(friend.getString("id"),it)},
            remove={onRemove(friend.getString("id"))},
            modifier=modifier,
            dragging=dragging,
        )
    }

    if(pending.isNotEmpty()){
        NativeSection(cloudText("好友申请","Friend requests")){
            for((index,friend) in pending.withIndex()){
                if(index>0)NativeSeparator()
                val incoming=friend.optBoolean("incoming")
                Column(Modifier.padding(vertical=8.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                    Text(friend.optString("name"),style=MaterialTheme.typography.titleSmall)
                    if(!incoming)Text(cloudText("等待对方接受","Waiting for acceptance"),style=MaterialTheme.typography.bodySmall)
                    Row(horizontalArrangement=Arrangement.spacedBy(10.dp)){
                        val id=friend.getString("id")
                        if(incoming)NativeAction(cloudText("接受邀请","Accept invite"),{controller.respond(id,"accept")},
                            Modifier.weight(1f),enabled=!view.busy)
                        NativeAction(if(incoming)cloudText("拒绝","Decline")else cloudText("撤回","Withdraw"),
                            {controller.respond(id,"remove")},Modifier.weight(1f),enabled=!view.busy,primary=false,icon="close")
                    }
                }
            }
        }
    }

    NativeDisclosure(cloudText("添加好友","Add friend"),expanded=adding,onExpandedChange={adding=it}){
        val code=account.optString("friendCode")
        if(code.isNotBlank()){
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
                Column(Modifier.weight(1f)){
                    Text(cloudText("我的好友码","My friend code"),style=MaterialTheme.typography.bodySmall)
                    Text(groupedFriendCode(code),style=MaterialTheme.typography.bodyLarge)
                }
                NativeIconAction(cloudText("复制好友码","Copy friend code"),"copy",{clipboard.setText(AnnotatedString(code))})
                NativeIconAction(cloudText("分享好友码","Share friend code"),"export",{shareFriendCode(context,code)})
            }
        }
        val normalized=normalizeFriendCode(invite)
        val canSend=!view.busy&&!pasteFailed&&isFriendCode(normalized)
        fun send(){
            if(!canSend)return
            controller.invite(normalized)
            invite=""
            focus.clearFocus()
            keyboard?.hide()
        }
        FriendCodeField(cloudText("添加好友码","Add friend code"),invite,normalized.length,{if(it.length<=64){invite=it;pasteFailed=false}},::send){
            val code=clipboard.getText()?.text?.let(::pastedFriendCode)
            pasteFailed=code==null
            if(code!=null)invite=code
        }
        if(pasteFailed)Text(cloudText("请复制一个完整的好友码。","Copy one complete friend code."),
            style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.error)
        NativeAction(cloudText("发送邀请","Send invite"),::send,Modifier.fillMaxWidth(),enabled=canSend,primary=false,icon="plus")
    }
}

@Composable internal fun NativeMinimalFriends(view:CloudView,visible:Boolean,refresh:()->Unit){
    val account=view.account?.optString("id")
    LaunchedEffect(account,visible){
        if(visible&&account!=null)while(true){
            refresh()
            delay(10_000)
        }
    }
    val friends=remember(view.friends,view.friendOrder){view.orderedFriends()}
    val divider=LocalContentColor.current.copy(alpha=.18f)
    Column(Modifier.fillMaxSize().testTag("minimal-friends")){
        NativeMinimalPanelLabel(cloudText("好友","Friends"),"friends")
        if(friends.isEmpty())Text(
            if(view.friendsError!=null)cloudText("好友暂不可用","Friends are unavailable")else cloudText("还没有好友","No friends yet"),
            style=MaterialTheme.typography.bodyMedium,
        )
        Column(Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState())){
            for((index,friend) in friends.withIndex())key(friend.optString("id")){
                if(index>0)HorizontalDivider(color=divider)
                val live = rememberFriendLiveStatus(friend)
                Row(Modifier.fillMaxWidth().padding(vertical=8.dp),verticalAlignment=Alignment.CenterVertically,
                    horizontalArrangement=Arrangement.spacedBy(10.dp)){
                    Box(Modifier.size(7.dp).background(if(live.focusing)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline))
                    Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)){
                        Text(friend.optString("name"),style=MaterialTheme.typography.bodyMedium)
                        friendStatus(friend,live)?.let{Text(it,style=MaterialTheme.typography.bodySmall)}
                        friendPeriod(friend,live)?.let{Text(it,style=MaterialTheme.typography.bodySmall)}
                    }
                }
            }
        }
    }
}

@Composable internal fun NativeFriendCard(
    friend:JSONObject,
    defaultSharing:JSONObject,
    enabled:Boolean,
    fetchHistory:suspend ()->JSONObject,
    changeSharing:(JSONObject?)->Unit,
    remove:()->Unit,
    modifier:Modifier=Modifier,
    dragging:Boolean=false,
){
    val name=friend.optString("name")
    val readOnly=friend.optBoolean("readOnly")
    val revision=friend.opt("historyRevision") as? String
    var expanded by rememberSaveable{mutableStateOf(false)}
    var sharingOpen by rememberSaveable{mutableStateOf(false)}
    var history by remember{mutableStateOf<FriendCalendar?>(null)}
    var fetchedRevision by remember{mutableStateOf<String?>(null)}
    var error by remember{mutableStateOf(false)}
    var retry by remember{mutableIntStateOf(0)}
    val requestHistory by rememberUpdatedState(fetchHistory)
    LaunchedEffect(revision,expanded,retry){
        if(revision==null){history=null;fetchedRevision=null;error=false;return@LaunchedEffect}
        if(!expanded||fetchedRevision==revision)return@LaunchedEffect
        error=false
        try{
            val response=requestHistory()
            history=withContext(Dispatchers.Default){parseFriendCalendar(response)}
            fetchedRevision=revision
        }catch(cancelled:CancellationException){
            throw cancelled
        }catch(failed:Exception){
            if((failed as? CloudFailure)?.code in setOf("HISTORY_UNAVAILABLE","FRIEND_NOT_FOUND","UNAUTHORIZED"))history=null
            error=true
        }
    }

    val live=rememberFriendLiveStatus(friend)
    val summary=friendStatus(friend,live)
    val time=friendPeriod(friend,live)
    val description=listOfNotNull(summary,time).joinToString("\n").ifEmpty{null}
    Column(modifier.fillMaxWidth().border(1.dp,if(dragging)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant)
        .background(MaterialTheme.colorScheme.surface).padding(horizontal=14.dp)){
        NativeDisclosure(name,description,expanded,{expanded=it},
            titleStyle=MaterialTheme.typography.titleMedium,descriptionStyle=MaterialTheme.typography.bodyMedium,
            leading={
                val color=if(live.focusing)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant
                Box(Modifier.size(8.dp).background(color))
            }){
            Column(Modifier.fillMaxWidth().padding(bottom=12.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
                if(revision!=null){
                    NativeSeparator()
                    if(error){
                        Text(cloudText("暂时无法读取专注统计","Focus history is unavailable"),style=MaterialTheme.typography.bodySmall)
                        NativeAction(cloudText("重试","Retry"),{retry++},Modifier.fillMaxWidth(),primary=false,icon="reset")
                    }else{
                        val data=history
                        if(data==null)NativeBusy(Modifier.padding(8.dp).size(18.dp))else NativeFriendHistory(data)
                    }
                }
                if(readOnly)Text(cloudText("Mutsumi Focus · 公开只读数据","Mutsumi Focus · public, read-only"),style=MaterialTheme.typography.bodySmall)
                else NativeDisclosure(cloudText("对该好友可见","Visible to this friend"),expanded=sharingOpen,
                    onExpandedChange={sharingOpen=it},rowHeight=44.dp){
                    CloudSharing(friend.optJSONObject("sharing")?:defaultSharing,enabled,onChange=changeSharing)
                    NativeAction(cloudText("使用默认设置","Use defaults"),{changeSharing(null)},Modifier.fillMaxWidth(),enabled=enabled,primary=false)
                }
                // A quiet entry; the confirmation sheet states what removal does.
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End){
                    CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onSurfaceVariant){
                        FormalTextAction(cloudText("移除好友","Remove friend"),"close",remove,enabled=enabled)
                    }
                }
            }
        }
    }
}

internal data class FriendLiveStatus(val stale: Boolean, val idle: Boolean, val focusing: Boolean, val estimatedMs: Long?)

private fun JSONObject.instant(key: String): Instant? =
    (opt(key) as? String)?.let { runCatching { Instant.parse(it) }.getOrNull() }

internal fun friendLiveStatus(friend: JSONObject, now: Long): FriendLiveStatus {
    val estimated = friend.optBoolean("estimated")
    val start = friend.instant("startedAt")?.toEpochMilli()
    val end = friend.instant("endsAt")?.toEpochMilli()
    val expiry = friend.instant("statusExpiresAt")?.toEpochMilli() ?: if (estimated) {
        end ?: friend.instant("updatedAt")?.toEpochMilli()?.let { it + 3 * 60 * 60_000L + 90_000 }
    } else null
    val rest = friend.optString("state") == "rest"
    val paused = friend.optString("focusState") == "paused"
    val idle = friend.opt("focusing") == false && !rest && !paused
    val stale = friend.optBoolean("stale") || (!idle && expiry != null && now >= expiry)
    val focusing = !stale && !rest && !paused && friend.optBoolean("focusing")
    val elapsed = if (focusing && estimated && start != null) (minOf(now, end ?: now) - start).coerceAtLeast(0) else null
    return FriendLiveStatus(stale, idle, focusing, elapsed)
}

@Composable private fun rememberFriendLiveStatus(friend: JSONObject): FriendLiveStatus {
    fun now() = NativeCloudController.peek()?.focusNow() ?: System.currentTimeMillis()
    val ticks = !friend.optBoolean("stale") && (friend.optBoolean("estimated") || friend.has("statusExpiresAt"))
    var current by remember(friend) { mutableLongStateOf(now()) }
    LaunchedEffect(friend,ticks) {
        if (ticks) while (!friendLiveStatus(friend,current).stale) {
            delay(10_000)
            current = now()
        }
    }
    return friendLiveStatus(friend, current)
}

@Composable private fun friendStatus(friend:JSONObject,live:FriendLiveStatus):String?{
    if(live.stale)return if(friend.optBoolean("readOnly"))cloudText("实时状态暂不可用","Live status unavailable")
        else cloudText("等待同步","Waiting for sync")
    val task=(friend.opt("currentName") as? String)?.takeIf{it.isNotBlank()}
    val status = when{
        friend.optString("state")=="rest"->listOfNotNull(task,cloudText("休息中","Resting")).distinct().joinToString(" · ")
        friend.optString("focusState")=="paused"->listOfNotNull(task,cloudText("已暂停","Paused")).joinToString(" · ")
        live.idle->cloudText("暂未专注","Not focusing")
        task!=null->task
        live.focusing->cloudText("专注中","Focusing")
        else->null
    }
    val source = friend.optJSONObject("source")
    return if (source?.optString("kind")=="integration")
        listOfNotNull(status,source.optString("name").takeIf(String::isNotBlank)).joinToString(" · ").ifBlank { null }
    else status
}

@Composable private fun friendPeriod(friend:JSONObject,live:FriendLiveStatus):String?{
    if (live.stale || live.idle) return null
    val start=friend.instant("startedAt")
    val end=friend.instant("endsAt")
    if(start==null&&end==null)return null
    if(live.estimatedMs!=null){
        val elapsed=formatDuration(live.estimatedMs)
        return cloudText("预计已持续 $elapsed","Estimated duration $elapsed")
    }
    val zone=ZoneId.systemDefault()
    val today=LocalDate.now(zone)
    val english=LocalNativeUi.current.language=="en"
    val datePattern=cloudText("M月d日 HH:mm","MMM d, HH:mm")
    val dateTime=remember(datePattern,english){
        DateTimeFormatter.ofPattern(datePattern,if(english)Locale.ENGLISH else Locale.SIMPLIFIED_CHINESE)
    }
    val clock=remember{DateTimeFormatter.ofPattern("HH:mm",Locale.ROOT)}
    fun format(value:Instant):String{
        val local=value.atZone(zone)
        return if(local.toLocalDate()==today)clock.format(local)else dateTime.format(local)
    }
    if(start!=null&&end!=null)return "${format(start)} – ${format(end)}"
    if(start!=null&&friend.optBoolean("waitingForEnd"))return "${format(start)} · ${cloudText("等待用户结束","Waiting for manual finish")}"
    return if(start!=null)cloudText("${format(start)} 开始","Started ${format(start)}")
        else cloudText("${format(checkNotNull(end))} 结束","Ends ${format(checkNotNull(end))}")
}

private data class FriendCalendar(
    val today:LocalDate,
    val earliest:LocalDate?,
    val days:Map<LocalDate,Long>,
    val complete:Boolean,
    val total:Long,
    val hasMissing:Boolean,
)

private fun parseFriendCalendar(data:JSONObject):FriendCalendar{
    val today=LocalDate.parse(data.getString("today"))
    val array=data.getJSONArray("days")
    val days=buildMap{
        for(i in 0 until array.length()){
            val row=array.optJSONObject(i)?:continue
            val date=runCatching{LocalDate.parse(row.optString("date"))}.getOrNull()?:continue
            val duration=row.optLong("actualFocusMs",-1)
            if(date<=today&&duration>=0)put(date,duration)
        }
    }
    val earliest=days.asSequence().filter{it.value>0}.map{it.key}.minOrNull()
    val complete=data.optBoolean("complete")
    val hasMissing=!complete&&earliest!=null&&ChronoUnit.DAYS.between(earliest,today)+1>days.count{it.key>=earliest}
    return FriendCalendar(today,earliest,days,complete,days.values.sum(),hasMissing)
}

@Composable private fun NativeFriendHistory(data:FriendCalendar){
    val today=data.today
    val earliest=data.earliest
    var total by rememberSaveable{mutableStateOf(false)}
    val duration=if(total)data.total else data.days[today]?:0L.takeIf{data.complete}
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
        Column(Modifier.weight(1f)){
            Text(if(total)cloudText("累计专注","Total focus")else cloudText("今日专注","Today's focus"),style=MaterialTheme.typography.bodySmall)
            Text(duration?.let{formatDuration(it)}?:cloudText("暂不可用","Unavailable"),style=MaterialTheme.typography.titleMedium)
        }
        FormalTextAction(if(total)cloudText("今日","Today")else cloudText("总计","Total"),"",{total=!total})
    }
    if(earliest==null){
        Text(cloudText("暂无专注记录","No focus history"),style=MaterialTheme.typography.bodyMedium)
        return
    }
    val start=earliest.minusDays((earliest.dayOfWeek.value-1).toLong())
    val count=(ChronoUnit.DAYS.between(start,today)/7+1).toInt()
    val complete=data.complete
    val list=rememberLazyListState(initialFirstVisibleItemIndex=count-1)
    val palette=nativeFocusHeatmapColors()
    val title=cloudText("专注热力图","Focus heatmap")
    Text("$earliest – $today",style=MaterialTheme.typography.bodySmall)
    LazyRow(Modifier.fillMaxWidth().height(81.dp).semantics{contentDescription=title},state=list,horizontalArrangement=Arrangement.spacedBy(3.dp)){
        items(count){column->
            Canvas(Modifier.size(9.dp,81.dp)){
                val edge=9.dp.toPx()
                for(row in 0..6){
                    val date=start.plusDays(column*7L+row)
                    if(date<earliest||date>today)continue
                    val duration=data.days[date]
                    val origin=Offset(0f,row*12.dp.toPx())
                    if(duration!=null||complete)drawFocusHeatmapCell(palette,heatmapBand(duration?:0L),origin,edge)
                }
            }
        }
    }
    NativeFocusHeatmapLegend(palette)
    if(data.hasMissing)Text(cloudText("留白日期未提供数据","Blank dates have no shared data"),style=MaterialTheme.typography.bodySmall)
}

/** Square code entry with its own paste action and an 18-character count. */
@Composable private fun FriendCodeField(label:String,value:String,count:Int,onChange:(String)->Unit,onSend:()->Unit,onPaste:()->Unit){
    val colors=MaterialTheme.colorScheme
    Column(Modifier.fillMaxWidth().padding(vertical=8.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
            Text(label,Modifier.weight(1f),style=MaterialTheme.typography.bodySmall)
            Text("$count / 18",style=MaterialTheme.typography.bodySmall,color=colors.onSurfaceVariant)
        }
        Row(Modifier.fillMaxWidth().border(1.dp,colors.outline).background(colors.surface),verticalAlignment=Alignment.CenterVertically){
            BasicTextField(value,onChange,Modifier.weight(1f).heightIn(min=44.dp).padding(horizontal=12.dp,vertical=10.dp).semantics{contentDescription=label},
                singleLine=true,textStyle=MaterialTheme.typography.bodyLarge.copy(color=colors.onSurface),cursorBrush=SolidColor(colors.primary),
                keyboardOptions=KeyboardOptions(capitalization=KeyboardCapitalization.Characters,keyboardType=KeyboardType.Ascii,imeAction=ImeAction.Send),
                keyboardActions=KeyboardActions(onSend={onSend()}),
                decorationBox={field->Box(contentAlignment=Alignment.CenterStart){
                    if(value.isEmpty())Text(cloudText("18 位好友码","18-character code"),style=MaterialTheme.typography.bodyLarge,color=colors.onSurfaceVariant)
                    field()
                }})
            FormalTextAction(cloudText("粘贴","Paste"),"copy",onPaste,Modifier.padding(end=8.dp))
        }
    }
}

private fun shareFriendCode(context:android.content.Context,code:String){
    val send=android.content.Intent(android.content.Intent.ACTION_SEND).setType("text/plain").putExtra(android.content.Intent.EXTRA_TEXT,code)
    val chooser=android.content.Intent.createChooser(send,null)
    if(context !is android.app.Activity)chooser.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
    runCatching{context.startActivity(chooser)}
}
