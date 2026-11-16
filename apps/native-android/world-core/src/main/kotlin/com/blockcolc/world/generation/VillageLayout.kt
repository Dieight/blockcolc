package com.blockcolc.world.generation

import java.text.Collator
import java.util.Locale
import java.util.concurrent.CancellationException
import kotlin.math.*

data class FootprintBounds(val minX:Long,val maxX:Long,val minZ:Long,val maxZ:Long){
    constructor(minX:Int,maxX:Int,minZ:Int,maxZ:Int):this(minX.toLong(),maxX.toLong(),minZ.toLong(),maxZ.toLong())
    init{require(minX<=maxX&&minZ<=maxZ&&listOf(minX,maxX,minZ,maxZ).all{it in -9_007_199_254_740_991L..9_007_199_254_740_991L})}
    val width get()=maxX-minX+1
    val depth get()=maxZ-minZ+1
}
data class Position2(val x:Double,val z:Double)
data class Position3(val x:Double,val y:Double,val z:Double)
data class Footprint(val width:Double,val depth:Double)
data class RoadCell(val x:Int,val z:Int)
data class VillageInput(val settlementIndex:Long,val bounds:FootprintBounds)
data class VillagePlacement(val settlementIndex:Long,val worldPosition:Position3,val rotationY:Double,val footprint:Footprint,val blueprintOffset:Position2,val entrance:RoadCell)
data class DecorationInput(val rewardId:String,val resourceId:String,val date:String,val projectId:String,val bounds:FootprintBounds,val localPosition:Position2,val quarterTurns:Int){
    init{require(quarterTurns in 0..3&&localPosition.x.isFinite()&&localPosition.z.isFinite())}
}
data class DecorationHost(val projectId:String,val placement:VillagePlacement)
data class DecorationPlacement(val input:DecorationInput,val worldPosition:Position3,val rotationY:Double,val footprint:Footprint,val blueprintOffset:Position2)

/** V4 spatial layout from the actual blueprint bounds. No fixture count,
 * prebuilt world or progress threshold participates in placement. Coordinates
 * stay Double until the renderer boundary. Cancellation never adopts a partial
 * village; this computation belongs on a generation worker, not the writer. */
