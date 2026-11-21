package com.blockcolc.preview.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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

@Composable internal fun NativeOrderedFriendList(
    accountId:String,view:CloudView,onOrder:(List<String>)->Unit,
    card:@Composable (JSONObject,Modifier,Boolean)->Unit,
){
    var previewOrder by remember(accountId){mutableStateOf<List<String>?>(null)}
    var dragging by remember(accountId){mutableStateOf<String?>(null)}
    val centers=remember(accountId){mutableMapOf<String,Float>()}
    val accepted=view.orderedFriends(previewOrder?:view.friendOrder)
    val ids=accepted.map{it.getString("id")}
    val latestIds by rememberUpdatedState(ids)
    var dragOffset by remember(accountId){mutableFloatStateOf(0f)}
    val moveUp=cloudText("上移","Move up")
    val moveDown=cloudText("下移","Move down")
    val saveOrder by rememberUpdatedState(onOrder)
    LaunchedEffect(view.friendOrder){
        if(previewOrder==view.friendOrder)previewOrder=null
    }

    fun move(id:String,to:Int):Boolean{
        val order=latestIds
        val from=order.indexOf(id)
        if(from<0||to !in order.indices||to==from)return false
        val next=order.toMutableList().apply{add(to,removeAt(from))}
        previewOrder=next
        saveOrder(next)
        return true
    }

    for((index,friend) in accepted.withIndex())key(accountId,friend.getString("id")){
        val id=friend.getString("id")
        val reorder=if(ids.size<2)Modifier else Modifier
            .onGloballyPositioned{coordinates->
                centers[id]=coordinates.positionInRoot().y+coordinates.size.height/2f
            }
            .pointerInput(accountId,id){
                var startCenter:Float?=null
                var startPositions=emptyMap<String,Float>()
                detectDragGesturesAfterLongPress(
                    onDragStart={
                        startPositions=centers.toMap()
                        startCenter=startPositions[id]
                        dragOffset=0f
                        dragging=id
                    },
                    onDragEnd={
                        val order=latestIds
                        val from=order.indexOf(id)
                        startCenter?.let{center->
                            val y=center+dragOffset
                            val target=if(dragOffset>0f)order.indices.lastOrNull{it>from&&(startPositions[order[it]]?:Float.MAX_VALUE)<=y}
                                else order.indices.firstOrNull{it<from&&(startPositions[order[it]]?:Float.NEGATIVE_INFINITY)>=y}
                            if(target!=null)move(id,target)
                        }
                        dragging=null
                    },
                    onDragCancel={dragging=null},
                ){change,amount->
                    change.consume()
                    dragOffset+=amount.y
                }
            }.zIndex(if(dragging==id)1f else 0f)
            .graphicsLayer{translationY=if(dragging==id)dragOffset else 0f}
            .semantics{
                customActions=buildList{
                    if(index>0)add(CustomAccessibilityAction(moveUp){move(id,index-1)})
                    if(index<ids.lastIndex)add(CustomAccessibilityAction(moveDown){move(id,index+1)})
                }
            }
        card(friend,reorder,dragging==id)
    }
}

@Composable internal fun NativeFriendsPanel(controller:NativeCloudController,view:CloudView){
    val account=checkNotNull(view.account)
    val accountId=account.getString("id")
    val pending=view.friends.filter{it.optString("status")=="pending"}
    val empty=view.friends.none{it.optString("status")=="accepted"}
    val clipboard=LocalClipboardManager.current
    val focus=LocalFocusManager.current
    val keyboard=LocalSoftwareKeyboardController.current
    var invite by rememberSaveable(accountId){mutableStateOf("")}
    var adding by rememberSaveable(accountId){mutableStateOf(empty)}
    LaunchedEffect(accountId){
        while(true){
            controller.refreshFriends()
            delay(6_000)
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
            remove={controller.respond(friend.getString("id"),"remove")},
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
                    Text(code,style=MaterialTheme.typography.bodyMedium)
                }
                NativeIconAction(cloudText("复制好友码","Copy friend code"),"chest",{clipboard.setText(AnnotatedString(code))})
            }
        }
        CloudField(cloudText("添加好友码","Add friend code"),invite,{invite=it})
        NativeAction(cloudText("发送邀请","Send invite"),{
            controller.invite(invite)
            invite=""
            focus.clearFocus()
            keyboard?.hide()
        },Modifier.fillMaxWidth(),enabled=!view.busy&&invite.trim().length==18,primary=false,icon="plus")
    }
}

