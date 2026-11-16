package com.blockcolc.world.generation

import java.text.Collator
import java.util.ArrayDeque
import java.util.Locale
import kotlin.math.*

internal data class DrainageCell(val key:TerrainBucket,val x:Double,val z:Double,val height:Double,val moisture:Double,val protectedInfluence:Double,
    var filledHeight:Double=Double.POSITIVE_INFINITY,var downstream:TerrainBucket?=null,var accumulation:Double=0.0)
internal data class DrainageLake(val id:Int,val cells:Set<TerrainBucket>,val waterLevel:Double,val centerX:Double,val centerZ:Double,val area:Double)
internal data class RiverSegment(val x1:Double,val z1:Double,val x2:Double,val z2:Double,val water1:Double,val water2:Double,val width1:Double,val width2:Double,val chain:Int)
internal data class HydrologySample(val kind:TerrainWater,val height:Double,val material:TerrainMaterial)

/** Priority-flood drainage is generation-local. Map/queue traversal and equal
 * influence ties preserve the formal producer's deterministic ordering. */
internal class TerrainHydrology(private val seed:Int,farExtent:Double,support:TerrainSupportField,private val checkpoint:()->Unit) {
    val step=8.0;val extent=TerrainMath.align(farExtent,8)
    private val minimum=-extent+step;private val maximum=extent-step
    private val cells=LinkedHashMap<TerrainBucket,DrainageCell>()
    private val lakes=ArrayList<DrainageLake>();private val lakeByCell=HashMap<TerrainBucket,DrainageLake>()
    private val segments=ArrayList<RiverSegment>();private val segmentBuckets=HashMap<TerrainBucket,MutableList<Int>>()
    val basinCount get()=lakes.size
    val segmentCount get()=segments.size
    val networkCount:Int
    val outletCount get()=networkCount
    val maxUphillWaterStep:Double
    private fun hash(channel:Int,key:TerrainBucket)=TerrainMath.hash(seed,channel,key.x.toDouble(),key.z.toDouble())
    private fun elevation(cell:DrainageCell)=cell.height+cell.protectedInfluence*48
    private fun neighbors(cell:DrainageCell):List<DrainageCell> {
        val result=ArrayList<DrainageCell>(8)
        for(dx in -1..1)for(dz in -1..1)if(dx!=0||dz!=0)cells[TerrainBucket(cell.key.x+dx,cell.key.z+dz)]?.let{result+=it}
        return result
    }
    init {
        var gx=0;var x=minimum
        while(x<=maximum) {
            checkpoint();var gz=0;var z=minimum
            while(z<=maximum) {
                val macro=TerrainMath.macro(x,z,seed);val protected=support.sample(x,z).influence;val key=TerrainBucket(gx,gz)
                cells[key]=DrainageCell(key,x,z,macro.height,plateMoisture(x,z,macro.moisture),protected)
                gz++;z+=step
            }
            gx++;x+=step
        }
        val queue=DrainageQueue();val queued=HashSet<TerrainBucket>()
        for(cell in cells.values) {
            if(cell.x!=minimum&&cell.x!=maximum&&cell.z!=minimum&&cell.z!=maximum)continue
            cell.filledHeight=elevation(cell);queue.push(QueueItem(cell.key,cell.filledHeight,hash(0x401,cell.key)));queued+=cell.key
        }
        var iterations=0
        while(queue.size>0) {
            if(iterations++%256==0)checkpoint()
            val current=cells.getValue(queue.pop().key)
            for(neighbor in neighbors(current)) {
                if(!queued.add(neighbor.key))continue
                neighbor.filledHeight=max(elevation(neighbor),current.filledHeight+.001);neighbor.downstream=current.key
                queue.push(QueueItem(neighbor.key,neighbor.filledHeight,hash(0x401,neighbor.key)))
            }
        }
        for(cell in cells.values)cell.accumulation=if(cell.protectedInfluence>=.12)0.0 else .35+((cell.moisture+1)/2).coerceIn(0.0,1.0)*1.65
        val order=cells.values.sortedWith(compareByDescending<DrainageCell>{it.filledHeight}.thenBy{hash(0x411,it.key)})
        for(cell in order)if(cell.accumulation>0)cell.downstream?.let{cells.getValue(it).accumulation+=cell.accumulation}
        for(component in collectLakes()) {
            if(lakes.size>=1)break
            if(lakes.any{hypot(it.centerX-component.centerX,it.centerZ-component.centerZ)<72})continue
            val lake=component.copy(id=lakes.size);lakes+=lake;for(key in lake.cells)lakeByCell[key]=lake
        }
        val minimumAccumulation=80.0
        val channels=cells.values.filter{it.accumulation>=minimumAccumulation&&it.protectedInfluence<.08&&it.key !in lakeByCell&&(it.moisture>-.58||it.accumulation>=minimumAccumulation*4)}
        val outletMemo=HashMap<TerrainBucket,String>();val grouped=LinkedHashMap<String,MutableList<DrainageCell>>()
        for(cell in channels) {
            val downstream=cell.downstream?.let(cells::get)?:continue
            if(downstream.protectedInfluence>=.18)continue
            grouped.getOrPut(outlet(cell,outletMemo)){arrayListOf()}.add(cell)
        }
        val collator=Collator.getInstance(Locale.US)
        val networks=grouped.entries.filter{it.value.size>=4}.sortedWith { left,right ->
            val bySize=right.value.maxOf{it.accumulation}.compareTo(left.value.maxOf{it.accumulation})
            if(bySize!=0)bySize else collator.compare(left.key,right.key)
        }.take(2)
        for((chain,network)in networks.withIndex()) {
            checkpoint();val memberKeys=network.value.mapTo(HashSet()){it.key}
            for(cell in network.value) {
                val downstream=cell.downstream?.let(cells::get)?:continue
                if(downstream.protectedInfluence>=.18)continue
                if(downstream.key !in memberKeys&&downstream.key !in lakeByCell&&downstream.accumulation<minimumAccumulation)continue
                segments+=segment(cell,downstream,chain,minimumAccumulation)
            }
        }
        if(segments.isEmpty()) {
            var current=cells.values.filter{it.protectedInfluence<.08&&it.key !in lakeByCell}.sortedByDescending{it.accumulation}.firstOrNull()
            val seen=HashSet<TerrainBucket>()
            while(current!=null&&current.downstream!=null&&segments.size<96&&seen.add(current.key)) {
                val downstream=cells.getValue(current.downstream!!);if(downstream.protectedInfluence>=.18)break
                segments+=segment(current,downstream,0,minimumAccumulation)
                if(downstream.key in lakeByCell)break
                current=downstream
            }
        }
        for((index,segment)in segments.withIndex()) {
            val padding=max(segment.width1,segment.width2)+5
            for(bx in floor((min(segment.x1,segment.x2)-padding)/32).toInt()..floor((max(segment.x1,segment.x2)+padding)/32).toInt())
                for(bz in floor((min(segment.z1,segment.z2)-padding)/32).toInt()..floor((max(segment.z1,segment.z2)+padding)/32).toInt())
                    segmentBuckets.getOrPut(TerrainBucket(bx,bz)){arrayListOf()}.add(index)
        }
        networkCount=segments.map{it.chain}.toSet().size
        maxUphillWaterStep=segments.fold(0.0){maximum,segment->max(maximum,segment.water2-segment.water1)}
        checkpoint()
    }