object VillageLayout {
    private data class Rect(val minX:Double,val maxX:Double,val minZ:Double,val maxZ:Double)
    private fun checkpoint(cancelled:()->Boolean){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("World generation superseded")}
    fun generate(inputs:List<VillageInput>,cancelled:()->Boolean={false}):List<VillagePlacement>{
        checkpoint(cancelled)
        require(inputs.all{it.settlementIndex in 0..9_007_199_254_740_991L}){"Invalid settlement index"}
        val byIndex=inputs.associateBy{it.settlementIndex};require(byIndex.size==inputs.size){"Duplicate settlement index"}
        if(inputs.isEmpty())return emptyList()
        val placements=HashMap<Long,VillagePlacement>();val occupied=ArrayList<Rect>()
        for(index in 0..byIndex.keys.max()){
            checkpoint(cancelled)
            val source=byIndex[index]?.bounds
            val sourceWidth=source?.width?.toDouble()?:13.0;val sourceDepth=source?.depth?.toDouble()?:13.0
            val offset=source?.let{Position2(-(it.minX+it.maxX)/2.0,-(it.minZ+it.maxZ)/2.0)}?:Position2(0.0,0.0)
            var candidateIndex=0L
            while(true){
                if(candidateIndex%64==0L)checkpoint(cancelled)
                val candidate=spiral(candidateIndex++)
                val rotation=rotation(candidate.x,candidate.z);val turn=abs(sin(rotation))>.5
                val width=if(turn)sourceDepth else sourceWidth;val depth=if(turn)sourceWidth else sourceDepth
                val rect=rect(candidate.x,candidate.z,width,depth)
                if(occupied.any{overlap(rect,it,3.0)})continue
                occupied+=rect
                if(source!=null){
                    val entranceDistance=depth/2+2
                    placements[index]=VillagePlacement(index,Position3(candidate.x,terrainHeightAt(candidate.x,candidate.z),candidate.z),rotation,Footprint(width,depth),offset,
                        RoadCell(jsRoundInt(candidate.x+sin(rotation)*entranceDistance),jsRoundInt(candidate.z+cos(rotation)*entranceDistance)))
                }
                break
            }
        }
        return inputs.map{placements.getValue(it.settlementIndex)}
    }
    fun roads(placements:List<VillagePlacement>,cancelled:()->Boolean={false}):List<RoadCell>{
        checkpoint(cancelled)
        val cells=LinkedHashSet<RoadCell>();val plaza=plaza(placements)
        for(x in plaza.x-2..plaza.x+2)for(z in plaza.z-2..plaza.z+2)cells+=RoadCell(x,z)
        val blocked=HashSet<RoadCell>()
        for(p in placements){
            checkpoint(cancelled)
            val r=rect(p.worldPosition.x,p.worldPosition.z,p.footprint.width,p.footprint.depth)
            for(x in floor(r.minX-1).toInt()..ceil(r.maxX+1).toInt())for(z in floor(r.minZ-1).toInt()..ceil(r.maxZ+1).toInt())blocked+=RoadCell(x,z)
        }
        for(p in placements){
            checkpoint(cancelled)
            val points=path(p.entrance,plaza,blocked,p.settlementIndex,cancelled)
            for(index in points.indices){
                val point=points[index];cells+=point
                val before=points[maxOf(0,index-1)];val after=points[minOf(points.lastIndex,index+1)]
                if(before.x!=after.x){cells+=RoadCell(point.x,point.z-1);cells+=RoadCell(point.x,point.z+1)}
                else{cells+=RoadCell(point.x-1,point.z);cells+=RoadCell(point.x+1,point.z)}
            }
        }
        return cells.sortedWith(compareBy<RoadCell>{it.x}.thenBy{it.z})
    }
    fun plaza(placements:List<VillagePlacement>):RoadCell{
        val core=placements.minByOrNull{it.settlementIndex}?:return RoadCell(0,0)
        val dx=sign(core.entrance.x-core.worldPosition.x).toInt();val dz=sign(core.entrance.z-core.worldPosition.z).toInt()
        return RoadCell(core.entrance.x+dx*3,core.entrance.z+dz*3)
    }
    fun decorations(inputs:List<DecorationInput>,hosts:List<DecorationHost>,roads:List<RoadCell>,cancelled:()->Boolean={false}):List<DecorationPlacement>{
        checkpoint(cancelled)
        val byProject=hosts.associateBy{it.projectId}
        val occupied=hosts.map{rect(it.placement.worldPosition.x,it.placement.worldPosition.z,it.placement.footprint.width+2,it.placement.footprint.depth+2)}.toMutableList()
        val roadKeys=roads.toHashSet();val result=ArrayList<DecorationPlacement>()
        val collator=Collator.getInstance(Locale.US)
        for(input in inputs.sortedWith{a,b->collator.compare(a.rewardId,b.rewardId)}){
            checkpoint(cancelled)
            val host=byProject[input.projectId]?.placement?:continue
            val cos=cos(host.rotationY);val sin=sin(host.rotationY)
            val intended=Position2(host.worldPosition.x+input.localPosition.x*cos+input.localPosition.z*sin,
                host.worldPosition.z-input.localPosition.x*sin+input.localPosition.z*cos)
            val rotation=host.rotationY+input.quarterTurns*PI/2;val turn=abs(kotlin.math.sin(rotation))>.5
            val width=(if(turn)input.bounds.depth else input.bounds.width).toDouble();val depth=(if(turn)input.bounds.width else input.bounds.depth).toDouble()
            var index=0L
            while(true){
                if(index%64==0L)checkpoint(cancelled)
                val offset=spiral(index++);val x=intended.x+offset.x;val z=intended.z+offset.z;val rect=rect(x,z,width,depth)
                if(occupied.any{overlap(rect,it,1.0)}||roadIntersects(rect,roadKeys))continue
                occupied+=rect
                result+=DecorationPlacement(input,Position3(x,terrainHeightAt(x,z),z),rotation,Footprint(width,depth),
                    Position2(-(input.bounds.minX+input.bounds.maxX)/2.0,-(input.bounds.minZ+input.bounds.maxZ)/2.0))
                break
            }
        }
        return result
    }
    fun terrainHeightAt(x:Double,z:Double):Double{
        require(x.isFinite()&&z.isFinite())
        val distance=hypot(x*.92,z)
        val broad=sin(x*.075+z*.032)*1.25+cos(z*.09-x*.022)*.9
        val local=((stableHash("hill:${jsRound(x/7)}:${jsRound(z/7)}")%7)-3)*.22
        val axis=sin(x*.065)*5.5+cos(x*.018)*2.5
        val cut=if(abs(z-axis)<1.15&&distance>13)1.35 else 0.0
        val adjusted=distance+broad+local-cut
        return when{adjusted<10->3.0;adjusted<20->2.0;adjusted<34->1.0;else->0.0}
    }
    private fun spiral(index:Long):Position2{
        if(index==0L)return Position2(0.0,0.0)
        val ring=ceil((sqrt(index+1.0)-1)/2).toLong();val side=ring*2;val first=(side-1)*(side-1);val offset=index-first
        val point=when{offset<side->(-ring+offset) to -ring;offset<side*2->ring to (-ring+offset-side)
            offset<side*3->(ring-offset+side*2) to ring;else->-ring to (ring-offset+side*3)}
        return Position2(point.first*4.0,point.second*4.0)
    }
    private fun rotation(x:Double,z:Double):Double=when{
        x==0.0&&z==0.0->0.0;abs(x)>abs(z)->if(x>0)-PI/2 else PI/2;z>0->PI;else->0.0
    }
    private fun rect(x:Double,z:Double,width:Double,depth:Double)=Rect(x-width/2,x+width/2,z-depth/2,z+depth/2)
    private fun overlap(a:Rect,b:Rect,gap:Double)=a.minX<b.maxX+gap&&a.maxX+gap>b.minX&&a.minZ<b.maxZ+gap&&a.maxZ+gap>b.minZ
    private fun roadIntersects(rect:Rect,roads:Set<RoadCell>):Boolean{
        for(x in floor(rect.minX-1).toInt()..ceil(rect.maxX+1).toInt())for(z in floor(rect.minZ-1).toInt()..ceil(rect.maxZ+1).toInt())if(RoadCell(x,z)in roads)return true
        return false
    }
    private fun path(start:RoadCell,goal:RoadCell,blocked:Set<RoadCell>,seed:Long,cancelled:()->Boolean):List<RoadCell>{
        val limit=maxOf(abs(start.x),abs(start.z),abs(goal.x),abs(goal.z))+18
        val queue=java.util.ArrayDeque<RoadCell>();queue.add(start)
        val parents=HashMap<RoadCell,RoadCell?>();parents[start]=null
        val directions=if(stableHash("road:$seed")%2==0L)listOf(RoadCell(1,0),RoadCell(-1,0),RoadCell(0,1),RoadCell(0,-1))
            else listOf(RoadCell(0,1),RoadCell(0,-1),RoadCell(1,0),RoadCell(-1,0))
        var popped=0
        while(queue.isNotEmpty()&&!parents.containsKey(goal)){
            if(popped++%512==0)checkpoint(cancelled)
            val current=queue.removeFirst()
            for(direction in directions){
                val next=RoadCell(current.x+direction.x,current.z+direction.z)
                if(abs(next.x)>limit||abs(next.z)>limit||parents.containsKey(next))continue
                if(next in blocked&&next!=start&&next!=goal)continue
                parents[next]=current;queue.addLast(next)
            }
        }
        if(!parents.containsKey(goal))return listOf(start)
        val reversed=ArrayList<RoadCell>();var next:RoadCell?=goal
        while(next!=null){reversed+=next;next=parents[next]}
        return reversed.asReversed()
    }
    private fun stableHash(value:String):Long{var hash=0x811c9dc5.toInt();for(char in value)hash=(hash xor char.code)*0x01000193;return hash.toLong() and 0xffff_ffffL}
    private fun jsRound(value:Double)=floor(value+.5).toLong()
    private fun jsRoundInt(value:Double):Int{val rounded=jsRound(value);require(rounded in Int.MIN_VALUE.toLong()..Int.MAX_VALUE.toLong()){"World coordinate exceeds grid range"};return rounded.toInt()}
}
