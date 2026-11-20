package com.blockcolc.preview.ui

import android.content.Context
import android.content.res.Configuration
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit
import java.util.Locale

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

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun NativeCountdownSettings(preference:CountdownPreference){
    val ui=LocalNativeUi.current
    val current=preference.value
    var title by rememberSaveable(current, stateSaver=TextFieldValue.Saver){mutableStateOf(TextFieldValue(current?.title.orEmpty()))}
    var date by rememberSaveable(current){mutableStateOf(current?.date?.toString())}
    var picking by rememberSaveable{mutableStateOf(false)}
    NativeSettingGroup("日期倒计时",current?.date?.toString()){
        OutlinedTextField(title,{if(it.text.length<=48)title=it},Modifier.fillMaxWidth(),
            label={Text(ui.text("事件名称"))},singleLine=true,shape=androidx.compose.ui.graphics.RectangleShape)
        NativeSettingLink(ui.text("目标日期"),{picking=true},description=date)
        Row(Modifier.fillMaxWidth().padding(bottom=8.dp),horizontalArrangement=Arrangement.spacedBy(8.dp,Alignment.End)){
            if(current!=null)NativeIconAction(ui.text("移除倒计时"),"close",{preference.save(null)})
            NativeAction(ui.text("保存"),{
                preference.save(DateCountdown(title.text.trim(),LocalDate.parse(checkNotNull(date))))
            },enabled=date!=null&&title.composition==null,primary=false)
        }
        if(picking){
            val initial=date?.let(LocalDate::parse)
            val context=LocalContext.current
            val systemConfiguration=LocalConfiguration.current
            val configuration=remember(systemConfiguration,ui.language){
                Configuration(systemConfiguration).apply{setLocale(Locale.forLanguageTag(ui.language))}
            }
            val localizedContext=remember(context,configuration){context.createConfigurationContext(configuration)}
            CompositionLocalProvider(LocalConfiguration provides configuration,LocalContext provides localizedContext){
                val picker=rememberDatePickerState(
                    initialSelectedDateMillis=initial?.atStartOfDay(ZoneOffset.UTC)?.toInstant()?.toEpochMilli(),
                    initialDisplayedMonthMillis=(initial?:LocalDate.now()).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
                )
                DatePickerDialog(onDismissRequest={picking=false},confirmButton={
                    TextButton(enabled=picker.selectedDateMillis!=null,onClick={
                        picker.selectedDateMillis?.let{date=Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString()}
                        picking=false
                    }){Text(ui.text("确定"))}
                },dismissButton={TextButton(onClick={picking=false}){Text(ui.text("取消"))}}){
                    // The dialog has its own Android view configuration.
                    CompositionLocalProvider(LocalConfiguration provides configuration,LocalContext provides localizedContext){
                        DatePicker(picker,title=null,headline=null,showModeToggle=false)
                    }
                }
            }
        }
    }
}

@Composable internal fun NativeDateCountdown(countdown:DateCountdown?,now:Long,modifier:Modifier=Modifier){
    if(countdown==null)return
    val ui=LocalNativeUi.current
    val today=Instant.ofEpochMilli(now).atZone(java.time.ZoneId.systemDefault()).toLocalDate()
    val remaining=ChronoUnit.DAYS.between(today,countdown.date)
    val days=when{
        remaining>0->ui.text("还有 {0} 天",remaining)
        remaining==0L->ui.text("就是今天")
        else->ui.text("已过 {0} 天",-remaining)
    }
    val title=countdown.title.ifBlank{ui.text("日期倒计时")}
    Text("$title · $days",modifier,style=MaterialTheme.typography.bodyMedium,maxLines=1,overflow=TextOverflow.Ellipsis)
}
