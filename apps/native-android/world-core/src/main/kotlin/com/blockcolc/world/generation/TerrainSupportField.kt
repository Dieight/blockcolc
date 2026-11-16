package com.blockcolc.world.generation

import kotlin.math.*

internal data class TerrainBucket(val x:Int,val z:Int)
internal class TerrainCoordinate private constructor(val x:Double,val z:Double) {
    override fun equals(other:Any?)=other is TerrainCoordinate&&x==other.x&&z==other.z
    override fun hashCode()=31*x.hashCode()+z.hashCode()
    companion object {fun at(x:Double,z:Double)=TerrainCoordinate(if(x==0.0)0.0 else x,if(z==0.0)0.0 else z)}
}
internal data class TerrainSupportRect(val minX:Double,val maxX:Double,val minZ:Double,val maxZ:Double,val height:Double)
internal data class TerrainSupportSample(val influence:Double,val height:Double)

internal class TerrainSupportField(placements:List<VillagePlacement>,roads:List<RoadCell>,pads:List<TerrainPad>,private val roadDatum:(Double,Double)->Double) {
    val rects=placements.map{p->TerrainSupportRect(p.worldPosition.x-p.footprint.width/2-2,p.worldPosition.x+p.footprint.width/2+2,
        p.worldPosition.z-p.footprint.depth/2-2,p.worldPosition.z+p.footprint.depth/2+2,p.worldPosition.y)}+
        pads.map{TerrainSupportRect(it.x-it.width/2-2,it.x+it.width/2+2,it.z-it.depth/2-2,it.z+it.depth/2+2,it.groundLevel)}
    private val rectBuckets=if(rects.size>=8)HashMap<TerrainBucket,MutableList<TerrainSupportRect>>()else null
    private val roadBuckets=HashMap<TerrainBucket,MutableList<RoadCell>>()
    private val roadHeights=HashMap<TerrainCoordinate,Double>()
    var bench:ValleyBench?=null
    init {
        if(rectBuckets!=null)for(rect in rects)for(x in floor((rect.minX-38)/64).toInt()..floor((rect.maxX+38)/64).toInt())
            for(z in floor((rect.minZ-38)/64).toInt()..floor((rect.maxZ+38)/64).toInt())rectBuckets.getOrPut(TerrainBucket(x,z)){arrayListOf()}.add(rect)
        for(road in roads)roadBuckets.getOrPut(TerrainBucket(floor(road.x/24.0).toInt(),floor(road.z/24.0).toInt())){arrayListOf()}.add(road)
    }
    fun roadHeightAt(x:Double,z:Double)=roadHeights.getOrPut(TerrainCoordinate.at(x,z)){roadDatum(x,z)}
    fun sample(x:Double,z:Double):TerrainSupportSample {
        var influence=0.0;var height=VillageLayout.terrainHeightAt(x,z)
        val candidates=if(rectBuckets==null)rects else rectBuckets[TerrainBucket(floor(x/64).toInt(),floor(z/64).toInt())].orEmpty()
        for(rect in candidates) {
            val distance=hypot(maxOf(rect.minX-x,0.0,x-rect.maxX),maxOf(rect.minZ-z,0.0,z-rect.maxZ))
            if(distance>=38)continue
            val candidate=1-TerrainMath.smooth(3.0,38.0,distance)
            if(candidate>=influence){influence=candidate;height=rect.height}
        }
        val bucketX=floor(x/24).toInt();val bucketZ=floor(z/24).toInt()
        for(dx in -1..1)for(dz in -1..1)for(road in roadBuckets[TerrainBucket(bucketX+dx,bucketZ+dz)].orEmpty()) {
            val distance=hypot(x-road.x,z-road.z);if(distance>=18)continue
            val candidate=1-TerrainMath.smooth(2.0,18.0,distance)
            if(candidate>=influence){influence=candidate;height=roadHeightAt(road.x.toDouble(),road.z.toDouble())}
        }
        return TerrainSupportSample(influence,height)
    }
}

