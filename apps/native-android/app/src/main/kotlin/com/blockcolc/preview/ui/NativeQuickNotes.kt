package com.blockcolc.preview.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.*
import androidx.compose.ui.platform.testTag
import com.blockcolc.presentation.HolidayEmblems
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.*
import com.blockcolc.presentation.WorkspaceActions
import com.blockcolc.presentation.WorkspaceMutation
import com.blockcolc.preview.*
import java.util.UUID

/** The released QuickNotes row, inline editor and one-line entry. Both pages
 * share the same saved facts; only the list's available height is different. */
@Composable fun NativeQuickNotes(s:WorkspaceUiState,runtime:WorkspaceActions,compact:Boolean=false){
    val ui=LocalNativeUi.current;val ink=LocalContentColor.current;val colors=MaterialTheme.colorScheme
    var input by rememberNativePageState("notes/new",stateSaver=TextFieldValue.Saver){TextFieldValue()}
    var validation by remember{mutableStateOf<String?>(null)}
    val create=rememberNativeRequest(s){input=TextFieldValue()}
    val held=remember{mutableStateMapOf<String,NoteRow>()}
    val active=s.notes.filter{!it.completed||it.id in held}.map{held[it.id]?:it}+
        held.values.filter{note->s.notes.none{it.id==note.id}}
    val done=s.notes.filter{it.completed&&it.id !in held}
    val decorations=if(compact)s.workspace?.let{HolidayEmblems.at(it.today,0,it.settings.birthday).size}?:0 else 0
    var expanded by rememberNativePageState("notes/completed"){false}
    fun add(){
        if(input.composition!=null||input.text.isBlank()||s.notes.size>=100)return
        if(input.text.trim().length>200){validation="便签最多 200 字。";return}
        validation=null;create.submit{runtime.dispatch(WorkspaceMutation.AddNote(UUID.randomUUID().toString(),input.text),it)}
    }
    Column(Modifier.fillMaxWidth().then(if(compact)Modifier.fillMaxHeight()else Modifier),verticalArrangement=Arrangement.spacedBy(if(compact)4.dp else 8.dp)){
        Row(Modifier.fillMaxWidth().padding(bottom=if(compact)4.dp else 8.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
            if(compact)NativeMinimalPanelLabel(ui.text("简易便签"),"note",Modifier.weight(1f))
            else{
                PixelGlyph("note",Modifier.size(20.dp),ink)
                NativeText(ui.text("简易便签"),NativeTextRole.SECTION,Modifier.weight(1f))
            }
            NativeText(active.size.toString(),NativeTextRole.CAPTION,Modifier.testTag("quick-note-count"))
            if(decorations>0)Spacer(Modifier.width((decorations*44).dp))
        }
        Column(Modifier.fillMaxWidth().then(if(compact)Modifier.weight(1f)else Modifier.heightIn(max=320.dp)).verticalScroll(rememberScrollState())){
            for(note in active)key(note.id){NativeNoteRow(note,false,s,runtime,{held[note.id]=note},{held.remove(note.id)})}
            if(done.isNotEmpty())NativeDisclosure(ui.text("已完成便签")+" "+done.size,expanded=expanded,onExpandedChange={expanded=it},rowHeight=44.dp,rowPadding=0.dp,
                titleStyle=MaterialTheme.typography.bodySmall,indicatorSize=16.dp,contentSpacing=0.dp){
                for(note in done)key(note.id){NativeNoteRow(note,true,s,runtime,{},{})}
            }
        }
        Row(Modifier.fillMaxWidth().padding(top=6.dp).then(if(compact)Modifier else Modifier.background(colors.surfaceVariant.copy(alpha=.3f))).drawBehind{
            if(compact)drawLine(ink.copy(alpha=.22f),Offset.Zero,Offset(size.width,0f),1.dp.toPx())
            else drawRect(colors.outlineVariant,style=Stroke(1.dp.toPx(),pathEffect=PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(),4.dp.toPx()))))
        }.padding(horizontal=if(compact)0.dp else 6.dp,vertical=2.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(6.dp)){
            NativeNoteInput(ui.text("写一条便签"),input,{input=it;validation=null},Modifier.weight(1f),enabled=!create.busy&&s.notes.size<100,placeholder=ui.text("写一条便签"),compact=compact,onDone=::add)
            NativeNoteAction(ui.text("添加便签"),"plus",::add,enabled=input.text.isNotBlank()&&!create.busy&&s.notes.size<100,pending=create.busy)
        }
        validation?.let{NativeText(ui.text(it),NativeTextRole.CAPTION,color=colors.error)}
        NativeRequestError(create)
    }
}

@Composable private fun NativeNoteInput(label:String,value:TextFieldValue,onChange:(TextFieldValue)->Unit,modifier:Modifier=Modifier,enabled:Boolean=true,placeholder:String?=null,compact:Boolean=false,onDone:()->Unit){
    val ink=LocalContentColor.current
    BasicTextField(value,onChange,enabled=enabled,singleLine=true,textStyle=MaterialTheme.typography.bodyLarge.copy(color=ink),cursorBrush=SolidColor(ink),
        keyboardOptions=KeyboardOptions(imeAction=ImeAction.Done),keyboardActions=KeyboardActions(onDone={if(value.composition==null)onDone()}),
        modifier=modifier.heightIn(min=44.dp).padding(horizontal=4.dp,vertical=8.dp).semantics{contentDescription=label},
        decorationBox={entry->Box{if(value.text.isEmpty()&&placeholder!=null)NativeText(placeholder,NativeTextRole.BODY,color=if(compact)ink.copy(alpha=.55f)else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha=.7f));entry()}})
}

