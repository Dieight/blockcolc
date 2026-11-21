package com.blockcolc.preview.world

import android.content.Context
import com.blockcolc.domain.DomainDocument
import java.io.File
import java.util.concurrent.CancellationException
import java.util.concurrent.TimeUnit

/** Android composition-root owner for CPU generation and its optional derived
 * file cache. Feature pages do not receive it; the host supplies immutable
 * committed documents and its delivery dispatcher. GPU ownership is separate. */
class NativeWorldSession(context:Context,deliver:(Runnable)->Unit,directory:File=File(context.cacheDir,"native-world"),
    compactGeometry:Boolean=true):AutoCloseable {
    private val gate=Any()
    private var closed=false
    private var caches:CacheFiles?=null
    private val application=context.applicationContext
    private val packetAllocator=AndroidPacketBuffers(application)
    private val signRasterizer=AndroidSignRasterizer()
    private class CacheFiles(val terrain:AndroidTerrainCache,val scenery:AndroidSceneryCache,val blueprints:AndroidBlueprintCache,
        val structures:AndroidStructureCache,val staticWorld:AndroidStaticWorldCache?,val paperWorld:AndroidStaticWorldCache?):AutoCloseable {
        override fun close(){terrain.close();scenery.close();blueprints.close();structures.close();staticWorld?.close();paperWorld?.close()}
    }
    private val resources=com.blockcolc.preview.resources.NativeWorldResourcePreparation(com.blockcolc.preview.resources.NativeResourceController.get(application))
    private val worker=WorldGenerationWorker(deliver,signRasterizer,builderFactory={
        // Both resource loading and filesystem preparation start on the worker.
        val terrain=AndroidTerrainCache(application,directory)
        val scenery=try{AndroidSceneryCache(application,directory)}catch(error:Exception){terrain.close();throw error}
        val blueprints=try{AndroidBlueprintCache(application,directory)}catch(error:Exception){terrain.close();scenery.close();throw error}
        val structures=try{AndroidStructureCache(application,directory)}catch(error:Exception){terrain.close();scenery.close();blueprints.close();throw error}
        val staticWorld=try{AndroidStaticWorldCache(application,directory)}catch(_:Exception){null}
        val paperWorld=try{AndroidStaticWorldCache(application,File(directory,"paper"))}catch(_:Exception){null}
        val files=CacheFiles(terrain,scenery,blueprints,structures,staticWorld,paperWorld)
        synchronized(gate){
            if(closed){files.close();throw CancellationException("World owner closed")}
            caches=files
        }
        WorldPlanBuilder(sources=NativeBlueprintSources(renderCache=blueprints),terrainCache=terrain,sceneryCache=scenery,
            structures=com.blockcolc.world.generation.OriginalStructureCache(storage=structures))
    },resourcePreparation=resources::prepare,closeResourcePreparation=resources::close,packetAllocator=packetAllocator,
        packetCompilerFactory={synchronized(gate){
            NativeWorldPacketCompiler(signRasterizer,packetAllocator,true,caches?.staticWorld,caches?.paperWorld,compactGeometry)
        }})
    fun request(identity:WorldRequestIdentity,document:DomainDocument,options:WorldTerrainOptions=WorldTerrainOptions(),
        onReady:(PreparedWorldRequest)->Unit,onFailure:(Exception)->Unit)=worker.request(identity,document,options,onReady,onFailure)
    fun cancelPending()=worker.cancelPending()
    internal fun paperCacheStatsForTest()=synchronized(gate){caches?.paperWorld?.stats}
    override fun close(){
        val files=synchronized(gate){if(closed)return;closed=true;caches}
        worker.close()
        files?.close()
    }
    internal fun awaitCacheWritesForTest(timeout:Long,unit:TimeUnit):Boolean {
        val files=synchronized(gate){caches}?:return false
        val terrain=files.terrain.awaitWritesForTest(timeout,unit)
        val scenery=files.scenery.awaitWritesForTest(timeout,unit)
        val blueprints=files.blueprints.awaitWritesForTest(timeout,unit)
        val structures=files.structures.awaitWritesForTest(timeout,unit)
        return terrain&&scenery&&blueprints&&structures
    }
    internal fun awaitTermination(timeout:Long,unit:TimeUnit):Boolean {
        val world=worker.awaitTermination(timeout,unit)
        val files=synchronized(gate){caches}?:return world
        val terrain=files.terrain.awaitTermination(timeout,unit)
        val scenery=files.scenery.awaitTermination(timeout,unit)
        val blueprints=files.blueprints.awaitTermination(timeout,unit)
        val structures=files.structures.awaitTermination(timeout,unit)
        val staticWorld=files.staticWorld?.awaitTermination(timeout,unit)?:true
        val paperWorld=files.paperWorld?.awaitTermination(timeout,unit)?:true
        return world&&terrain&&scenery&&blueprints&&structures&&staticWorld&&paperWorld
    }
}
