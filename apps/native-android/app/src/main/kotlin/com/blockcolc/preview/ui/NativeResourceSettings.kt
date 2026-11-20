package com.blockcolc.preview.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.blockcolc.preview.resources.NativeResourceLibraryView
import com.blockcolc.world.resource.ResourceContentState
import com.blockcolc.world.resource.NativeResourceArchive
import com.blockcolc.world.resource.ResourceArchiveLimits

@Composable fun NativeResourceSettings(state:NativeResourceLibraryView,onImport:()->Unit,onRefresh:()->Unit,onRetry:()->Unit,
    onOriginal:()->Unit,onSelect:(String?,Boolean)->Unit,onDelete:(String)->Unit){
    val ui=LocalNativeUi.current;val metadata=state.metadata;val available=state.ready&&!state.busy&&metadata!=null
    var deleting by rememberNativePageState<String?>("resources/deleting"){null}
    val current=metadata?.items?.firstOrNull{it.id==metadata.activeId}?.name?:ui.text("方块钟原创材质")
    NativeSettingGroup("方块材质包",current,trailing={
        NativeInfoAction(ui.text("导入材质包"),ui.text(
            "支持 Java 版资源包 ZIP（最多 {0} MiB）或客户端 JAR（最多 {1} MiB）。",
            remember{ResourceArchiveLimits().maxInputBytes / (1024 * 1024)},NativeResourceArchive.MAX_JAR_BYTES / (1024 * 1024),
        ))
        NativeIconAction(ui.text("导入材质包"),"plus",onImport,pending=state.operation=="import",enabled=available)
        NativeIconAction(ui.text("刷新"),"reset",onRefresh,pending=state.operation=="refresh",enabled=!state.busy)
    }){
        val original=metadata?.let{it.activeId==null&&it.baseId==null}==true
        NativeInlineAction(ui.text("方块钟原创材质"),onOriginal,if(original)"check"else"map",
            ui.text(if(original)"使用中"else"使用"),pending=state.operation=="original",enabled=available,checked=original)
        if(!state.ready)Text(ui.text("正在读取本机资源包…"),style=MaterialTheme.typography.bodySmall)
        for(item in metadata?.items.orEmpty()){
            Column(Modifier.fillMaxWidth().testTag("resource-pack-${item.id}")){
            NativeSeparator()
            Row(Modifier.fillMaxWidth().padding(vertical=8.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)){
                Column(Modifier.weight(1f)){
                    Text(item.name,style=MaterialTheme.typography.bodyLarge,maxLines=2,overflow=TextOverflow.Ellipsis)
                    Text(ui.text("{0} 张纹理 · {1} 个模型",item.textures,item.models),style=MaterialTheme.typography.bodySmall)
                    when(state.contents[item.id]){
                        ResourceContentState.MISSING,ResourceContentState.CHANGED->Text(ui.text("资源原件缺失或已变化，请重新导入。"),color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall)
                        else->Unit
                    }
                }
                NativeIconAction(ui.text("删除资源包"),"close",{deleting=item.id},enabled=available)
            }
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){
                val base=metadata?.baseId==item.id;val active=metadata?.activeId==item.id
                val present=state.contents[item.id]==ResourceContentState.PRESENT
                NativeAction(ui.text(if(base)"取消基础"else"设为基础"),{onSelect(if(base)null else item.id,true)},Modifier.weight(1f),
                    pending=state.operation=="select:base:${if(base)null else item.id}",enabled=available&&(base||present),primary=base,icon="map")
                NativeAction(ui.text(if(active)"使用中"else"使用"),{onSelect(item.id,false)},Modifier.weight(1f),
                    pending=state.operation=="select:active:${item.id}",enabled=available&&present,primary=active,icon="check")
            }
            }
        }
        state.error?.let{code->Text(ui.text(when(code){
            "RESOURCE_INPUT_TOO_LARGE","INPUT_TOO_LARGE"->"资源包超过当前格式的导入上限（普通 ZIP 32 MB，26.3 客户端 JAR 64 MB）。"
            "RESOURCE_NO_USABLE_ASSETS"->"未找到可用的方块材质或模型。"
            else->"无法读取或保存本机资源包，原件已保留。"
        }),color=MaterialTheme.colorScheme.error,modifier=Modifier.semantics{liveRegion=LiveRegionMode.Polite})
            NativeAction(ui.text("重试"),onRetry,primary=false,enabled=!state.busy,icon="reset",pending=state.operation=="retry")}
        state.worldError?.let{Text(ui.text("材质准备失败，可重试或选择原创。"),color=MaterialTheme.colorScheme.error,
            modifier=Modifier.semantics{liveRegion=LiveRegionMode.Polite});NativeAction(ui.text("重试"),onRetry,primary=false,enabled=!state.busy,icon="reset",pending=state.operation=="retry")}
    }
    NativeSheet(metadata?.items?.find{it.id==deleting},{ui.text("删除这个资源包？")},{deleting=null},!state.busy){item->
        Text(item.name);Text(ui.text("只删除本机保存的资源包，不影响任务与蓝图。"),style=MaterialTheme.typography.bodySmall)
        NativeAction(ui.text("删除资源包"),{deleting=null;onDelete(item.id)},Modifier.fillMaxWidth(),danger=true,enabled=available)
    }
}
