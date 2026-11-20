package com.blockcolc.audio

import android.content.Context
import android.content.Intent
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.util.AtomicFile
import androidx.core.content.ContextCompat
import org.json.JSONArray
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.Future
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors

data class AudioSelection(val enabled:Boolean=false,val primary:String="forest-birds",val rainEnabled:Boolean=false,val volume:Int=30,val language:String="zh-CN")
data class AudioLibraryState(val items:List<ImportedAudio> = emptyList(),val busy:Boolean=false,val error:String?=null)

/** Playback and imported assets have their own IO lane. No audio work enters
 * the focus writer or changes a domain record. Weather is an existing input. */
class NativeAudioController private constructor(context:Context) {
    companion object {
        @Volatile private var instance:NativeAudioController?=null
        fun get(context:Context):NativeAudioController=instance?:synchronized(this){instance?:NativeAudioController(context.applicationContext).also{instance=it}}
        private val imported=Regex("[a-f0-9]{64}")
        @JvmStatic fun contentDirectory(context:Context):File =
            File(context.filesDir, if(context.packageName=="com.blockcolc.preview") "ambient-imports" else "native-ambient-imports")
    }
    private val context=context.applicationContext
    private val main=Handler(Looper.getMainLooper())
    private val worker=Executors.newSingleThreadExecutor{Thread(it,"blockcolc-native-audio-io")}
    private val listeners=CopyOnWriteArrayList<(AudioLibraryState)->Unit>()
    @Volatile private var libraryState=AudioLibraryState()
    private val index=AtomicFile(File(this.context.filesDir,"ambient-library.json"))
    private val library=AudioLibrary(contentDirectory(this.context),object:AudioIndex{
        override fun read():String? {
            if(!index.baseFile.exists()&&!File(index.baseFile.path+".bak").exists())return null
            return index.openRead().use{input->val out=ByteArrayOutputStream();val buffer=ByteArray(1024)
                while(true){val n=input.read(buffer);if(n<0)break;if(out.size()+n>32768)throw AudioFailure("AUDIO_INDEX_INVALID");out.write(buffer,0,n)}
                out.toString("UTF-8")}
        }
        override fun write(value:String){val stream=index.startWrite()
            try{stream.write(value.toByteArray(Charsets.UTF_8));stream.fd.sync();index.finishWrite(stream)}
            catch(error:Exception){index.failWrite(stream);throw error}
            if(read()!=value)throw AudioFailure("AUDIO_INDEX_UNCONFIRMED")
        }
    },{file->val media=MediaMetadataRetriever();try{
        media.setDataSource(file.absolutePath)
        if(media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO)!="yes")throw AudioFailure("AUDIO_INVALID_MEDIA")
        media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()?:throw AudioFailure("AUDIO_INVALID_MEDIA")
    }finally{media.release()}})
    private var desired=AudioSelection()
    private var foreground=false
    private var raining=false;private var intensity=.3
    private var generation=0L
    private data class Request(val primary:String,val rain:Boolean,val volume:Int,val language:String,val intensity:Double)
    private var sent:Request?=null
    private var libraryOperation=false
    fun snapshot()=libraryState
    fun subscribe(listener:(AudioLibraryState)->Unit):()->Unit {listeners+=listener;listener(libraryState);return {listeners-=listener}}
    private fun publish(value:AudioLibraryState){check(Looper.myLooper()==Looper.getMainLooper());val immutable=value.copy(items=java.util.Collections.unmodifiableList(value.items.toList()))
        libraryState=immutable;for(listener in listeners)listener(immutable)}
    fun foreground(value:Boolean){checkMain();foreground=value;if(value)dispatch()}
    fun configure(value:AudioSelection){checkMain();require((value.primary in listOf("forest-birds","shore-waves")||imported.matches(value.primary))&&value.volume in 0..100&&value.language in listOf("zh-CN","en"))
        desired=value;AmbientAudioHost.language(value.language);dispatch()}
    fun weather(raining:Boolean,intensity:Double){checkMain();this.raining=raining;this.intensity=if(intensity.isFinite())intensity.coerceIn(0.0,1.0)else .3;dispatch()}
    fun retry(){checkMain();sent=null;dispatch()}
    private fun checkMain(){check(Looper.myLooper()==Looper.getMainLooper())}
    private fun dispatch(){
        val next=Request(if(desired.enabled)desired.primary else"",desired.rainEnabled&&raining,desired.volume,desired.language,intensity)
        if(next==sent)return
        val active=AmbientAudioHost.snapshot().active
        if(!foreground&&!active)return
        if(next.primary.isEmpty()&&!next.rain&&!active){generation++;sent=next;return}
        val version=++generation
        worker.execute{
            val prepared=runCatching{if(imported.matches(next.primary))library.playable(next.primary)}
            main.post{
                if(version!=generation||!foreground&&!AmbientAudioHost.snapshot().active)return@post
                if(prepared.isFailure){context.stopService(Intent(context,AmbientAudioService::class.java));sent=null
                    AmbientAudioHost.unavailable((prepared.exceptionOrNull() as? AudioFailure)?.code?:"AUDIO_CONTENT_INVALID");return@post}
                try{
                    val sources=JSONArray();if(next.primary.isNotEmpty())sources.put(next.primary);if(next.rain)sources.put("rain")
                    val intent=Intent(context,AmbientAudioService::class.java).putExtra("sources",sources.toString())
                        .putExtra("volume",next.volume).putExtra("rainIntensity",next.intensity)
                    if(sources.length()==0){if(AmbientAudioHost.snapshot().active)context.startService(intent)}else ContextCompat.startForegroundService(context,intent)
                    sent=next
                }catch(error:RuntimeException){sent=null;AmbientAudioHost.unavailable("AUDIO_START_FAILED")}
            }
        }
    }
    fun play(){checkMain();context.getSharedPreferences("blockcolc_ambient_playback",0).edit().putBoolean("paused",false).apply()
        if(AmbientAudioHost.snapshot().active)context.startService(Intent(context,AmbientAudioService::class.java).setAction("com.blockcolc.app.AMBIENT_PLAY"))
        else{sent=null;dispatch()}}
    fun pause(){checkMain();if(AmbientAudioHost.snapshot().active)context.startService(Intent(context,AmbientAudioService::class.java).setAction("com.blockcolc.app.AMBIENT_PAUSE"))}
    fun refresh(){operate {library.list()}}
    /** Copy the originals once before the workspace is adopted. The old
     * player's files and index are available if the previous UI is restored. */
    fun adoptLegacyImports():Future<Unit> = worker.submit<Unit> {
        val raw=context.getSharedPreferences("blockcolc_ambient_audio",Context.MODE_PRIVATE).getString("imports","[]")
            ?: throw AudioFailure("AUDIO_INDEX_INVALID")
        if(raw.length>32768)throw AudioFailure("AUDIO_INDEX_INVALID")
        val entries=JSONArray(raw)
        if(entries.length()>AudioLibrary.MAX_FILES)throw AudioFailure("AUDIO_INDEX_INVALID")
        val source=File(context.filesDir,"ambient-imports").canonicalFile
        val adopted=library.list().associateBy { it.id }
        val seen=mutableSetOf<String>()
        for(index in 0 until entries.length()){
            val entry=entries.getJSONObject(index)
            val id=entry.get("id") as String
            val bytes=entry.getLong("bytes")
            if(!imported.matches(id)||!seen.add(id)||bytes !in 1..AudioLibrary.MAX_BYTES)throw AudioFailure("AUDIO_INDEX_INVALID")
            val file=File(source,id).canonicalFile
            if(file.parentFile!=source||!file.isFile||file.length()!=bytes)throw AudioFailure("AUDIO_CONTENT_MISSING")
            if(id in adopted)library.playable(id)
            else library.importAudio(entry.getString("name"),expectedId=id){file.inputStream()}
        }
    }
    fun importAudio(uri:Uri,onSaved:(ImportedAudio)->Unit){
        require(uri.scheme=="content")
        operate(onSaved){
            var name="Imported audio"
            context.contentResolver.query(uri,arrayOf(OpenableColumns.DISPLAY_NAME),null,null,null)?.use{cursor->if(cursor.moveToFirst())name=cursor.getString(0)?:name}
            library.importAudio(name){context.contentResolver.openInputStream(uri)?:throw AudioFailure("AUDIO_READ_FAILED")}
        }
    }
    /** Disable the selected source durably before removing its original. A
     * failed preference save leaves the imported library and content intact. */
    fun remove(id:String,beforeRemove:()->Future<Unit>){operate{
        beforeRemove().get();library.remove(id);library.list()
    }}
    private fun <T> operate(onSaved:((T)->Unit)?=null,action:()->T){checkMain();if(libraryOperation)return
        libraryOperation=true;publish(libraryState.copy(busy=true,error=null))
        worker.execute{val result=runCatching{val value=action();value to library.list()}
            main.post{libraryOperation=false;result.onSuccess{(saved,items)->publish(AudioLibraryState(items));onSaved?.invoke(saved)}
                .onFailure{publish(libraryState.copy(busy=false,error=(it as? AudioFailure)?.code?:"AUDIO_LIBRARY_UNAVAILABLE"))}}}
    }
}
