package com.blockcolc.preview.ui

import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.*

/** Navigation owns form state; a page's composition only observes it. This is
 * UI memory, never a domain document, backup or second preference writer. */
internal class NativePageMemory(private val restored:MutableMap<String,List<Any?>> = linkedMapOf()) {
    private class Slot(val state:MutableState<*>,val save:SaverScope.()->Any?)
    private val slots=linkedMapOf<String,Slot>()
    @Suppress("UNCHECKED_CAST")
    fun <T> state(key:String,saver:Saver<T,out Any>,initial:()->T):MutableState<T> {
        slots[key]?.let{return it.state as MutableState<T>}
        val raw=restored.remove(key)
        val value=if(raw==null)initial() else if(raw[0]==true)null as T
            else runCatching{(saver as Saver<T,Any>).restore(checkNotNull(raw[1]))}.getOrNull()?:initial()
        val state=mutableStateOf(value)
        slots[key]=Slot(state){if(state.value==null)listOf(true,null) else
            with(saver as Saver<T,Any>){save(state.value)}?.let{listOf(false,it)}}
        return state
    }
    companion object {
        val Saver=Saver<NativePageMemory,Map<String,List<Any?>>>(
            save={memory->val scope=this;buildMap{
                putAll(memory.restored)
                for((key,slot)in memory.slots){
                    val value=slot.save(scope) as? List<Any?>
                    if(value!=null&&scope.canBeSaved(value))put(key,value)
                }
            }},
            restore={NativePageMemory(it.toMutableMap())})
    }
}
internal val LocalNativePageMemory=staticCompositionLocalOf<NativePageMemory?>{null}

@Composable internal fun <T> rememberNativePageState(key:String,stateSaver:Saver<T,out Any> = autoSaver(),initial:()->T):MutableState<T>{
    val memory=LocalNativePageMemory.current
    return if(memory==null)rememberSaveable(key=key,stateSaver=stateSaver){mutableStateOf(initial())}
        else memory.state(key,stateSaver,initial)
}
