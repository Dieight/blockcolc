package com.blockcolc.export

import com.blockcolc.storage.StoredState
import org.json.JSONObject
import org.json.JSONArray
import java.time.LocalDate
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit

interface ExportSink {
    val enrolledDate:LocalDate
    fun publish(source:String,snapshot:JSONObject,days:JSONArray)
}
/** One immutable committed input plus one dirty flag. No work or domain scan for Noop. */
class ExportLane(private val sink:ExportSink?,private val now:()->Long=System::currentTimeMillis):AutoCloseable {
    private data class Input(val database:String,val source:String,val state:StoredState,val epoch:Long)
    private val publishing=Any();private var epoch=0L;private var paused=false
    private val lock=Any();private var latest:Input?=null;private var dirty=false;private var running=false;private var closed=false
    private var retry:java.util.concurrent.ScheduledFuture<*>?=null;private var delay=5000L
    private val executor=if(sink==null)null else ScheduledThreadPoolExecutor(1){Thread(it,"blockcolc-export")}.apply{removeOnCancelPolicy=true}
    fun offer(database:String,state:StoredState){
        if(sink==null)return
        synchronized(lock){
            if(closed||paused)return
            val source=database+":"+state.token.replacementGeneration
            val prior=latest
            if(prior?.database==database&&(state.token.replacementGeneration<prior.state.token.replacementGeneration||state.token.replacementGeneration==prior.state.token.replacementGeneration&&state.token.revision<prior.state.token.revision))return
            latest=Input(database,source,state,epoch);dirty=true;retry?.cancel(false);retry=null
            if(!running){running=true;executor!!.execute(::drain)}
        }
    }
    private fun drain(){
        while(true){
            val item=synchronized(lock){if(closed||paused||!dirty){running=false;return};dirty=false;latest!!}
            try{
                val at=now();val output=FocusExport.project(item.state,sink!!.enrolledDate,at)
                synchronized(publishing){
                    val valid=synchronized(lock){!closed&&!paused&&item.epoch==epoch}
                    if(valid)sink.publish(item.source,output.first,output.second)
                }
                delay=5000
            }catch(_:Exception){
                synchronized(lock){
                    running=false
                    if(!closed&&!paused&&dirty){running=true;executor!!.execute(::drain)}
                    else if(!closed&&!paused&&item.epoch==epoch){dirty=true;retry=executor!!.schedule({synchronized(lock){if(!running&&!closed&&!paused){running=true;executor.execute(::drain)}}},delay,TimeUnit.MILLISECONDS);delay=minOf(delay*2,300000)}
                }
                return
            }
            synchronized(lock){
                if(!dirty&&!closed&&!paused&&item.epoch==epoch){
                    val at=now();val next=FocusExport.date(at).plusDays(1).atStartOfDay().toInstant(java.time.ZoneOffset.ofHours(8)).toEpochMilli()
                    retry=executor!!.schedule({synchronized(lock){if(!closed&&!paused){dirty=true;if(!running){running=true;executor.execute(::drain)}}}},maxOf(1,next-at),TimeUnit.MILLISECONDS)
                }
            }
        }
    }
    /** A barrier: after return no prior queued/in-flight publish can escape into another DB context.
     * Already-started sink calls finish before this returns; no network runs under the state lock. */
    fun pauseAndDiscard(){
        synchronized(lock){paused=true;epoch++;latest=null;dirty=false;retry?.cancel(false);retry=null}
        synchronized(publishing){ /* Join an already-started publish before changing the DB pointer. */ }
    }
    val suspended:Boolean get()=synchronized(lock){paused}
    fun resume(){synchronized(lock){check(!closed);paused=false}}
    override fun close(){synchronized(lock){closed=true;latest=null;retry?.cancel(false)};executor?.shutdownNow()}
}
