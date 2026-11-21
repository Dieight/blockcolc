package com.blockcolc.preview.ui

import android.content.Context
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.LocalDate
import java.time.temporal.ChronoUnit

internal data class DateCountdown(val title:String,val date:LocalDate)
internal val LocalDateCountdownPreference=staticCompositionLocalOf<CountdownPreference?>{null}

internal class CountdownPreference(context:Context) {
    private val storage=context.getSharedPreferences("date-countdown",Context.MODE_PRIVATE)
    var value by mutableStateOf(read())
        private set

    private fun read():DateCountdown? {
        val date=storage.getString("date",null)?.let{runCatching{LocalDate.parse(it)}.getOrNull()}?:return null
        return DateCountdown(storage.getString("title","").orEmpty(),date)
    }

    fun save(countdown:DateCountdown?){
        val edit=storage.edit()
        if(countdown==null)edit.remove("date").remove("title")
        else edit.putString("date",countdown.date.toString()).putString("title",countdown.title)
        edit.apply()
        value=countdown
    }
}

@Composable internal fun rememberCountdownPreference():CountdownPreference {
    val context=LocalContext.current.applicationContext
    return remember(context){CountdownPreference(context)}
}

@Composable internal fun NativeCountdownSettings(preference:CountdownPreference){
    val ui=LocalNativeUi.current
    val current=preference.value
    var title by rememberSaveable(current, stateSaver=TextFieldValue.Saver){mutableStateOf(TextFieldValue(current?.title.orEmpty()))}
    var date by rememberSaveable(current){mutableStateOf(current?.date?.toString())}
    var picking by rememberSaveable{mutableStateOf(false)}
    var editing by rememberSaveable(current){mutableStateOf(current==null)}
    val today = LocalDate.now()
    NativeSettingGroup("日期倒计时",current?.let{countdownDays(it.date,today)}){
        if(current!=null&&!editing){
            NativeCountdownLine(current,today,Modifier.fillMaxWidth().padding(vertical=8.dp))
            NativeSeparator()
            NativeInlineAction(ui.text("目标日期"),{editing=true},"edit",current.date.toString())
            NativeSeparator()
            NativeInlineAction(ui.text("移除倒计时"),{preference.save(null)},"close")
        }else{
            OutlinedTextField(title,{if(it.text.length<=48)title=it},Modifier.fillMaxWidth(),
                label={Text(ui.text("事件名称"))},singleLine=true,shape=androidx.compose.ui.graphics.RectangleShape)
            NativeSettingLink(ui.text("目标日期"),{picking=true},description=date)
            NativeInlineAction(ui.text("保存"),{
                preference.save(DateCountdown(title.text.trim(),LocalDate.parse(checkNotNull(date))))
                editing=false
            },"check",enabled=date!=null&&title.composition==null)
        }
    }
    NativeSheet(date?.let(LocalDate::parse).orToday().takeIf{picking},{ui.text("目标日期")},{picking=false}){initial->
        CountdownDateFields(initial){value->date=value.toString();picking=false}
    }
}

private fun LocalDate?.orToday()=this?:LocalDate.now()

@Composable private fun CountdownDateFields(initial:LocalDate,onConfirm:(LocalDate)->Unit){
    val ui=LocalNativeUi.current
    var year by rememberSaveable(initial){mutableStateOf(initial.year.toString())}
    var month by rememberSaveable(initial){mutableStateOf(initial.monthValue.toString())}
    var day by rememberSaveable(initial){mutableStateOf(initial.dayOfMonth.toString())}
    val value=remember(year,month,day){
        runCatching{LocalDate.of(year.toInt(),month.toInt(),day.toInt())}
            .getOrNull()?.takeIf{year.length==4&&it.year>0}
    }
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){
        CountdownDateField(ui.text("年份"),year,4,Modifier.weight(1.25f)){year=it}
        CountdownDateField(ui.text("月份"),month,2,Modifier.weight(1f)){month=it}
        CountdownDateField(ui.text("日期（日）"),day,2,Modifier.weight(1f)){day=it}
    }
    NativeAction(ui.text("确定"),{value?.let(onConfirm)},Modifier.fillMaxWidth(),enabled=value!=null,icon="check")
}

@Composable private fun CountdownDateField(label:String,value:String,limit:Int,modifier:Modifier,onChange:(String)->Unit){
    OutlinedTextField(value,{new->if(new.length<=limit&&new.all{it in '0'..'9'})onChange(new)},modifier,
        label={Text(label)},singleLine=true,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number),
        shape=androidx.compose.ui.graphics.RectangleShape)
}

@Composable internal fun NativeDateCountdown(countdown:DateCountdown?,now:Long,modifier:Modifier=Modifier){
    if(countdown==null)return
    val today=Instant.ofEpochMilli(now).atZone(java.time.ZoneId.systemDefault()).toLocalDate()
    NativeCountdownLine(countdown,today,modifier.widthIn(max=320.dp).padding(horizontal=8.dp))
}

@Composable private fun countdownDays(date:LocalDate,today:LocalDate):String{
    val ui=LocalNativeUi.current
    val remaining=ChronoUnit.DAYS.between(today,date)
    return when{
        remaining>0->ui.text("还有 {0} 天",remaining)
        remaining==0L->ui.text("就是今天")
        else->ui.text("已过 {0} 天",-remaining)
    }
}

@Composable private fun NativeCountdownLine(countdown:DateCountdown,today:LocalDate,modifier:Modifier){
    val ui=LocalNativeUi.current
    Row(modifier,verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(6.dp)){
        PixelGlyph("clock",Modifier.size(16.dp))
        Text(countdown.title.ifBlank{ui.text("日期倒计时")},Modifier.weight(1f,fill=false),
            style=MaterialTheme.typography.bodyMedium,maxLines=1,overflow=TextOverflow.Ellipsis)
        Text(countdownDays(countdown.date,today),style=MaterialTheme.typography.labelLarge,maxLines=1)
    }
}