@Composable internal fun NativeMinimalFriends(view:CloudView,visible:Boolean,refresh:()->Unit,onOpen:()->Unit){
    val account=view.account?.optString("id")
    LaunchedEffect(account,visible){
        if(visible&&account!=null)while(true){
            refresh()
            delay(6_000)
        }
    }
    val friends=remember(view.friends,view.friendOrder){view.orderedFriends()}
    Column(Modifier.fillMaxSize().testTag("minimal-friends")){
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
            Text(cloudText("好友","Friends"),Modifier.weight(1f),style=MaterialTheme.typography.titleMedium)
            NativeIconAction(cloudText("查看好友","View friends"),"friends",onOpen)
        }
        if(friends.isEmpty())Text(
            if(view.friendsError!=null)cloudText("好友暂不可用","Friends are unavailable")else cloudText("还没有好友","No friends yet"),
            style=MaterialTheme.typography.bodyMedium,
        )
        Column(Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState())){
            for((index,friend) in friends.withIndex())key(friend.optString("id")){
                if(index>0)NativeSeparator()
                Row(Modifier.fillMaxWidth().padding(vertical=8.dp),verticalAlignment=Alignment.CenterVertically,
                    horizontalArrangement=Arrangement.spacedBy(10.dp)){
                    val focusing=friend.optBoolean("focusing")&&!friend.optBoolean("stale")
                    Box(Modifier.size(7.dp).background(if(focusing)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline))
                    Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)){
                        Text(friend.optString("name"),style=MaterialTheme.typography.bodyMedium)
                        friendStatus(friend)?.let{Text(it,style=MaterialTheme.typography.bodySmall)}
                        friendPeriod(friend)?.let{Text(it,style=MaterialTheme.typography.bodySmall)}
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

    val summary=friendStatus(friend)
    val time=friendPeriod(friend)
    val description=listOfNotNull(summary,time).joinToString("\n").ifEmpty{null}
    Column(modifier.fillMaxWidth().border(1.dp,if(dragging)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant)
        .background(MaterialTheme.colorScheme.surface).padding(horizontal=14.dp)){
        NativeDisclosure(name,description,expanded,{expanded=it},rowHeight=64.dp,
            titleStyle=MaterialTheme.typography.titleMedium,descriptionStyle=MaterialTheme.typography.bodyMedium,contentSpacing=10.dp,
            leading={
                val color=if(friend.optBoolean("focusing"))MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant
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
                NativeAction(cloudText("移除好友","Remove friend"),remove,Modifier.fillMaxWidth(),enabled=enabled,primary=false,icon="close")
            }
        }
    }
}

@Composable private fun friendStatus(friend:JSONObject):String?{
    if(friend.optBoolean("stale"))return cloudText("实时状态暂不可用","Live status unavailable")
    val task=(friend.opt("currentName") as? String)?.takeIf{it.isNotBlank()}
    return when{
        friend.optString("focusState")=="paused"->listOfNotNull(task,cloudText("已暂停","Paused")).joinToString(" · ")
        task!=null->task
        friend.optBoolean("focusing")->cloudText("专注中","Focusing")
        friend.has("focusing")->cloudText("暂未专注","Not focusing")
        else->null
    }
}

@Composable private fun friendPeriod(friend:JSONObject):String?{
    val start=(friend.opt("startedAt") as? String)?.let{runCatching{Instant.parse(it)}.getOrNull()}
    val end=(friend.opt("endsAt") as? String)?.let{runCatching{Instant.parse(it)}.getOrNull()}
    if(start==null&&end==null)return null
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
    Text(cloudText("累计专注","Total focus"),style=MaterialTheme.typography.bodySmall)
    Text(formatDuration(data.total),style=MaterialTheme.typography.titleMedium)
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