internal class ValleyBench(rects:List<TerrainSupportRect>,roads:List<RoadCell>,heightAt:(Double,Double)->Double) {
    private val bins=HashMap<TerrainBucket,MutableList<TerrainSupportRect>>()
    init {
        for(rect in rects)insert(rect,128.0)
        for(road in roads)insert(TerrainSupportRect(road.x-1.0,road.x+1.0,road.z-1.0,road.z+1.0,heightAt(road.x.toDouble(),road.z.toDouble())),38.0)
    }
    private fun insert(rect:TerrainSupportRect,radius:Double) {
        for(x in floor((rect.minX-radius)/64).toInt()..floor((rect.maxX+radius)/64).toInt())
            for(z in floor((rect.minZ-radius)/64).toInt()..floor((rect.maxZ+radius)/64).toInt())bins.getOrPut(TerrainBucket(x,z)){arrayListOf()}.add(rect)
    }
    fun at(x:Double,z:Double,seed:Int):TerrainSupportSample {
        var influence=0.0;var height=0.0
        for(rect in bins[TerrainBucket(floor(x/64).toInt(),floor(z/64).toInt())].orEmpty()) {
            val distance=hypot(maxOf(rect.minX-x,0.0,x-rect.maxX),maxOf(rect.minZ-z,0.0,z-rect.maxZ))
            val road=rect.maxX-rect.minX==2.0&&rect.maxZ-rect.minZ==2.0
            val reach=if(road)34.0 else 108+(TerrainMath.landscapeNoise(seed xor 0x157b,x,z,53.0)-.5)*24
            val weight=1-TerrainMath.smooth(3.0,reach,distance)
            if(weight>=influence){influence=weight;height=rect.height}
        }
        return TerrainSupportSample(influence,height)
    }
    fun shape(original:TerrainSample,x:Double,z:Double,seed:Int):TerrainSample {
        if(original.supportInfluence>=.995||original.waterKind!=TerrainWater.NONE||original.material==TerrainMaterial.DIRT)return original
        val support=at(x,z,seed)
        if(support.influence<=.001||support.height>=original.height)return original
        val weight=support.influence.pow(1.25)
        return original.copy(height=max(support.height,TerrainMath.round(original.height+(support.height-original.height)*weight)))
    }
}

data class ValleyCascadeSite(val x:Double,val z:Double,val xAxis:Boolean,val direction:Int,val low:Double)

object TerrainLandforms {
    fun cascades(radius:Double,seed:Int,heightAt:(Double,Double)->Double):List<ValleyCascadeSite> {
        val offset=(TerrainMath.landscapeNoise(seed xor 0x724a,radius,0.0,90.0)-.5)*24
        val sites=listOf(ValleyCascadeSite(TerrainMath.round((radius+72)/4)*4,TerrainMath.round((-radius*.18+offset)/4)*4,true,-1,0.0),
            ValleyCascadeSite(TerrainMath.round((-radius*.3-offset)/4)*4,TerrainMath.round((-radius-88)/4)*4,false,1,0.0))
        return sites.map{it.copy(low=heightAt(it.x,it.z).coerceIn(2.0,48.0))}
    }
    fun cascade(sample:TerrainSample,x:Double,z:Double,sites:List<ValleyCascadeSite>,includeWater:Boolean=true):TerrainSample {
        if(sample.supportInfluence>.02)return sample
        for(site in sites) {
            val p=((if(site.xAxis)x else z)-(if(site.xAxis)site.x else site.z))*site.direction
            val q=(if(site.xAxis)z else x)-(if(site.xAxis)site.z else site.x)
            val weight=(1-TerrainMath.smooth(14.0,30.0,abs(p)))*(1-TerrainMath.smooth(9.0,22.0,abs(q)))
            if(weight<=0)continue
            val step=1-TerrainMath.smooth(-2.0,2.0,p);val land=site.low+2+step*14
            if(includeWater&&p> -14&&p<15&&abs(q)<2.8+TerrainMath.smooth(0.0,9.0,p)*1.6)
                return sample.copy(height=TerrainMath.round(land-1),material=TerrainMaterial.WATER,waterKind=TerrainWater.RIVER)
            if(sample.waterKind!=TerrainWater.NONE)return sample
            return sample.copy(height=TerrainMath.round(sample.height+(land-sample.height)*weight),material=if(weight>.5&&abs(p)<6)TerrainMaterial.STONE else sample.material)
        }
        return sample
    }
    fun islandHill(distance:Double,radius:Double,height:Double,variation:Double,supportInfluence:Double):Double {
        val t=max(0.0,distance)/(radius*1.7);if(t>=1)return 0.0
        val fade=1-TerrainMath.smooth(.04,.72,supportInfluence)
        return (1-t*t).pow(2)*max(0.0,height*.68+variation*2.5)*fade
    }
    fun isletHeight(distance:Double,shore:Double,height:Double,ridge:Double):Double {
        val t=(distance/shore).coerceIn(0.0,1.0)
        return max(1.0,TerrainMath.round((1-t*t).pow(2)*height*(.65+ridge*.65)))
    }
    fun islandSurface(height:Double,distance:Double,landRadius:Double,coastWidth:Double,shoreWarp:Double,exposure:Double,supportInfluence:Double,
        x:Double,z:Double,seed:Int,original:TerrainMaterial):TerrainMaterial {
        if(supportInfluence>=.08)return original
        val detail=TerrainMath.landscapeNoise(seed xor 0x482a,x,z,17.0);val broad=TerrainMath.landscapeNoise(seed xor 0x72ba,x,z,42.0)
        val edge=distance-landRadius;val sandReach=3+max(0.0,1.08-shoreWarp)*coastWidth*3+(broad-.5)*4
        if(height>=18&&detail>.3)return TerrainMaterial.STONE
        if(exposure>.78&&edge> -1.5-exposure*2&&detail>.25)return TerrainMaterial.STONE
        if(edge> -sandReach)return TerrainMaterial.SAND
        return if(height>13&&broad>.72)TerrainMaterial.STONE else TerrainMaterial.GRASS
    }
}
