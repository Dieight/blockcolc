package com.blockcolc.preview.world

import com.blockcolc.domain.DomainDocument
import com.blockcolc.presentation.WorldFacts
import java.util.concurrent.CancellationException
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit

data class WorldRequestIdentity(val database:String,val replacementGeneration:Long,val revision:Long) {
    init { require(database.isNotEmpty()&&replacementGeneration>=0&&revision>=0) }
}
data class PreparedWorldRequest(val identity:WorldRequestIdentity,val sourceSha:String,val plan:WorldCpuPlan,val terrainWorld:WorldTerrainPlan,val frame:NativeWorldFrame?=null)

/** Dedicated CPU worker. The UI host supplies its delivery dispatcher and only
 * requests preparation while the world is visible. Domain facts are immutable;
 * no transaction or timer advances here. A newer request cancels queued work,
 * running loops cooperate, and already-posted callbacks check freshness again.
 * Actual GPU staging/publication remains a separate render-thread operation. */
class WorldGenerationWorker(
    private val deliver:(Runnable)->Unit,
    private val signRasterizer:com.blockcolc.world.NativeSignRasterizer?,
    private val builderFactory:()->WorldPlanBuilder={WorldPlanBuilder()},
    private val resourcePreparation:((com.blockcolc.preview.resources.ResourceWorldSelection?,()->Boolean)->com.blockcolc.world.NativeResourceWorldAssets?)?=null,
    private val closeResourcePreparation:(()->Unit)?=null,
    private val packetAllocator:com.blockcolc.world.NativePacketAllocator?=null
):AutoCloseable {
    constructor(deliver:(Runnable)->Unit,builderFactory:()->WorldPlanBuilder={WorldPlanBuilder()}):this(deliver,null,builderFactory)
    private val gate=Any()
    private val executor=ScheduledThreadPoolExecutor(1){r->Thread(r,"blockcolc-world-generation").apply{isDaemon=true}}
        .apply{removeOnCancelPolicy=true}
    // Requests still serialize through gate. Generation's very hot
    // cancellation polls only need visibility of the latest ticket, not a
    // monitor acquisition for every voxel/triangle.
    @Volatile private var sequence=0L
    @Volatile private var closed=false
    private var pending:ScheduledFuture<*>?=null
    private var builder:WorldPlanBuilder?=null // worker-confined, including creation and cleanup
    private var packetCompiler:NativeWorldPacketCompiler?=null

    fun request(identity:WorldRequestIdentity,document:DomainDocument,onReady:(PreparedWorldRequest)->Unit,onFailure:(Exception)->Unit)=
        request(identity,document,WorldTerrainOptions(),onReady,onFailure)

    fun request(identity:WorldRequestIdentity,document:DomainDocument,options:WorldTerrainOptions,onReady:(PreparedWorldRequest)->Unit,onFailure:(Exception)->Unit) {
        synchronized(gate) {
            check(!closed){"World generation worker is closed"}
            val ticket=++sequence
            pending?.cancel(false)
            pending=executor.schedule({
                fun cancelled()=closed||sequence!=ticket
                if(cancelled())return@schedule
                val result=try { com.blockcolc.world.NativePacketBuffers.using(packetAllocator){
                    val planner=builder?:builderFactory().also{builder=it}
                    val facts=com.blockcolc.preview.NativeStartupTrace.measure("world-facts",benchmark=true){WorldFacts.from(document)}
                    val plan=com.blockcolc.preview.NativeStartupTrace.measure("world-layout",benchmark=true){planner.prepare(facts,options.buildingCondition,::cancelled)}
                    val terrain=com.blockcolc.preview.NativeStartupTrace.measure("world-terrain",benchmark=true){planner.terrain(plan,options,::cancelled)}
                    com.blockcolc.preview.NativeStartupTrace.point("cache-${terrain.reuse.name}-${terrain.sceneryReuse.name}")
                    val frame=options.rendering?.let{renderOptions->
                        val compiler=packetCompiler?:NativeWorldPacketCompiler(signRasterizer,packetAllocator,parallel=true).also{packetCompiler=it}
                        val actual=resourcePreparation?.let{prepare->renderOptions.copy(resources=prepare(options.resourceSelection,::cancelled))}?:renderOptions
                        com.blockcolc.preview.NativeStartupTrace.measure("world-packets",benchmark=true){compiler.prepare(identity,terrain,actual,::cancelled)}
                    }
                    PreparedWorldRequest(identity,document.sha256,plan,terrain,frame)
                }} catch(_:CancellationException) { return@schedule }
                catch(error:OutOfMemoryError) {
                    if(com.blockcolc.preview.BuildConfig.NATIVE_DIAGNOSTICS)com.blockcolc.world.filament.NativeWorldFailureEvidence.capture(error)
                    // ScheduledExecutor retains Errors in its Future. Without
                    // this job boundary the UI would wait forever for a result.
                    val failure=IllegalStateException("World preparation exceeds available memory",error)
                    deliver(Runnable{synchronized(gate){if(!closed&&sequence==ticket)onFailure(failure)}})
                    return@schedule
                }
                catch(error:Exception) {
                    deliver(Runnable{synchronized(gate){if(!closed&&sequence==ticket)onFailure(error)}})
                    return@schedule
                }
                deliver(Runnable{synchronized(gate){
                    if(!closed&&sequence==ticket)com.blockcolc.preview.NativeStartupTrace.measure("world-delivery",benchmark=true){onReady(result)}
                }})
            },0,TimeUnit.NANOSECONDS)
        }
    }

    fun cancelPending()=synchronized(gate) {
        if(!closed){sequence++;pending?.cancel(false);pending=null}
    }

    override fun close()=synchronized(gate) {
        if(!closed) {
            closed=true;sequence++;pending?.cancel(false);pending=null
            // Cleanup follows the currently cancelling job on its own worker.
            // No main-thread wait and no cross-thread cache mutation.
            executor.execute{builder?.clear();builder=null;packetCompiler?.close();packetCompiler=null;closeResourcePreparation?.invoke()}
            executor.shutdown()
        }
    }

    internal fun awaitTermination(timeout:Long,unit:TimeUnit)=executor.awaitTermination(timeout,unit)
}
