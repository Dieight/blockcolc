package com.blockcolc.preview.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import com.blockcolc.presentation.*
import com.blockcolc.preview.WorkspaceUiState

/** The original workbench memory replaces the timer, never overlays it. */
@Composable fun NativeBuildingMemory(s:WorkspaceUiState,runtime:WorkspaceActions,id:String,onClose:()->Unit,modifier:Modifier=Modifier){
    val ui=LocalNativeUi.current;val memory=s.workspace?.memories?.buildings?.find{it.id==id}
    val continuing=rememberNativeRequest(s,onClose)
    if(memory==null){LaunchedEffect(id){onClose()};Box(modifier);return}
    val monument=memory.status=="monument";val colors=MaterialTheme.colorScheme
    val title=if(memory.cycleNumber==null)memory.title else ui.text("{0} · 第 {1} 座",memory.title,memory.cycleNumber)
    val entry=remember(id){Animatable(if(ui.reduceMotion)1f else 0f)}
    LaunchedEffect(id){entry.animateTo(1f,tween(if(ui.reduceMotion)0 else 280,easing=CubicBezierEasing(.2f,.75f,.25f,1f)))}
    BoxWithConstraints(modifier.background(colors.surface).semantics{paneTitle=ui.text("建筑记忆")}){
        val available=maxHeight
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).heightIn(min=available).graphicsLayer{translationY=(1-entry.value)*24.dp.toPx();alpha=entry.value}.padding(horizontal=20.dp,vertical=18.dp)){
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
                Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(3.dp)){
                    Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(6.dp)){
                        PixelGlyph("cube",Modifier.size(16.dp),colors.primary)
                        NativeText(ui.text("建筑记忆 ·")+" "+ui.text(if(monument)"纪念建筑"else if(memory.active)"正在建造"else"暂停建造"),NativeTextRole.CAPTION,color=colors.onSurfaceVariant)
                    }
                    NativeText(title,NativeTextRole.SECTION)
                }
                FormalTextAction(ui.text("返回"),"close",onClose,Modifier.semantics{contentDescription=ui.text("关闭建筑记忆")})
            }
            Spacer(Modifier.height(10.dp))
            val stage=when{memory.progress<=0->"场地准备";memory.progress<1800->"地基施工";memory.progress<3800->"框架与地板";memory.progress<6500->"墙体施工";memory.progress<8800->"屋顶施工";memory.progress<10000->"门窗与收尾";else->"建筑已完成"}
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.Bottom,horizontalArrangement=Arrangement.spacedBy(8.dp)){
                NativeText(listOfNotNull(s.blueprintNames[memory.blueprint]?.let{ui.text(it)},ui.text(stage)).joinToString(" · "),NativeTextRole.CAPTION,Modifier.weight(1f),colors.onSurfaceVariant)
                NativeText("${(memory.progress+50)/100}%",NativeTextRole.SECTION,accent=true)
            }
            Spacer(Modifier.height(4.dp));FormalProgress(memory.progress);Spacer(Modifier.height(3.dp))
            NativeText(ui.text(if(memory.condition>=8000)"保存完整"else if(memory.condition>=5000)"已有风化"else"需要修复"),NativeTextRole.CAPTION,color=colors.onSurfaceVariant)
            Column(Modifier.fillMaxWidth().weight(1f).padding(top=12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                Row(Modifier.fillMaxWidth().weight(1f).heightIn(min=64.dp),horizontalArrangement=Arrangement.spacedBy(12.dp)){
                    FormalMemoryFact(ui.text("累计实际投入"),Modifier.weight(1.5f)){
                        if(memory.durationMs>0)Row(verticalAlignment=Alignment.Bottom,horizontalArrangement=Arrangement.spacedBy(4.dp)){NativeText(((memory.durationMs+30000)/60000).toString(),NativeTextRole.NUMBER,accent=true);NativeText(ui.text("分钟"),NativeTextRole.CAPTION)}
                        else NativeText(ui.text("尚无记录"),NativeTextRole.CAPTION)
                    }
                    FormalMemoryFact(ui.text("完成轮次"),Modifier.weight(1f)){Row(verticalAlignment=Alignment.Bottom,horizontalArrangement=Arrangement.spacedBy(4.dp)){NativeText(memory.completed.toString(),NativeTextRole.NUMBER,accent=true);NativeText(ui.text("轮"),NativeTextRole.CAPTION)}}
                }
                Row(Modifier.fillMaxWidth().weight(1f).heightIn(min=50.dp),horizontalArrangement=Arrangement.spacedBy(12.dp)){
                    FormalMemoryFact(ui.text("中断投入"),Modifier.weight(1.5f)){NativeText(if(memory.interrupted>0)ui.text("{0} 条 · {1} 分钟",memory.interrupted,(memory.interruptedMs+30000)/60000)else ui.text("无"),NativeTextRole.CAPTION)}
                    FormalMemoryFact(ui.text("最近一次专注"),Modifier.weight(1f)){NativeText(memory.lastFocusDate?:ui.text("尚无记录"),NativeTextRole.CAPTION)}
                }
            }
            if(memory.unknownRounds>0){Spacer(Modifier.height(5.dp));NativeText(ui.text("另有 {0} 条无法追溯，未分摊。",memory.unknownRounds),NativeTextRole.CAPTION)}
            val next=memory.nextTask?:when{memory.awaitingBuilding->ui.text("选择下一座习惯建筑");memory.nextHabitRound!=null->ui.text("完成本周期第 {0} / {1} 轮",memory.nextHabitRound,memory.habitTarget);else->null}
            if(next!=null){Spacer(Modifier.height(7.dp));NativeSeparator();Row(Modifier.padding(top=5.dp),horizontalArrangement=Arrangement.spacedBy(8.dp),verticalAlignment=Alignment.Bottom){NativeText(ui.text("下一步"),NativeTextRole.CAPTION,color=colors.onSurfaceVariant);NativeText(next,NativeTextRole.BODY)}}
            Spacer(Modifier.height(10.dp))
            if(!monument){
                val blocked=!memory.active&&s.planId!=null
                NativeAction(ui.text(if(memory.active)"继续专注"else"继续这个任务"),{if(memory.active)onClose()else continuing.submit{runtime.dispatch(WorkspaceMutation.SwitchProject(memory.projectId),it)}},Modifier.fillMaxWidth(),pending=continuing.busy,enabled=!blocked&&!s.busy,primary=false,icon="play")
                if(blocked)NativeText(ui.text("请先结束当前计划"),NativeTextRole.CAPTION)
                NativeRequestError(continuing)
            }else NativeText(ui.text("已完成并保留为聚落记忆。投入分布见统计页“纪念建筑”。"),NativeTextRole.CAPTION)
        }
    }
}
@Composable private fun FormalMemoryFact(label:String,modifier:Modifier,content:@Composable ()->Unit){
    Column(modifier.fillMaxHeight(),verticalArrangement=Arrangement.Center){NativeSeparator();Spacer(Modifier.height(6.dp));NativeText(label,NativeTextRole.CAPTION,color=MaterialTheme.colorScheme.onSurfaceVariant);Spacer(Modifier.height(4.dp));content();Spacer(Modifier.height(6.dp))}
}

@Composable internal fun NativeRewardMemoryPlate(reward:RewardMemoryFact,onClose:()->Unit,modifier:Modifier=Modifier){
    val ui=LocalNativeUi.current
    Row(modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface.copy(alpha=.94f)).padding(horizontal=12.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)){
        PixelGlyph("chest",Modifier.size(22.dp),MaterialTheme.colorScheme.primary)
        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(3.dp)){
            NativeText(reward.title?:ui.text(when(reward.kind){WorldAssetKind.BIRTHDAY->"生日蛋糕";WorldAssetKind.HOLIDAY->"节日奖励";else->"每日奖励"}),NativeTextRole.BODY)
            NativeText(reward.date.replace('-','.')+" "+ui.text("获得的建造奖励"),NativeTextRole.CAPTION)
            reward.holidayId?.let(com.blockcolc.presentation.HolidayEmblems::name)?.let{NativeText(ui.text(it),NativeTextRole.CAPTION)}
        }
        NativeIconAction(ui.text("关闭奖励记忆"),"close",onClose)
    }
}