    private fun plateMoisture(x:Double,z:Double,base:Double):Double {
        val scale=192.0;val baseX=floor(x/scale);val baseZ=floor(z/scale);var nearest=Double.POSITIVE_INFINITY;var plate=0.0
        for(dx in -1..1)for(dz in -1..1) {
            val px=baseX+dx;val pz=baseZ+dz
            val jitterX=(TerrainMath.hash(seed,0x421,px,pz)/4294967295.0-.5)*scale*.58
            val jitterZ=(TerrainMath.hash(seed,0x422,px,pz)/4294967295.0-.5)*scale*.58
            val distance=hypot(x-((px+.5)*scale+jitterX),z-((pz+.5)*scale+jitterZ))
            if(distance>=nearest)continue
            nearest=distance;plate=TerrainMath.hash(seed,0x423,px,pz)/4294967295.0*2-1
        }
        return (base*.74+plate*.26).coerceIn(-1.0,1.0)
    }
    private fun collectLakes():List<DrainageLake> {
        val candidates=cells.values.filter{it.filledHeight-elevation(it)>=1.25&&it.protectedInfluence<.08&&it.moisture>-.32}.mapTo(LinkedHashSet()){it.key}
        val components=ArrayList<Pair<List<DrainageCell>,Double>>()
        while(candidates.isNotEmpty()) {
            checkpoint();val first=candidates.first();candidates.remove(first)
            val queue=ArrayDeque<DrainageCell>();queue.add(cells.getValue(first));val members=ArrayList<DrainageCell>()
            while(queue.isNotEmpty()) {
                val current=queue.removeFirst();members+=current
                for(neighbor in neighbors(current))if(candidates.remove(neighbor.key))queue.add(neighbor)
            }
            if(members.size<4)continue
            val wetness=members.sumOf{it.moisture}/members.size
            components+=members to (min(180,members.size)*(1.2+wetness*.35))
        }
        if(components.isEmpty()) {
            val fallback=cells.values.filter{it.protectedInfluence<.06&&it.moisture>-.35}
                .sortedWith(compareBy<DrainageCell>{it.height}.thenBy{hash(0x431,it.key)}).firstOrNull()
            if(fallback!=null)components+=(listOf(fallback)+neighbors(fallback).filter{it.height<=fallback.height+1}.take(7)) to 1.0
        }
        return components.sortedByDescending{it.second}.mapNotNull { (members,_) ->
            val centerX=members.sumOf{it.x}/members.size;val centerZ=members.sumOf{it.z}/members.size
            val limited=members.sortedBy{hypot(it.x-centerX,it.z-centerZ)}.take(128)
            val spill=floor(limited.sumOf{it.filledHeight}/limited.size).coerceIn(1.0,10.0)
            val submerged=limited.filter{it.height<spill};val selected=if(submerged.size>=4)submerged else limited.take(min(8,limited.size))
            if(selected.size<4)null else DrainageLake(-1,selected.mapTo(LinkedHashSet()){it.key},max(spill,selected.minOf{it.height}+1),centerX,centerZ,selected.size*64.0)
        }
    }
    private fun outlet(start:DrainageCell,memo:MutableMap<TerrainBucket,String>):String {
        memo[start.key]?.let{return it}
        val path=ArrayList<TerrainBucket>();val seen=HashSet<TerrainBucket>();var current:DrainageCell?=start
        fun edge(key:TerrainBucket)="edge:${key.x}:${key.z}"
        var outlet=edge(start.key)
        while(current!=null&&seen.add(current.key)) {
            val known=memo[current.key];if(known!=null){outlet=known;break}
            path+=current.key
            val lake=lakeByCell[current.key];if(lake!=null){outlet="lake:${lake.id}";break}
            val downstream=current.downstream;if(downstream==null){outlet=edge(current.key);break}
            current=cells[downstream]
        }
        for(key in path)memo[key]=outlet
        return outlet
    }
    private fun segment(cell:DrainageCell,downstream:DrainageCell,chain:Int,minimumAccumulation:Double):RiverSegment {
        fun point(c:DrainageCell)=Position2(c.x+(hash(0x441,c.key)/4294967295.0*2-1)*1.55,c.z+(hash(0x442,c.key)/4294967295.0*2-1)*1.55)
        fun width(accumulation:Double)= (1.15+log2(1+accumulation/minimumAccumulation)*.65).coerceIn(1.3,4.5)
        val start=point(cell);val end=point(downstream)
        val rawStart=max(0.0,min(cell.height-1,floor(cell.filledHeight)-1))
        val rawEnd=lakeByCell[downstream.key]?.waterLevel?:max(0.0,min(downstream.height-1,floor(downstream.filledHeight)-1))
        val water2=min(rawStart,rawEnd)
        return RiverSegment(start.x,start.z,end.x,end.z,max(water2,rawStart),water2,width(cell.accumulation),width(downstream.accumulation),chain)
    }
    fun sample(x:Double,z:Double,baseHeight:Double):HydrologySample {
        val gx=TerrainMath.round((x-minimum)/step).toInt();val gz=TerrainMath.round((z-minimum)/step).toInt()
        var nearestLake:DrainageLake?=null;var lakeDistance=Double.POSITIVE_INFINITY
        for(dx in -1..1)for(dz in -1..1) {
            val key=TerrainBucket(gx+dx,gz+dz);val lake=lakeByCell[key]?:continue;val cell=cells[key]?:continue
            val distance=hypot(x-cell.x,z-cell.z)
            if(nearestLake==null||distance<lakeDistance){lakeDistance=distance;nearestLake=lake}
        }
        if(nearestLake!=null) {
            val shore=TerrainMath.fractal(x*.055,z*.055,seed,0x451);val radius=step*(.64+shore*.07)
            if(lakeDistance<=radius)return HydrologySample(TerrainWater.LAKE,nearestLake.waterLevel,TerrainMaterial.WATER)
            val bankRadius=radius+4.2
            if(lakeDistance<=bankRadius) {
                val bank=TerrainMath.smooth(radius,bankRadius,lakeDistance)
                return HydrologySample(TerrainWater.NONE,TerrainMath.round((nearestLake.waterLevel+1)*(1-bank)+baseHeight*bank),TerrainMaterial.DIRT)
            }
        }
        var nearest=Double.POSITIVE_INFINITY;var width=0.0;var level=0.0
        for(index in segmentBuckets[TerrainBucket(floor(x/32).toInt(),floor(z/32).toInt())].orEmpty()) {
            val segment=segments[index];val dx=segment.x2-segment.x1;val dz=segment.z2-segment.z1;val length=dx*dx+dz*dz
            val alpha=if(length==0.0)0.0 else (((x-segment.x1)*dx+(z-segment.z1)*dz)/length).coerceIn(0.0,1.0)
            val distance=hypot(x-(segment.x1+dx*alpha),z-(segment.z1+dz*alpha))
            if(distance>=nearest)continue
            nearest=distance;level=segment.water1+(segment.water2-segment.water1)*alpha;width=segment.width1+(segment.width2-segment.width1)*alpha
        }
        if(nearest==Double.POSITIVE_INFINITY)return HydrologySample(TerrainWater.NONE,baseHeight,TerrainMaterial.GRASS)
        val water=max(0.0,min(baseHeight,TerrainMath.round(level)))
        if(nearest<=width)return HydrologySample(TerrainWater.RIVER,water,TerrainMaterial.WATER)
        val bankWidth=3.8+min(2.2,width*.35)
        if(nearest<=width+bankWidth) {
            val bank=TerrainMath.smooth(width,width+bankWidth,nearest)
            return HydrologySample(TerrainWater.NONE,TerrainMath.round((water+1)*(1-bank)+baseHeight*bank),TerrainMaterial.DIRT)
        }
        return HydrologySample(TerrainWater.NONE,baseHeight,TerrainMaterial.GRASS)
    }

    private data class QueueItem(val key:TerrainBucket,val height:Double,val tie:Long)
    private class DrainageQueue {
        private val items=ArrayList<QueueItem>();val size get()=items.size
        private fun before(a:QueueItem,b:QueueItem)=a.height<b.height||a.height==b.height&&a.tie<=b.tie
        fun push(item:QueueItem) {
            items.add(item);var index=items.lastIndex
            while(index>0) {val parent=(index-1)/2;if(before(items[parent],item))break;items[index]=items[parent];index=parent}
            items[index]=item
        }
        fun pop():QueueItem {
            val first=items[0];val last=items.removeAt(items.lastIndex);if(items.isEmpty())return first
            var index=0
            while(true) {
                val left=index*2+1;val right=left+1;if(left>=items.size)break
                val next=if(right<items.size&&before(items[right],items[left]))right else left
                if(before(last,items[next]))break
                items[index]=items[next];index=next
            }
            items[index]=last;return first
        }
    }
}
