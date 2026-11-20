package com.blockcolc.preview.world

import com.blockcolc.world.*
import com.blockcolc.world.generation.*

/** Generation-worker adapter from the current world, not exported P1 input.
 * Invisible construction outlines never become physical animal obstacles. */
internal class WorldAnimalPreparation {
    private val habitats=NativeAnimalHabitatCompiler()
    private data class PopulationKey(val prepared:NativeAnimalPrepared,val style:WorldEnvironment,val seed:Long)
    private var population:Pair<PopulationKey,NativeAnimalScene>?=null
    private class Packets(val bounds:BlockBox,val paper:Boolean,val source:NativePacketSource,val picking:NativeAnimalPickTemplate)
    private var packets:Packets?=null
    fun prepare(world:WorldTerrainPlan,paper:Boolean=false,cancelled:()->Boolean):Pair<NativeAnimalScene,NativePacketSource>? {
        val first=world.input.buildings.firstOrNull()?:return null
        val center=first.placement.worldPosition.let{AnimalPoint(it.x,it.y,it.z)}
        val bounds=world.terrain.bounds;val obstacles=ArrayList<NativeAnimalObstacle>()
        for(b in world.input.buildings){val p=b.placement;val v=p.worldPosition
            obstacles+=NativeAnimalObstacle("building:${b.fact.id}",b.recipe.key,b.recipe.intact,BlockPoint(v.x,v.y,v.z),p.rotationY,p.blueprintOffset,
                AnimalBounds(v.x-p.footprint.width/2.0-1,v.x+p.footprint.width/2.0+1,v.z-p.footprint.depth/2.0-1,v.z+p.footprint.depth/2.0+1))
        }
        for(r in world.rewards){val p=r.support.placement;val v=p.worldPosition
            obstacles+=NativeAnimalObstacle("reward:${r.source.fact.rewardId}","${r.source.recipe.key}:${world.cacheKey}:foundation",
                r.support.foundation+r.source.recipe.intact,BlockPoint(v.x,v.y,v.z),p.rotationY,p.blueprintOffset)
        }
        for(o in world.scenery.objects)if(o.role!=SceneryRole.PATH&&o.role!=SceneryRole.GARDEN){
            // Exclusion areas can change the world scenery key while this
            // object's complete local geometry and placement stay identical.
            // Keep its collider owner rather than rebuilding the whole reef.
            obstacles+=NativeAnimalObstacle("wildlife:${o.id}",o.blocks.sourceKey(cancelled),o.blocks.voxels,BlockPoint(o.x,o.y,o.z),0.0)
        }
        val prepared=habitats.prepare(world.surfaces,AnimalBounds(bounds.minX,bounds.maxX,bounds.minZ,bounds.maxZ),center,obstacles,cancelled)
        var seed=0x811c9dc5L
        for(c in world.input.facts.seed)seed=((seed xor c.code.toLong())*0x01000193L)and 0xffffffffL
        val key=PopulationKey(prepared,world.input.spatial.environment,seed)
        // Flight can rise above the highest terrain/building; culling remains
        // disabled for these fixed-capacity, dynamically posed draw slots.
        val box=BlockBox(BlockPoint(bounds.minX,bounds.minY-2,bounds.minZ),BlockPoint(bounds.maxX,bounds.maxY+48,bounds.maxZ))
        val previous=packets
        val packet=previous?.takeIf{it.bounds==box&&it.paper==paper}?:NativeAnimalPackets.prepare(box,paper,cancelled).let{Packets(box,paper,it,NativeAnimalPickTemplate(it))}
        val state=population?.takeIf{it.first==key&&packet===previous}?.second?:NativeAnimalScene(prepared,prepared.populate(key.style,key.seed,cancelled),packet.picking)
        population=key to state;packets=packet;return state to packet.source
    }
    fun clear(){habitats.clear();population=null;packets=null}
}
