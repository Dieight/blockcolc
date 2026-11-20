package com.blockcolc.preview.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.Icon
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.painterResource
import com.blockcolc.audio.*
import com.blockcolc.presentation.*

@Composable fun NativeAudioSettings(preferences:ClientPreferences,saving:Boolean,library:AudioLibraryState,playback:AudioPlayback,
    update:((ClientPreferences)->ClientPreferences)->Unit,onImport:()->Unit,onDelete:(String)->Unit,onPlay:()->Unit,onPause:()->Unit,onRetry:()->Unit,onRefresh:()->Unit,preferenceError:String?=null){
    val ui=LocalNativeUi.current;val current=preferences.ambience;val available=!library.busy
    var deleting by rememberSaveable{mutableStateOf<String?>(null)}
    fun change(transform:(Ambience)->Ambience)=update{it.copy(ambience=transform(it.ambience))}
    NativeSettingGroup("白噪音"){
        NativeToggle(ui.text("自然白噪音"),value=current.enabled,enabled=available,trailing={
            NativeInfoAction(ui.text("自然白噪音"),ui.text("最多 8 份 · 单份 64 MiB · 主音轨仅播放一份"))
        }){value->change{it.copy(enabled=value)}}
        AnimatedVisibility(current.enabled,enter=expandVertically(tween(if(ui.reduceMotion)0 else 200)),exit=shrinkVertically(tween(if(ui.reduceMotion)0 else 180))){
            Column{
                val choices=listOf("forest-birds" to ui.text("清晨林中鸟鸣"),"shore-waves" to ui.text("贴岸小浪"))+library.items.map{it.id to it.name}
                for((id,title)in choices){
                    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                        Row(Modifier.weight(1f).heightIn(min=48.dp).clickable(enabled=available,interactionSource=remember(id){MutableInteractionSource()},indication=null){change{it.copy(primary=id)}}
                            .semantics{selected=current.primary==id;role=Role.RadioButton;contentDescription=title}.padding(vertical=12.dp),
                            horizontalArrangement=Arrangement.spacedBy(12.dp),verticalAlignment=Alignment.CenterVertically){
                            PixelGlyph(if(current.primary==id)"check"else"note",color=if(current.primary==id)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
                            Text(title,style=MaterialTheme.typography.bodyLarge,modifier=Modifier.weight(1f))
                        }
                        library.items.find{it.id==id}?.let{item->NativeIconAction(ui.text("删除音频：{0}",title),"close",{deleting=item.id},enabled=available)}
                    }
                }
                NativeSeparator()
                NativeInlineAction(ui.text("导入音频"),onImport,"plus",ui.text("选择文件"),
                    pending=library.busy,enabled=available&&library.items.size<8)
            }
        }
        NativeSeparator()
        NativeToggle(ui.text("随天气播放雨声"),ui.text("下雨时自动叠加，放晴停止"),current.rainEnabled,available){value->change{it.copy(rainEnabled=value)}}
        val controlsVisible=current.enabled||current.rainEnabled
        var heldTransport by remember{mutableStateOf(current.enabled||playback.active)}
        if(controlsVisible)heldTransport=current.enabled||playback.active
        AnimatedVisibility(controlsVisible,enter=expandVertically(tween(if(ui.reduceMotion)0 else 200)),exit=shrinkVertically(tween(if(ui.reduceMotion)0 else 180))){
            Column{
                NativeSeparator()
                NativeSettingSlider("白噪音音量",current.volume,0,100,available,saving=saving,error=preferenceError){value->change{it.copy(volume=value)}}
                if(heldTransport)NativeAction(ui.text(if(playback.allowed)"暂停"else"播放"),if(playback.allowed)onPause else onPlay,
                    Modifier.fillMaxWidth(),primary=false,enabled=available,leading={
                        if(playback.allowed)Icon(painterResource(com.blockcolc.audio.R.drawable.ic_ambient_pause),null,Modifier.size(24.dp))else PixelGlyph("play")})
            }
        }
        library.error?.let{Text(ui.text(when(it){"AUDIO_LIBRARY_FULL"->"最多可导入 8 份音频";"AUDIO_TOO_LARGE"->"音频不能超过 64 MiB";"AUDIO_INVALID_MEDIA"->"请选择 3 小时以内的有效音频";else->"无法读取或保存本机音频，原文件已保留。"}),color=MaterialTheme.colorScheme.error,modifier=Modifier.semantics{liveRegion=LiveRegionMode.Polite})
            NativeAction(ui.text("重试"),onRefresh,primary=false,icon="reset")}
        playback.error?.let{Text(ui.text("音频暂未播放，请重试"),color=MaterialTheme.colorScheme.error);NativeAction(ui.text("重试"),onRetry,primary=false,icon="reset")}
    }
    NativeSheet(library.items.find{it.id==deleting},{ui.text("删除音频")},{deleting=null},!library.busy){item->
        Text(item.name);Text(ui.text("删除后需重新导入；当前选中的录音会关闭。"),style=MaterialTheme.typography.bodySmall)
        NativeAction(ui.text("删除"),{deleting=null;onDelete(item.id)},Modifier.fillMaxWidth(),danger=true,enabled=available)
    }
}
