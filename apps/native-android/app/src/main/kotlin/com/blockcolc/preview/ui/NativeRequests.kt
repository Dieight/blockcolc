package com.blockcolc.preview.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.input.*
import androidx.compose.ui.unit.dp
import com.blockcolc.preview.WorkspaceUiState
import java.util.UUID

/** A UI request owns only its own receipt; an unrelated saved operation must
 * never close this editor or clear its draft. IDs survive Activity recreation. */
@Stable class NativeRequest(pending:String?=null,error:String?=null){
    var pending by mutableStateOf(pending);private set
    var error by mutableStateOf(error);private set
    val busy get()=pending!=null
    fun submit(work:(String)->Unit){if(busy)return;val id=UUID.randomUUID().toString();pending=id;error=null;work(id)}
    internal fun finish(saved:Boolean,reason:String?){pending=null;error=if(saved)null else reason?:"SAVE_FAILED"}
    internal fun savedState()=listOf(pending?:"",error?:"",processIdentity)
    companion object {
        private val processIdentity=UUID.randomUUID().toString()
        internal fun restore(state:List<String>):NativeRequest {
            // An Activity recreation keeps its in-flight receipt. A dead
            // process has no callback to wait for: reload committed facts,
            // not an indefinitely disabled UI request from that process.
            return NativeRequest(if(state.getOrNull(2)==processIdentity)state[0].ifEmpty{null}else null,state.getOrNull(1)?.ifEmpty{null})
        }
    }
}

@Composable fun rememberNativeRequest(snapshot:WorkspaceUiState,onSaved:()->Unit={}):NativeRequest{
    val request=rememberSaveable(snapshot.generation,snapshot.roomContext,saver=Saver<NativeRequest,List<String>>(
        save={it.savedState()},restore={NativeRequest.restore(it)})){NativeRequest()}
    val saved by rememberUpdatedState(onSaved)
    LaunchedEffect(snapshot.receipts,request.pending){
        val id=request.pending?:return@LaunchedEffect
        val receipt=snapshot.receipts.find{it.id==id}?:return@LaunchedEffect
        request.finish(receipt.saved,receipt.reason)
        if(receipt.saved)saved()
    }
    return request
}

@Composable fun NativeRequestError(request:NativeRequest,message:String="保存失败，请重试。"){
    if(request.error!=null)Text(LocalNativeUi.current.text(message),color=MaterialTheme.colorScheme.error,modifier=Modifier.semantics{liveRegion=LiveRegionMode.Polite})
}

/** TextFieldValue is the source for both selection and composing text. No
 * saved snapshot is written back while the user is editing. Candidate Enter
 * is not a submit; the explicit action remains available for every keyboard. */
@Composable fun NativeTextEntry(label:String,value:TextFieldValue,onValueChange:(TextFieldValue)->Unit,enabled:Boolean=true,singleLine:Boolean=true,onDone:(()->Unit)?=null){
    val ui=LocalNativeUi.current
    BasicTextField(value,onValueChange,enabled=enabled,singleLine=singleLine,
        textStyle=MaterialTheme.typography.bodyLarge.copy(color=MaterialTheme.colorScheme.onSurface),
        keyboardOptions=KeyboardOptions(imeAction=if(onDone!=null)ImeAction.Done else ImeAction.Default),
        keyboardActions=KeyboardActions(onDone={if(value.composition==null)onDone?.invoke()}),
        modifier=Modifier.fillMaxWidth().heightIn(min=48.dp).background(MaterialTheme.colorScheme.surfaceVariant).padding(12.dp).semantics{contentDescription=label},
        decorationBox={input->Box{if(value.text.isEmpty())Text(label,style=MaterialTheme.typography.bodyLarge,color=MaterialTheme.colorScheme.onSurface.copy(alpha=if(ui.reduceTransparency)1f else .75f));input()}})
}
