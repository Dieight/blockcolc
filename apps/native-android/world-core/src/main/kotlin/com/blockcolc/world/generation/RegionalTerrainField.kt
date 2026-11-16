package com.blockcolc.world.generation

import kotlin.math.*

internal class RegionalTerrainField(private val coreRadius:Double,private val seed:Int,private val profile:TerrainProfile.Regional,
    private val support:TerrainSupportField,roads:List<RoadCell>,private val mosaic:Boolean,private val checkpoint:()->Unit) {
    private data class CellKey(val coordinate:TerrainCoordinate,val size:Int)
    private val samples=HashMap<TerrainCoordinate,TerrainSample>();private val lands=HashMap<TerrainCoordinate,TerrainSample>();private val cells=HashMap<CellKey,TerrainSample>()
    val hydrology=if(mosaic)null else TerrainHydrology(seed,min(profile.far,560.0),support,checkpoint)
    private val coast=if(mosaic)MosaicTerrain(seed,coreRadius)else null
    private var cascadeSites:List<ValleyCascadeSite> = emptyList()
    private var calls=0
    init {
        if(!mosaic)support.bench=ValleyBench(support.rects,roads,support::roadHeightAt)
        if(!mosaic)cascadeSites=TerrainLandforms.cascades(coreRadius,seed){x,z->distantRelief(natural(x,z,false),x,z).height}
    }
    private fun check(){if(calls++%256==0)checkpoint()}
    private fun distantRelief(sample:TerrainSample,x:Double,z:Double):TerrainSample {
        if(mosaic||sample.waterKind!=TerrainWater.NONE||sample.mountainSignal<=.02)return sample
        val distance=max(abs(x),abs(z));val envelope=TerrainMath.smooth(coreRadius+48,max(profile.middle,coreRadius+208),distance)
        val lift=envelope*TerrainMath.smooth(.05,.65,sample.mountainSignal)*32
        return if(lift>.001)sample.copy(height=TerrainMath.round(min(68.0,sample.height+lift)))else sample
    }
    private fun natural(x:Double,z:Double,includeWater:Boolean=true,coarse:Boolean=false):TerrainSample {
        val macro=TerrainMath.macro(x,z,seed,coarse);val supported=support.sample(x,z)
        val maximum=supported.height+(1-supported.influence).pow(.78)*48
        var height=if(supported.influence>=.995)supported.height else TerrainMath.round(min(macro.height,maximum))
        var material=if(macro.rocky&&supported.influence<.2)TerrainMaterial.STONE else TerrainMaterial.GRASS
        var kind=TerrainWater.NONE
        val land=TerrainSample(height,material,supported.influence,macro.moisture,kind,macro.mountainSignal)
        val shaped=support.bench?.shape(land,x,z,seed)?:land;height=shaped.height
        val water=if(includeWater&&supported.influence<.28)hydrology!!.sample(x,z,height)else null
        if(water!=null&&water.kind!=TerrainWater.NONE){height=water.height;material=water.material;kind=water.kind}
        else if(water?.material==TerrainMaterial.DIRT)height=water.height
        return shaped.copy(height=height,material=if(water?.material==TerrainMaterial.DIRT)shaped.material else material,waterKind=kind)
    }
    private fun mosaicAt(x:Double,z:Double):TerrainSample {
        val generated=coast!!.sample(x,z);val supported=support.sample(x,z);val blend=supported.influence
        val height=TerrainMath.round(generated.height*(1-blend)+supported.height*blend)
        val material=if(blend>.18)TerrainMaterial.GRASS else generated.material
        return TerrainSample(height,material,blend,if(generated.biome=="badlands").02 else .6,if(material==TerrainMaterial.WATER)TerrainWater.LAKE else TerrainWater.NONE)
    }
    fun at(x:Double,z:Double):TerrainSample {
        check();val key=TerrainCoordinate.at(x,z)
        return samples.getOrPut(key){TerrainLandforms.cascade(distantRelief(if(mosaic)mosaicAt(x,z)else natural(x,z),x,z),x,z,cascadeSites)}
    }
    private fun landAt(x:Double,z:Double):TerrainSample {
        val key=TerrainCoordinate.at(x,z)
        return lands.getOrPut(key){if(mosaic)mosaicAt(x,z)else TerrainLandforms.cascade(distantRelief(natural(x,z,false),x,z),x,z,cascadeSites,false)}
    }
    private fun coarseAt(x:Double,z:Double,size:Int):TerrainSample {
        val key=CellKey(TerrainCoordinate.at(x,z),size);cells[key]?.let{return it}
        var broad=TerrainLandforms.cascade(distantRelief(if(mosaic)mosaicAt(x,z)else natural(x,z,true,true),x,z),x,z,cascadeSites)
        if(mosaic&&broad.waterKind==TerrainWater.NONE&&broad.supportInfluence<.18) {
            var sum=broad.height*4;var weight=4
            for(dx in listOf(-size*.3,0.0,size*.3))for(dz in listOf(-size*.3,0.0,size*.3)) {
                if(dx==0.0&&dz==0.0)continue
                val neighbor=mosaicAt(x+dx,z+dz)
                if(neighbor.waterKind!=TerrainWater.NONE||neighbor.supportInfluence>=.18)continue
                if(broad.material==TerrainMaterial.SAND&&neighbor.material!=TerrainMaterial.SAND)continue
                sum+=neighbor.height;weight++
            }
            broad=broad.copy(height=TerrainMath.round(sum/weight))
        }
        if(broad.waterKind==TerrainWater.NONE){cells[key]=broad;return broad}
        var matching=0;val offset=size*.3
        for(dx in listOf(-offset,0.0,offset))for(dz in listOf(-offset,0.0,offset))if(at(x+dx,z+dz).waterKind==broad.waterKind)matching++
        val result=if(matching>=if(broad.waterKind==TerrainWater.LAKE)5 else 2)broad else landAt(x,z)
        cells[key]=result;return result
    }
    private data class BlendTarget(val weight:Double,val height:Double)
    private fun blendHeight(sample:TerrainSample,targets:List<BlendTarget>,coastSandClamp:Boolean=false):TerrainSample {
        var sum=0.0;var weights=0.0;var blend=0.0
        for((index,target)in targets.withIndex()) {
            val other=if(targets.size==2)targets[1-index].weight else 0.0
            val weight=if(target.weight==1.0&&other==1.0)1.0 else target.weight*(1-other)
            sum+=target.height*weight;weights+=weight;blend=max(blend,target.weight)
        }
        if(weights==0.0)return sample
        val height=TerrainMath.round(sample.height*(1-blend)+sum/weights*blend)
        return sample.copy(height=if(coastSandClamp)height.coerceIn(1.0,3.0)else height)
    }
    private fun nearTransition(sample:TerrainSample,x:Double,z:Double):TerrainSample {
        if(sample.waterKind!=TerrainWater.NONE||sample.supportInfluence>=.18)return sample
        val wx=TerrainMath.smooth(profile.near-16,profile.near-1,abs(x));val wz=TerrainMath.smooth(profile.near-16,profile.near-1,abs(z))
        if(wx==0.0&&wz==0.0)return sample
        val targets=ArrayList<BlendTarget>()
        for((weight,cx,cz)in listOf(Triple(wx,sign(x)*(profile.near+2),floor(z/4)*4+2),Triple(wz,floor(x/4)*4+2,sign(z)*(profile.near+2)))) {
            if(weight==0.0)continue
            val other=at(cx,cz);if(other.waterKind==TerrainWater.NONE&&other.supportInfluence<.18)targets+=BlendTarget(weight,other.height)
        }
        return blendHeight(sample,targets)
    }
    fun cellAt(x:Double,z:Double,size:Int):TerrainSample {
        check();if(size>=8)return coarseAt(x,z,size)
        val raw=at(x,z);val sample=if(size==2)nearTransition(raw,x,z)else raw
        val boundary=if(profile.refinedFar)profile.farFine else profile.middle
        val wx=TerrainMath.smooth(boundary-32,boundary-size/2.0,abs(x));val wz=TerrainMath.smooth(boundary-32,boundary-size/2.0,abs(z))
        if(wx==0.0&&wz==0.0||sample.waterKind!=TerrainWater.NONE||sample.supportInfluence>=.18)return sample
        val key=CellKey(TerrainCoordinate.at(x,z),size);cells[key]?.let{return it}
        fun snap(coordinate:Double)=floor(coordinate/profile.farCellSize)*profile.farCellSize+profile.farCellSize/2.0
        val targets=ArrayList<BlendTarget>()
        for((weight,cx,cz)in listOf(Triple(wx,sign(x)*(boundary+profile.farCellSize/2.0),snap(z)),Triple(wz,snap(x),sign(z)*(boundary+profile.farCellSize/2.0)))) {
            if(weight==0.0)continue
            val other=coarseAt(cx,cz,profile.farCellSize);if(other.waterKind!=TerrainWater.NONE)continue
            targets+=BlendTarget(weight,other.height)
        }
        val result=blendHeight(sample,targets,mosaic&&sample.material==TerrainMaterial.SAND);cells[key]=result;return result
    }
}
