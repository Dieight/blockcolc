package com.blockcolc.preview.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import com.blockcolc.presentation.*
import com.blockcolc.preview.*
import com.blockcolc.preview.blueprints.*
import com.blockcolc.world.importing.NativeLitematicLimits

private val blueprintGroups=listOf("native" to "原生图纸","supplemental" to "补充图纸","user" to "自添加图纸","daily" to "每日奖励","holiday" to "节日奖励","birthday" to "生日礼物")

@Composable fun NativeBlueprintSettings(s:WorkspaceUiState,runtime:WorkspaceActions,importer:NativeBlueprintImport,onImport:()->Unit){
    val ui=LocalNativeUi.current;val library=s.blueprints
    var state by remember(importer){mutableStateOf(importer.snapshot())}
    DisposableEffect(importer){val unsubscribe=importer.subscribe{state=it};onDispose{unsubscribe()}}
    var preview by remember{mutableStateOf<NativeBlueprintItem?>(null)}
    var deleting by rememberNativePageState<String?>("blueprints/deleting"){null}
    var renaming by rememberNativePageState<String?>("blueprints/renaming"){null}
    var renameValue by rememberNativePageState("blueprints/rename",stateSaver=TextFieldValue.Saver){TextFieldValue()}
    var decoration by rememberNativePageState("blueprints/decorations"){false}
    val request=rememberNativeRequest(s){deleting=null;renaming=null;importer.clear()}
    val available=!s.busy&&!request.busy&&!state.busy
    LaunchedEffect(state.candidate){if(state.candidate!=null)decoration=false}
    NativeSettingGroup("蓝图库","${library.buildingCount} / ${NativeBlueprintLibrary.MAX_BUILDINGS}",trailing={
        val limits=remember{NativeLitematicLimits()}
        NativeInfoAction(ui.text("导入 .litematic"),ui.text(
            "支持 Java 版 .litematic，文件最多 {0} MiB，范围最多 {1} × {2} × {1} 方块。",
            limits.compressedBytes / (1024 * 1024),limits.horizontal,limits.vertical,
        ))
        NativeIconAction(ui.text("导入 .litematic"),"plus",onImport,pending=state.busy,enabled=available)
    }){
        for((index,group)in blueprintGroups.withIndex()){
            val (category,label)=group
            if(index>0)NativeSeparator()
            val entries=library.items.filter{it.category==category}
            var expanded by rememberNativePageState("blueprints/library/$category"){false}
            NativeDisclosure(ui.text(label),expanded=expanded,onExpandedChange={expanded=it},valueLabel=entries.size.toString(),contentSpacing=0.dp){
                if(entries.isEmpty())Text(ui.text("暂无图纸"),style=MaterialTheme.typography.bodySmall)
                entries.forEachIndexed{i,item->key(item.id){
                    if(i>0)NativeSeparator()
                    Row(Modifier.fillMaxWidth().testTag("blueprint-library-${item.id}"),verticalAlignment=Alignment.CenterVertically){
                        val interaction=remember{MutableInteractionSource()}
                        Row(Modifier.weight(1f).heightIn(min=NativeSettingsRowHeight).clickable(enabled=available,
                            interactionSource=interaction,indication=null){preview=item}.nativePressMotion(interaction,available),
                            verticalAlignment=Alignment.CenterVertically){
                            if(item.locked)Text("?",Modifier.width(36.dp),style=MaterialTheme.typography.titleLarge)
                            else PixelGlyph("cube",Modifier.size(24.dp).padding(end=4.dp))
                            Column(Modifier.weight(1f)){
                                Text(if(item.localized)ui.text(item.displayName)else item.displayName,style=MaterialTheme.typography.bodyLarge)
                                Text(ui.text(if(item.locked)"待发现"else item.description),style=MaterialTheme.typography.bodySmall)
                            }
                        }
                        if(category=="user"){
                            NativeIconAction(ui.text("重命名"),"edit",{renaming=item.id;renameValue=TextFieldValue(item.displayName)},enabled=available)
                            NativeIconAction(ui.text("删除蓝图"),"close",{deleting=item.id},enabled=available)
                        }
                    }
                }}
            }
        }
    }
    // Failure remains visible even when its catalogue row is collapsed.
    state.error?.let{code->Text(ui.text(when(code){
        "INPUT_TOO_LARGE"->"蓝图文件超过 64 MB 上限。"
        "NBT_TOO_LARGE","LIMIT_EXCEEDED"->"蓝图超过解析、尺寸或方块数量上限。"
        "UNSUPPORTED_BLOCK_ENTITY_DATA"->"蓝图含有尚不支持的动态告示牌或物品模型数据。"
        else->"无法读取蓝图，请选择有效的 .litematic 文件。"
    }),color=MaterialTheme.colorScheme.error,modifier=Modifier.semantics{liveRegion=LiveRegionMode.Polite})}
    NativeSheet(preview,{item->if(item.localized)ui.text(item.displayName)else item.displayName},{preview=null},blurBackground=false){item->
        if(item.locked)NativeBlueprintMystery()else NativeBlueprintPreview(item)
        Text(ui.text(item.description),style=MaterialTheme.typography.bodySmall)
    }
    val importSheet=state.takeIf{it.busy||it.candidate!=null}
    NativeSheet(importSheet,{it.candidate?.preview?.name?:ui.text("正在读取蓝图")},{if(!request.busy)importer.clear()},!request.busy,blurBackground=false){view->
        if(view.busy){NativeBusy();Text(ui.text("正在读取蓝图"));NativeAction(ui.text("取消"),importer::clear,primary=false)}
        view.candidate?.let{candidate->
            val metadata=candidate.preview
            NativeBlueprintPreview(remember(candidate){NativeBlueprintItem(candidate.id,metadata.name,metadata.description,"user",canonical=candidate.canonical,voxelCount=metadata.nonAirBlocks)})
            if(metadata.author.isNotEmpty())Text(ui.text("作者：{0}",metadata.author),style=MaterialTheme.typography.bodySmall)
            if(metadata.description.isNotEmpty())Text(metadata.description,style=MaterialTheme.typography.bodySmall)
            Text("${metadata.dimensions.joinToString(" × ")} · ${ui.text("{0} 个方块",metadata.nonAirBlocks)}",style=MaterialTheme.typography.bodySmall)
            val placeholder=metadata.compatibility["placeholderVoxelCount"] as Int
            if(placeholder>0)Text(ui.text("其中 {0} 个方块使用占位材质。",placeholder),style=MaterialTheme.typography.bodySmall)
            NativeSegments(listOf(false to ui.text("大型任务建筑"),true to ui.text("每日奖励装饰")),decoration,{decoration=it},!request.busy)
            val fits=candidate.decorationEligible
            val duplicate=library.items.any{it.category=="user"&&it.id==candidate.id}
            val full=library.buildingCount>=NativeBlueprintLibrary.MAX_BUILDINGS&&!duplicate
            if(decoration&&!fits)Text(ui.text("奖励装饰上限 12 × 12 × 16、2,000 个方块。"),color=MaterialTheme.colorScheme.error)
            if(!decoration&&full)Text(ui.text("最多保存 {0} 份，请先删除一份。",NativeBlueprintLibrary.MAX_BUILDINGS),color=MaterialTheme.colorScheme.error)
            NativeRequestError(request)
            NativeAction(ui.text(if(decoration)"加入每日奖励装饰池"else"保存到建筑蓝图库"),{
                request.submit{runtime.dispatch(WorkspaceMutation.ImportBlueprint(candidate.canonical,decoration),it)}
            },Modifier.fillMaxWidth(),pending=request.busy,enabled=!s.busy&&(if(decoration)fits else !full))
        }
    }
    NativeSheet(renaming,{ui.text("蓝图名称")},{renaming=null},!request.busy){id->
        NativeTextEntry(ui.text("蓝图名称"),renameValue,{if(it.text.length<=80)renameValue=it},!request.busy)
        NativeRequestError(request)
        NativeAction(ui.text("保存蓝图名称"),{if(renameValue.composition==null)request.submit{runtime.dispatch(WorkspaceMutation.RenameBlueprint(id,renameValue.text),it)}},
            Modifier.fillMaxWidth(),pending=request.busy,enabled=renameValue.text.isNotBlank()&&!s.busy)
    }
    NativeSheet(deleting,{ui.text("从蓝图库删除？")},{deleting=null},!request.busy){id->
        Text(ui.text("不会改变使用这份蓝图创建的已有大型任务。"),style=MaterialTheme.typography.bodySmall)
        NativeRequestError(request)
        NativeAction(ui.text("删除蓝图"),{request.submit{runtime.dispatch(WorkspaceMutation.DeleteBlueprint(id),it)}},Modifier.fillMaxWidth(),pending=request.busy,enabled=!s.busy,danger=true)
    }
}

