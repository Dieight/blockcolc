package com.blockcolc.preview.ui

import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
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
    var editing by rememberSaveable(current){mutableStateOf(current==null)}
    var sheet by remember{mutableStateOf<NativeDateDraft?>(null)}
    val today = LocalDate.now()
    fun draftOf(date:LocalDate)=NativeDateDraft(date.year,date.monthValue,date.dayOfMonth)
    fun shown(date:LocalDate)="%d / %02d / %02d".format(date.year,date.monthValue,date.dayOfMonth)
    NativeSettingGroup("日期倒计时",current?.let{countdownDays(it.date,today)}){
        if(current!=null&&!editing){
            NativeCountdownLine(current,today,Modifier.fillMaxWidth().padding(vertical=8.dp))
            NativeSeparator()
            NativeInlineAction(ui.text("目标日期"),{editing=true},"edit",shown(current.date))
            NativeSeparator()
            NativeInlineAction(ui.text("移除倒计时"),{preference.save(null)},"close")
        }else{
            // The date sheet saves name and date together; Done saves a
            // renamed countdown without reopening its date.
            NativeCountdownTitle(ui.text("事件名称"),title,{if(it.text.length<=48)title=it}){
                if(current!=null){preference.save(current.copy(title=title.text.trim()));editing=false}
            }
            NativeSettingLink(ui.text("目标日期"),{sheet=draftOf(current?.date?:today)},value=current?.date?.let(::shown)?:ui.text("未设置"))
        }
    }
    NativeDateSheet(sheet,ui.text("目标日期"),{sheet=null},caption={draft->draft.date?.let{countdownDays(it,today)}}){draft->
        preference.save(DateCountdown(title.text.trim(),checkNotNull(draft.date)))
        sheet=null;editing=false
    }
}

/** The app's square text input (as in notes and task names), not a Material
 * floating-label field. */
@Composable private fun NativeCountdownTitle(label:String,value:TextFieldValue,onChange:(TextFieldValue)->Unit,onDone:()->Unit){
    val colors=MaterialTheme.colorScheme
    BasicTextField(value,onChange,singleLine=true,textStyle=MaterialTheme.typography.bodyLarge.copy(color=colors.onSurface),cursorBrush=SolidColor(colors.primary),
        keyboardOptions=KeyboardOptions(imeAction=ImeAction.Done),keyboardActions=KeyboardActions(onDone={if(value.composition==null)onDone()}),
        modifier=Modifier.fillMaxWidth().padding(vertical=8.dp).heightIn(min=44.dp).border(1.dp,colors.outline).background(colors.surface)
            .padding(horizontal=12.dp,vertical=10.dp).semantics{contentDescription=label},
        decorationBox={field->Box(contentAlignment=Alignment.CenterStart){
            if(value.text.isEmpty())Text(label,style=MaterialTheme.typography.bodyLarge,color=colors.onSurfaceVariant)
            field()
        }})
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
    val interaction=remember{MutableInteractionSource()}
    var motion by remember{mutableIntStateOf(0)}
    Row(modifier.heightIn(min=44.dp).clickable(role=Role.Button,interactionSource=interaction,indication=null,
        onClickLabel=ui.text("播放倒计时图标动画")){motion++}.nativePressMotion(interaction),
        verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(6.dp)){
        NativeMotionGlyph("countdown",motion,Modifier.size(16.dp))
        Text(countdown.title.ifBlank{ui.text("日期倒计时")},Modifier.weight(1f,fill=false),
            style=MaterialTheme.typography.bodyMedium,maxLines=1,overflow=TextOverflow.Ellipsis)
        Text(countdownDays(countdown.date,today),style=MaterialTheme.typography.labelLarge,maxLines=1)
    }
}
