package com.blockcolc.preview.resources

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import com.blockcolc.world.resource.*
import java.io.File
import java.util.Collections
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.CancellationException

data class ResourceWorldSelection(val activeId:String?=null,val baseId:String?=null,val reload:Long=0,val unavailable:Boolean=false){
    init{require(listOfNotNull(activeId,baseId).all{it.matches(Regex("[a-f0-9]{64}"))}&&reload>=0&&(!unavailable||activeId==null&&baseId==null))}
}
data class NativeResourceLibraryView(val ready:Boolean=false,val busy:Boolean=false,val metadata:ResourceLibraryState?=null,
    val contents:Map<String,ResourceContentState> = emptyMap(),val error:String?=null,val worldError:String?=null,val reload:Long=0,val operation:String?=null){
    val selection:ResourceWorldSelection? get()=if(!ready)null else metadata?.let{ResourceWorldSelection(it.activeId,it.baseId,reload)}?:ResourceWorldSelection(reload=reload,unavailable=true)
}

/** Process composition owner. Activity recreation shares one serial index
 * writer; world preparation borrows validated originals on its own worker. */
internal class NativeResourceController private constructor(context:Context,directory:File,private val choiceName:String="cloud-resource-choice"){
    companion object{
        @Volatile private var instance:NativeResourceController?=null
        fun get(context:Context):NativeResourceController=instance?:synchronized(this){instance?:NativeResourceController(context.applicationContext,File(context.filesDir,"native-resource-packs")).also{instance=it}}
        internal fun isolated(context:Context,directory:File)=NativeResourceController(context.applicationContext,directory,"cloud-resource-"+directory.name)
    }
    private val context=context.applicationContext
    private val main=Handler(Looper.getMainLooper())
    private val executor=Executors.newSingleThreadExecutor{Thread(it,"blockcolc-native-resource-io")}
    private val library=ResourcePackLibrary(directory,AndroidResourceLibraryIndex(directory))
    private val listeners=CopyOnWriteArrayList<(NativeResourceLibraryView)->Unit>()
    private val gate=Any();private var inFlight=false;@Volatile private var closed=false
    private var deferredCloudSelection:Pair<String?,String?>?=null
    @Volatile private var value=NativeResourceLibraryView()
    fun snapshot()=value
    fun subscribe(listener:(NativeResourceLibraryView)->Unit):()->Unit{
        listeners+=listener;main.post{if(listener in listeners)listener(value)};return{listeners-=listener}
    }
    private fun publish(next:NativeResourceLibraryView){value=next;main.post{if(!closed)for(listener in listeners)listener(next)}}
    private fun code(error:Exception):String=when(error){is ResourceLibraryFailure->error.code;is ResourcePackException->error.code;else->"RESOURCE_OPERATION_FAILED"}
    private fun perform(operation:String,reload:Boolean=false,action:()->Unit){
        val start=android.os.SystemClock.uptimeMillis();var initiallyReady=false
        synchronized(gate){if(closed||inFlight)return;initiallyReady=value.ready;inFlight=true
            if(operation=="original"||operation.startsWith("select:")||operation.startsWith("remove:")||operation=="import")deferredCloudSelection=null
            publish(value.copy(busy=true,error=null,operation=operation))}
        executor.execute{
            var error:String?=null
            try{action()}catch(e:CancellationException){/* no metadata is invented */}catch(e:Exception){error=code(e)}
            var metadata=value.metadata;var contents=value.contents
            try{metadata=library.snapshot();contents=Collections.unmodifiableMap(library.inspectContents())}catch(e:Exception){if(error==null)error=code(e)}
            if(error==null&&metadata!=null){
                val choice=com.blockcolc.preview.CloudResourceChoices(context,choiceName)
                val explicit=operation=="original"||operation.startsWith("select:")||operation.startsWith("remove:")||operation=="import"
                if(explicit||choice.read()==null){choice.save(metadata.activeId,metadata.baseId);com.blockcolc.preview.NativeCloudController.peek()?.changed()}
            }
            synchronized(gate){if(!closed){
                val selectionChanged=value.metadata?.activeId!=metadata?.activeId||value.metadata?.baseId!=metadata?.baseId
                val retryRepairedImport=operation=="import"&&error==null&&value.worldError!=null&&!selectionChanged
                publish(value.copy(ready=true,metadata=metadata,contents=contents,error=error,
                    worldError=if(selectionChanged)null else value.worldError,reload=value.reload+if(reload||retryRepairedImport)1 else 0))
            }}
            val wait=if(initiallyReady)(240-(android.os.SystemClock.uptimeMillis()-start)).coerceAtLeast(0)else 0
            main.postDelayed({val deferred=synchronized(gate){inFlight=false;if(!closed)publish(value.copy(busy=false,operation=null));deferredCloudSelection.also{deferredCloudSelection=null}}
                deferred?.let{cloudSelection(it.first,it.second)}},wait)
        }
    }
    fun refresh()=perform("refresh"){ }
    fun retry()=perform("retry",reload=true){ }
    fun select(id:String?,base:Boolean=false)=perform("select:${if(base)"base"else"active"}:$id"){library.select(id,base)}
    fun original()=perform("original"){library.useOriginal()}
    internal fun cloudSelection(active:String?,base:String?){
        synchronized(gate){if(closed)return;if(inFlight){deferredCloudSelection=active to base;return}}
        perform("cloud-selection"){
            val available=library.snapshot().items.map{it.id}.toSet()
            if(listOfNotNull(active,base).all{it in available}){
                library.select(base,true);library.select(active,false)
            }else library.useOriginal()
        }
    }
    fun remove(id:String)=perform("remove:$id"){library.remove(id)}
    fun import(uri:Uri)=perform("import"){
        val name=context.contentResolver.query(uri,arrayOf(OpenableColumns.DISPLAY_NAME),null,null,null)?.use{cursor->
            if(cursor.moveToFirst())cursor.getString(0)else null}?:"Imported resource pack"
        library.importPack(name,{checkNotNull(context.contentResolver.openInputStream(uri)){"Cannot open resource original"}})
    }
    internal fun openForWorld(selection:ResourceWorldSelection,cancelled:()->Boolean):ResourceLibraryLease{
        val lease=library.openSelection(cancelled)
        if(lease.state.activeId!=selection.activeId||lease.state.baseId!=selection.baseId){lease.close();throw CancellationException("Resource selection changed before preparation")}
        return lease
    }
    internal fun worldFailure(selection:ResourceWorldSelection,error:Exception){synchronized(gate){
        if(!closed&&value.selection==selection)publish(value.copy(worldError=code(error)))
    }}
    internal fun worldReady(selection:ResourceWorldSelection){synchronized(gate){
        if(!closed&&value.selection==selection&&value.worldError!=null)publish(value.copy(worldError=null))
    }}
    internal fun closeForTest(){synchronized(gate){closed=true;listeners.clear()};executor.shutdownNow()
        if(choiceName!="cloud-resource-choice")context.getSharedPreferences(choiceName,0).edit().clear().commit()}
}