@Composable private fun NativeNoteAction(title:String,icon:String,onClick:()->Unit,enabled:Boolean=true,pending:Boolean=false){
    NativeIconAction(title,icon,onClick,enabled=enabled,pending=pending)
}

@Composable private fun NativeNoteRow(note:NoteRow,completedView:Boolean,s:WorkspaceUiState,runtime:WorkspaceActions,onCompleting:()->Unit,onAnimationEnd:()->Unit){
    val ui=LocalNativeUi.current;val ink=LocalContentColor.current
    var editing by rememberNativePageState("notes/${note.id}/editing"){false}
    var input by rememberNativePageState("notes/${note.id}/input",stateSaver=TextFieldValue.Saver){TextFieldValue(note.text)}
    var completing by rememberSaveable(note.id){mutableStateOf(false)}
    var animateStrike by remember{mutableStateOf(false)};val strike=remember(note.id){Animatable(if(completedView)1f else 0f)}
    val request=rememberNativeRequest(s){if(completing)animateStrike=true else editing=false}
    LaunchedEffect(animateStrike){if(animateStrike){strike.animateTo(1f,tween(if(ui.reduceMotion)0 else 180));completing=false;onAnimationEnd()}}
    LaunchedEffect(request.error){if(request.error!=null&&completing){completing=false;onAnimationEnd()}}
    LaunchedEffect(note.text,editing){if(!editing)input=TextFieldValue(note.text)}
    fun save(){if(input.composition==null&&input.text.isNotBlank()&&input.text.trim().length<=200)request.submit{runtime.dispatch(WorkspaceMutation.RenameNote(note.id,input.text),it)}}
    Row(Modifier.fillMaxWidth().heightIn(min=44.dp).drawBehind{drawLine(ink.copy(alpha=.18f),Offset(0f,size.height),Offset(size.width,size.height),1.dp.toPx())},verticalAlignment=Alignment.CenterVertically){
        if(editing){
            NativeNoteInput(ui.text("修改便签"),input,{input=it},Modifier.weight(1f),enabled=!request.busy,onDone=::save)
            NativeNoteAction(ui.text("保存便签"),"check",::save,!request.busy&&input.text.isNotBlank()&&input.text.trim().length<=200,request.busy)
            NativeNoteAction(ui.text("取消修改"),"close",{editing=false},!request.busy)
        }else{
            val checked=completedView||completing
            val interaction=remember{MutableInteractionSource()}
            Box(Modifier.size(44.dp).toggleable(checked,enabled=!request.busy&&!animateStrike,role=Role.Checkbox,interactionSource=interaction,indication=null){
                completing=!completedView;if(completing)onCompleting()
                request.submit{runtime.dispatch(WorkspaceMutation.CompleteNote(note.id,!completedView),it)}
            }.nativePressMotion(interaction,!request.busy&&!animateStrike).semantics{contentDescription=ui.text(if(completedView)"恢复便签"else"完成便签")},contentAlignment=Alignment.CenterStart){
                Canvas(Modifier.size(16.dp)){drawRect(ink,style=Stroke(2.dp.toPx()));if(checked)drawRect(ink,Offset(4.dp.toPx(),4.dp.toPx()),androidx.compose.ui.geometry.Size(size.width-8.dp.toPx(),size.height-8.dp.toPx()))}
            }
            var layout by remember{mutableStateOf<TextLayoutResult?>(null)}
            Text(note.text,Modifier.weight(1f).padding(vertical=8.dp).focusable().onKeyEvent{event->if(event.type==KeyEventType.KeyDown&&event.key in listOf(Key.Enter,Key.F2)){editing=true;true}else false}
                .pointerInput(note.id){detectTapGestures(onDoubleTap={if(!request.busy)editing=true})}.semantics{contentDescription=ui.text("编辑便签");onClick{if(!request.busy){editing=true;true}else false}}
                .drawWithContent{
                    drawContent();val result=layout?:return@drawWithContent
                    val total=(0 until result.lineCount).sumOf{(result.getLineRight(it)-result.getLineLeft(it)).toDouble()};var available=total*strike.value
                    repeat(result.lineCount){line->val left=result.getLineLeft(line);val width=result.getLineRight(line)-left;val length=minOf(width.toDouble(),available).coerceAtLeast(0.0).toFloat()
                        drawLine(ink,Offset(left,(result.getLineTop(line)+result.getLineBottom(line))/2),Offset(left+length,(result.getLineTop(line)+result.getLineBottom(line))/2),2.dp.toPx());available-=width}
                },onTextLayout={layout=it},style=MaterialTheme.typography.bodyLarge,color=ink)
            NativeNoteAction(ui.text("删除便签"),"close",{request.submit{runtime.dispatch(WorkspaceMutation.DeleteNote(note.id),it)}},!request.busy&&!animateStrike)
        }
    }
    NativeRequestError(request)
}