@Composable private fun NativeBlueprintMystery(){
    val color=MaterialTheme.colorScheme.primary;val ui=LocalNativeUi.current
    val pixels=listOf("001111100","011111110","110000011","110000011","000000110","000011100","000110000","000110000","000000000","000000000","000110000","000110000")
    Canvas(Modifier.fillMaxWidth().height(240.dp).semantics{contentDescription=ui.text("尚未发现的节日建筑")}){
        val side=minOf(size.width/15,size.height/16);val x=(size.width-side*9)/2;val y=(size.height-side*12)/2
        pixels.forEachIndexed{row,line->line.forEachIndexed{column,c->if(c=='1')drawRect(color,Offset(x+column*side,y+row*side),Size(side,side))}}
    }
}

@Composable fun NativeBlueprintPicker(library:NativeBlueprintLibrary,selected:String,enabled:Boolean,onSelect:(String)->Unit){
    val ui=LocalNativeUi.current;val entry=library.items.firstOrNull{it.id==selected&&it.selectable}
            if(entry!=null){NativeBlueprintPreview(entry);Text(ui.text(entry.description),style=MaterialTheme.typography.bodySmall)}
    else Text(ui.text("请选择可用的建筑蓝图。"),color=MaterialTheme.colorScheme.error)
    Column{
        for((index,group)in blueprintGroups.take(3).withIndex()){
            val (category,label)=group
            if(index>0)NativeSeparator()
            val items=library.items.filter{it.category==category&&it.selectable}
            var expanded by rememberSaveable(category){mutableStateOf(category=="native")}
            NativeDisclosure(ui.text(label),expanded=expanded,onExpandedChange={expanded=it},valueLabel=items.size.toString(),contentSpacing=0.dp){
                for((itemIndex,item)in items.withIndex()){
                    if(itemIndex>0)NativeSeparator()
                    val complexity=ui.text(when(item.complexity){"simple"->"紧凑";"moderate"->"适中";else->"丰富"})
                    val description="${item.width} × ${item.depth} ${ui.text("方块 ·")} $complexity"
                    NativeChoice(if(item.localized)ui.text(item.displayName)else item.displayName,item.id==selected,enabled,"cube",description){onSelect(item.id)}
                }
            }
        }
    }
    Text(ui.text("蓝图在创建后不可更换，请确认完整预览。"),style=MaterialTheme.typography.bodySmall)
}
