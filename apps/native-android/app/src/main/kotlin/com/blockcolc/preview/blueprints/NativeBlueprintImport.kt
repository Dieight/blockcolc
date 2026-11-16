package com.blockcolc.preview.blueprints

import android.content.Context
import android.net.Uri
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import com.blockcolc.world.importing.NativeLitematic
import com.blockcolc.world.importing.NativeLitematicError
import com.blockcolc.world.importing.NativeLitematicResult
import java.util.concurrent.CancellationException
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicReference
import java.io.InputStream

data class NativeBlueprintImportView(val busy:Boolean=false,val candidate:NativeLitematicResult?=null,val error:String?=null)

/** Activity/composition-owned parsing lane, never a second business writer.
 * Closing invalidates delivery and cancels both the provider and CPU traversal. */
class NativeBlueprintImport(context:Context):AutoCloseable {
    companion object {
        @Volatile private var instance:NativeBlueprintImport?=null
        fun get(context:Context):NativeBlueprintImport=instance?:synchronized(this){instance?:NativeBlueprintImport(context.applicationContext).also{instance=it}}
    }
    private val resolver=context.applicationContext.contentResolver
    private val main=Handler(Looper.getMainLooper())
    private val worker=Executors.newSingleThreadExecutor{Thread(it,"blockcolc-blueprint-import")}
    private val stream=AtomicReference<InputStream?>()
    private var task:Future<*>?=null
    private var signal:CancellationSignal?=null
    private var sequence=0L
    @Volatile private var closed=false
    @Volatile private var epoch=0L
    private var current=NativeBlueprintImportView()
    private val listeners=mutableSetOf<(NativeBlueprintImportView)->Unit>()
    fun snapshot()=current
    fun subscribe(listener:(NativeBlueprintImportView)->Unit):()->Unit {listeners+=listener;listener(current);return{listeners-=listener}}
    private fun publish(value:NativeBlueprintImportView){current=value;listeners.toList().forEach{it(value)}}
    fun clear(){check(Looper.myLooper()==Looper.getMainLooper());cancel();publish(NativeBlueprintImportView())}
    /** A rotation retires unfinished provider work but retains an already
     * parsed draft, including one awaiting a failed business-save retry. */
    fun cancelParsing(){if(current.busy)clear()}
    private fun cancel(){epoch=++sequence;signal?.cancel();signal=null;task?.cancel(true);task=null;runCatching{stream.getAndSet(null)?.close()}}
    fun import(uri:Uri){
        check(Looper.myLooper()==Looper.getMainLooper());if(closed)return;cancel();val token=epoch;val cancellation=CancellationSignal();signal=cancellation
        publish(NativeBlueprintImportView(busy=true))
        task=worker.submit{
            var result:NativeLitematicResult?=null;var error:String?=null
            try{
                resolver.openAssetFileDescriptor(uri,"r",cancellation)?.use{descriptor->
                    descriptor.createInputStream().use{input->stream.set(input)
                        try{result=NativeLitematic.parse(input,cancelled={closed||epoch!=token||cancellation.isCanceled})}finally{stream.compareAndSet(input,null)}}
                }?:throw java.io.IOException("Cannot open blueprint file")
            }catch(_:CancellationException){return@submit}catch(_:android.os.OperationCanceledException){return@submit}
            catch(e:Exception){error=(e as? NativeLitematicError)?.code?:"BLUEPRINT_READ_FAILED"}
            main.post{if(!closed&&epoch==token){task=null;signal=null;publish(NativeBlueprintImportView(candidate=result,error=error))}}
        }
    }
    override fun close(){if(closed)return;closed=true;cancel();listeners.clear();worker.shutdownNow()}
}
