package com.blockcolc.preview.ui

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.blockcolc.presentation.ClockSelection
import com.blockcolc.world.NativeDebugWeather
import com.blockcolc.world.NativeWorldDebug
import java.time.Instant
import java.time.ZoneId
import kotlin.math.roundToInt

/** Transient controls share the application's disclosure and clock gesture.
 * No native selection dialog and no persistence/business command. */
@Composable fun NativeWorldDebugSettings(value:NativeWorldDebug,onChange:(NativeWorldDebug)->Unit,onPreviewCelebration:(Boolean)->Unit={}){
    val ui=LocalNativeUi.current
    NativeToggle(ui.text("画面调试"),value=value.enabled){onChange(value.copy(enabled=it))}
    NativeExpandedOptions(value.enabled){
        Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(NativeOptionSpacing)){
            var weatherOpen by remember{mutableStateOf(false)}
            NativeDisclosure(ui.text("天气"),null,weatherOpen,{weatherOpen=it},valueLabel=ui.text(value.weather.label)){
                for(choice in NativeDebugWeather.entries)NativeAction(ui.text(choice.label),{onChange(value.copy(weather=choice));weatherOpen=false},
                    Modifier.fillMaxWidth(),icon=if(value.weather==choice)"check"else"chevron",primary=false)
            }
            NativeSeparator()
            val minutes=value.timeMinutes
            NativeToggle(ui.text("指定时间"),ui.text(if(minutes==null)"正常时间"else"指定时间"),minutes!=null){onChange(value.copy(timeMinutes=if(it)720 else null))}
            if(minutes!=null){
                val reference=System.currentTimeMillis();val zone=ZoneId.systemDefault()
                val selected=ClockSelection.timeOfDay(minutes,reference,zone.id)
                NativeClockPicker(selected,reference,45,5,timeOfDay=true,onChange={time->onChange(value.copy(timeMinutes=time?.let{
                    val local=Instant.ofEpochMilli(it).atZone(zone);local.hour*60+local.minute}))})
            }
            NativeSeparator()
            val amount=value.decayAmount
            NativeToggle(ui.text("腐败"),if(amount==null)ui.text("正常腐败")else ui.text("指定程度")+" · ${(amount*100).roundToInt()}%",amount!=null){
                onChange(value.copy(decayAmount=if(it).5 else null))}
            if(amount!=null)NativePhysicalSlider(ui.text("世界调试腐败程度"),(amount*100).roundToInt(),onCommit={onChange(value.copy(decayAmount=it/100.0))})
            NativeSeparator()
            NativeAction(ui.text("播放落成彩纸"),{onPreviewCelebration(false)},primary=false)
            NativeAction(ui.text("播放目标彩纸"),{onPreviewCelebration(true)},primary=false)
        }
    }
}
