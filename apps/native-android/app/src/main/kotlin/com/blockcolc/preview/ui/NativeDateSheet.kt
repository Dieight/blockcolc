package com.blockcolc.preview.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.MonthDay

/** A date being edited. Without a year it repeats every year (birthdays). */
internal data class NativeDateDraft(val year:Int?,val month:Int,val day:Int){
    val date:LocalDate? get()=year?.let{LocalDate.of(it,month,day)}
}

/** Parses the three fields; null until they form a real date. */
internal fun nativeDateDraft(year:String?,month:String,day:String,withYear:Boolean):NativeDateDraft?{
    val m=month.toIntOrNull()?:return null
    val d=day.toIntOrNull()?:return null
    val y=if(withYear)(year?.takeIf{it.length==4}?.toIntOrNull()?.takeIf{it>0}?:return null)else null
    val valid=runCatching{if(y!=null)LocalDate.of(y,m,d)else MonthDay.of(m,d)}.isSuccess
    return if(valid)NativeDateDraft(y,m,d)else null
}

/** The one date editor behind every date row in Settings. A row opens it and
 * the date is saved here, once; nothing changes until Save. */
@Composable internal fun NativeDateSheet(model:NativeDateDraft?,title:String,onClose:()->Unit,pending:Boolean=false,
    caption:@Composable (NativeDateDraft)->String?={null},onSave:(NativeDateDraft)->Unit){
    val ui=LocalNativeUi.current
    NativeSheet(model,{title},onClose,dismissible=!pending){initial->
        var year by rememberSaveable(initial){mutableStateOf(initial.year?.toString())}
        var month by rememberSaveable(initial){mutableStateOf(initial.month.toString())}
        var day by rememberSaveable(initial){mutableStateOf(initial.day.toString())}
        val draft=nativeDateDraft(year,month,day,initial.year!=null)
        val editableYear=year
        if(editableYear!=null){NativeDateField(ui.text("年份"),editableYear,4,1..9999,!pending){year=it};NativeSeparator()}
        NativeDateField(ui.text("月份"),month,2,1..12,!pending){month=it}
        NativeSeparator()
        NativeDateField(ui.text("日期（日）"),day,2,1..31,!pending){day=it}
        val message=if(draft==null)ui.text("日期无效")else caption(draft)
        if(message!=null)Text(message,style=MaterialTheme.typography.bodySmall,
            color=if(draft==null)MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
        NativeAction(ui.text("保存"),{draft?.let(onSave)},Modifier.fillMaxWidth(),pending=pending,enabled=draft!=null)
    }
}

/** Typed digits for quick entry, with steps for small changes. The field
 * updates the draft directly, so Save always reads what is shown. */
@Composable private fun NativeDateField(label:String,value:String,digits:Int,range:IntRange,enabled:Boolean,onChange:(String)->Unit){
    val ui=LocalNativeUi.current;val number=value.toIntOrNull()
    Row(Modifier.fillMaxWidth().heightIn(min=NativeSettingsRowHeight),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(4.dp)){
        Text(label,Modifier.weight(1f),style=MaterialTheme.typography.bodyLarge)
        NativeIconAction(ui.text("减少"),"minus",{onChange(((number?:range.first+1)-1).coerceIn(range).toString())},enabled=enabled&&(number==null||number>range.first))
        BasicTextField(value,{next->if(next.length<=digits&&next.all{it in '0'..'9'})onChange(next)},
            Modifier.width(72.dp).heightIn(min=44.dp).background(MaterialTheme.colorScheme.surfaceVariant).padding(horizontal=8.dp,vertical=10.dp).semantics{contentDescription=label},
            enabled=enabled,singleLine=true,
            textStyle=MaterialTheme.typography.bodyLarge.copy(color=MaterialTheme.colorScheme.onSurface,textAlign=TextAlign.Center),
            keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number,imeAction=ImeAction.Done))
        NativeIconAction(ui.text("增加"),"plus",{onChange(((number?:range.first-1)+1).coerceIn(range).toString())},enabled=enabled&&(number==null||number<range.last))
    }
}
