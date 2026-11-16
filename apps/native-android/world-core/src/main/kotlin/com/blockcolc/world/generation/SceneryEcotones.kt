package com.blockcolc.world.generation

import java.util.Collections
import java.util.concurrent.CancellationException
import kotlin.math.*
import com.blockcolc.world.generation.SourceNumbers.hypot

data class SceneryRect(val x:Double,val z:Double,val width:Double,val depth:Double)
data class ScenerySupportRange(val min:Double,val max:Double)
data class EcotoneTreeSite(val x:Double,val y:Double,val z:Double,val scale:Double,val species:SceneryTreeSpecies)
data class TreeSuitability(val forest:Double,val conifer:Double,val meadow:Double,val treeline:Double)
data class EcotoneTreeInput(val seed:Int,val coreX:Double,val coreZ:Double,val coreRadius:Double,val bounds:TerrainPlanBounds,
    val surfaceAt:(Double,Double)->TerrainSurface?,val supports:(Double,Double,Double,Double)->ScenerySupportRange?,val occupied:(SceneryRect,Double)->Boolean)

class SceneryClimate(private val seed:Int,coreRadius:Double) {
    private val mosaic=MosaicTerrain(seed,coreRadius)
    fun treeSuitability(x:Double,z:Double,height:Double,cold:Boolean):TreeSuitability {
        val f=mosaic.fields(x,z);val patches=.58+.42*TerrainMath.smooth(.25,.72,TerrainMath.landscapeNoise(seed xor 0x93ab,x,z,42.0))
        val forest=TerrainMath.smooth(.08,.50,f.forestHabitat)*patches
        val treeline=1-TerrainMath.smooth(25.0,49.0,height)
        val conifer=(if(cold)TerrainMath.smooth(.02,.40,max(f.ice,f.mountain))else 0.0)*treeline*patches
        val meadow=.04+.18*TerrainMath.smooth(.44,.76,TerrainMath.landscapeNoise(seed xor 0x87b1,x,z,55.0))
        return TreeSuitability(forest,conifer,meadow,treeline)
    }
    companion object {
        fun reefDensity(seed:Int,x:Double,z:Double,centerX:Double,centerZ:Double,radius:Double,depth:Double):Double {
            val wx=(TerrainMath.landscapeNoise(seed xor 0x12bf,x,z,61.0)-.5)*radius*.32
            val wz=(TerrainMath.landscapeNoise(seed xor 0x421d,x,z,57.0)-.5)*radius*.28
            val dx=(x-centerX+wx)/radius;val dz=(z-centerZ+wz)/radius
            val body=1-hypot(dx+sin(dz*2.8)*.15,dz/.86);val lobe=.47-hypot(dx-.62,dz+.25)
            val edge=max(body,lobe)+(TerrainMath.landscapeNoise(seed xor 0x812a,x,z,25.0)-.5)*.40+(TerrainMath.landscapeNoise(seed xor 0x194a,x,z,10.0)-.5)*.12
            return TerrainMath.smooth(-.10,.25,edge)*TerrainMath.smooth(5.8,8.0,depth)*(1-TerrainMath.smooth(13.0,17.0,depth))
        }
        fun reefChannel(seed:Int,x:Double,z:Double):Boolean {
            val wx=x+(TerrainMath.landscapeNoise(seed xor 0x554,x,z,65.0)-.5)*22
            val wz=z+(TerrainMath.landscapeNoise(seed xor 0x892,x,z,63.0)-.5)*22
            return abs(TerrainMath.landscapeNoise(seed xor 0x337a,wx,wz,42.0)-.5)<.024
        }
    }
}

object EcotoneTrees {
    private data class Candidate(val x:Double,val z:Double,val priority:Double,val gx:Int,val gz:Int)
    private val coldOffsets=listOf(-8 to 0,8 to 0,0 to -8,0 to 8,-6 to -6,-6 to 6,6 to -6,6 to 6)
    fun plan(input:EcotoneTreeInput,cancelled:()->Boolean={false}):List<EcotoneTreeSite> {
        fun checkpoint(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Ecotone planning superseded")}
        checkpoint();val b=input.bounds
        if(!listOf(b.minX,b.maxX,b.minZ,b.maxZ).all{it.isFinite()}||b.minX>b.maxX||b.minZ>b.maxZ)return emptyList()
        val candidates=ArrayList<Candidate>();val cell=11.0;val seed=input.seed
        for(gx in floor(b.minX/cell).toInt()..ceil(b.maxX/cell).toInt()) {
            checkpoint()
            for(gz in floor(b.minZ/cell).toInt()..ceil(b.maxZ/cell).toInt()) {
                val x=TerrainMath.round((gx+.15+.7*TerrainMath.landscapeRandom(seed xor 0x391,gx.toDouble(),gz.toDouble()))*cell)
                val z=TerrainMath.round((gz+.15+.7*TerrainMath.landscapeRandom(seed xor 0x762,gx.toDouble(),gz.toDouble()))*cell)
                if(x<b.minX+5||x>b.maxX-5||z<b.minZ+5||z>b.maxZ-5)continue
                val distance=hypot(x-input.coreX,z-input.coreZ)/max(116.0,input.coreRadius+84)
                candidates+=Candidate(x,z,TerrainMath.landscapeRandom(seed xor 0x674a,gx.toDouble(),gz.toDouble())*(.10+distance.pow(4)),gx,gz)
            }
        }
        candidates.sortWith(compareBy<Candidate>{it.priority}.thenBy{it.x}.thenBy{it.z})
        val placed=ArrayList<EcotoneTreeSite>();val buckets=HashMap<TerrainBucket,MutableList<EcotoneTreeSite>>()
        val counts=IntArray(SceneryTreeSpecies.entries.size);val climate=SceneryClimate(seed,input.coreRadius)
        fun footprint(species:SceneryTreeSpecies)=if(species==SceneryTreeSpecies.POPLAR)9.0 else if(species==SceneryTreeSpecies.SPRUCE)7.0 else 5.0
        fun nearby(x:Double,z:Double):List<EcotoneTreeSite> {
            val found=ArrayList<EcotoneTreeSite>()
            for(dx in -2..2)for(dz in -2..2)found.addAll(buckets[TerrainBucket(floor(x/11).toInt()+dx,floor(z/11).toInt()+dz)].orEmpty())
            return found
        }
        for((index,p)in candidates.withIndex()) {
            if(index%128==0)checkpoint()
            val s=input.surfaceAt(p.x,p.z)?:continue
            if(s.water||s.material !in setOf(TerrainMaterial.GRASS,TerrainMaterial.SNOW))continue
            val spacing=max(116.0,input.coreRadius+84);val u=(p.x-input.coreX-p.z+input.coreZ)/sqrt(2.0)/spacing;val v=(p.x-input.coreX+p.z-input.coreZ)/sqrt(2.0)/spacing
            val cold=s.material in setOf(TerrainMaterial.SNOW,TerrainMaterial.ICE)||u<-.5&&abs(v)<.5||coldOffsets.any{(dx,dz)->input.surfaceAt(p.x+dx,p.z+dz)?.material in setOf(TerrainMaterial.SNOW,TerrainMaterial.ICE)}
            val q=climate.treeSuitability(p.x-input.coreX,p.z-input.coreZ,s.supportY,cold)
            val species=if(cold)SceneryTreeSpecies.SPRUCE else if(q.forest>.06)SceneryTreeSpecies.POPLAR else if(TerrainMath.landscapeNoise(seed xor 0x318,p.x,p.z,55.0)>.62)SceneryTreeSpecies.BIRCH else SceneryTreeSpecies.OAK
            val density=if(cold)q.conifer else if(species==SceneryTreeSpecies.POPLAR)q.forest else q.meadow
            val budget=when(species){SceneryTreeSpecies.POPLAR->160;SceneryTreeSpecies.SPRUCE->90;else->60}
            if(TerrainMath.landscapeRandom(seed xor 0x2d1b,p.gx.toDouble(),p.gz.toDouble())>density||counts[species.ordinal]>=budget)continue
            val size=footprint(species);val minimumSpacing=if(species==SceneryTreeSpecies.POPLAR)11.0 else 12.0
            if(nearby(p.x,p.z).any{tree->
                val other=footprint(tree.species)
                hypot(tree.x-p.x,tree.z-p.z)<max(minimumSpacing,if(tree.species==SceneryTreeSpecies.POPLAR)11.0 else 12.0)||
                    abs(tree.x-p.x)<(size+2+other)/2+2&&abs(tree.z-p.z)<(size+2+other)/2+2
            }||input.occupied(SceneryRect(p.x,p.z,size+2,size+2),2.0))continue
            val support=input.supports(p.x,p.z,3.0,3.0)?:continue;if(support.max-support.min>3)continue
            val tree=EcotoneTreeSite(p.x,s.supportY,p.z,1.0,species);placed+=tree;counts[species.ordinal]++
            buckets.getOrPut(TerrainBucket(floor(p.x/11).toInt(),floor(p.z/11).toInt())){arrayListOf()}.add(tree)
        }
        checkpoint();return Collections.unmodifiableList(placed)
    }
}
