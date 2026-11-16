package com.blockcolc.world.generation

import java.security.MessageDigest
import java.util.Collections
import java.util.Locale
import java.util.concurrent.CancellationException
import kotlin.math.*

data class VinePosition(val x:Double,val y:Double,val z:Double,val axis:String)
data class PistonResolution(val sourceIndex:Int,val displayIndex:Int)
data class PistonOmission(val sourceIndex:Int,val reason:String)
class PistonDisplay internal constructor(voxels:List<RenderVoxel>,resolved:List<PistonResolution>,unresolved:List<PistonOmission>){
    val voxels:List<RenderVoxel> = Collections.unmodifiableList(voxels.toList())
    val resolved:List<PistonResolution> = Collections.unmodifiableList(resolved.toList())
    val unresolved:List<PistonOmission> = Collections.unmodifiableList(unresolved.toList())
}
/** Reusable selection/condition/occlusion input, NOT an already-created mesh.
 * Resource model geometry and GPU resources get their own cache identities. */
class BuildingInputRecipe internal constructor(val key:String,val blueprintGeometrySha:String,intact:List<RenderVoxel>,missing:List<RenderVoxel>,vines:List<VinePosition>,
    val weathering:Double,val pistonDisplay:PistonDisplay,private val occlusion:FloatArray,private val faceWords:IntArray){
    val intact:List<RenderVoxel> = Collections.unmodifiableList(intact.toList())
    val missing:List<RenderVoxel> = Collections.unmodifiableList(missing.toList())
    val vines:List<VinePosition> = Collections.unmodifiableList(vines.toList())
    fun occlusion(index:Int)=occlusion[index]
    fun faceWord(index:Int)=faceWords[index]
}

object BuildingPreparation {
    const val REVISION=1
    private val headKeys=setOf("facing","type","short");private val baseKeys=setOf("facing","extended")
    private fun checkpoint(cancelled:()->Boolean){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Building preparation superseded")}
    private fun frozen(properties:Map<String,String>)=Collections.unmodifiableMap(properties.toSortedMap())
    /** Generated scenery/foundations already have immutable source voxels and
     * no construction or corruption phase. Shared neighbors keep AO coherent
     * across tree chunks and the separate landmark silhouette/detail layers. */
    fun staticStructure(voxels:List<RenderVoxel>,key:String,neighbors:List<RenderVoxel> = voxels,cancelled:()->Boolean={false}):BuildingInputRecipe {
        return StaticStructurePreparation(neighbors,cancelled).prepare(voxels,key,cancelled)
    }
    fun key(blueprint:BlueprintSnapshot,projectId:String,completion:Int,condition:Int):String{
        require(completion in 0..10000&&condition in 0..10000)
        val input="building-input-$REVISION\n${blueprint.geometrySha}\n${SourceNumbers.quoted(projectId)}\n$completion\n$condition"
        return MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it.toInt() and 255)}
    }
    fun pistonDisplay(source:List<RenderVoxel>,cancelled:()->Boolean={false}):PistonDisplay{
        val voxels=ArrayList<RenderVoxel>();val resolved=ArrayList<PistonResolution>();val omitted=ArrayList<PistonOmission>()
        for((index,voxel)in source.withIndex()){
            if(index%256==0)checkpoint(cancelled)
            if(voxel.sourceBlockId!="minecraft:moving_piston"){voxels+=voxel;continue}
            val moved=voxel.movingPistonMovedState
            if(moved==null){omitted+=PistonOmission(index,"missing_moved_state");continue}
            val pose=voxel.movingPistonPose;var id=moved.blockId;var properties=moved.properties;var additional:RenderVoxel?=null
            if(pose!=null){
                val values=properties;val facing=values?.get("facing")
                val validFacing=BlockFacing.entries.any{it.key==facing}
                if(id=="minecraft:piston_head"&&values!=null&&validFacing&&values["type"] in setOf("default","sticky")&&values.keys.all{it in headKeys}&&
                    (values["short"]==null||values["short"] in setOf("true","false")))properties=frozen(values+("short" to (pose.progress<=.5).toString()))
                else if(pose.source&&!pose.extending&&id in setOf("minecraft:piston","minecraft:sticky_piston")&&values!=null&&validFacing&&values.keys.all{it in baseKeys}&&
                    (values["extended"]==null||values["extended"] in setOf("true","false"))){
                    additional=voxel.copy(sourceBlockId=id,sourceBlockState=frozen(values+("extended" to "true")),movingPistonMovedState=null,movingPistonPose=null)
                    properties=frozen(mapOf("facing" to facing!!,"type" to if(id=="minecraft:sticky_piston")"sticky"else"default","short" to (pose.progress>=.5).toString()))
                    id="minecraft:piston_head"
                }
            }
            val distance=pose?.let{if(it.extending)it.progress-1 else 1-it.progress}?:0.0
            val display=voxel.copy(x=voxel.x+(pose?.facing?.dx?:0)*distance,y=voxel.y+(pose?.facing?.dy?:0)*distance,z=voxel.z+(pose?.facing?.dz?:0)*distance,
                sourceBlockId=id,sourceBlockState=properties,movingPistonMovedState=null,movingPistonPose=null)
            resolved+=PistonResolution(index,voxels.size);voxels+=display;additional?.let{voxels+=it}
        }
        checkpoint(cancelled)
        return PistonDisplay(voxels,resolved,omitted)
    }
    fun prepare(blueprint:BlueprintSnapshot,projectId:String,completion:Int,condition:Int,cancelled:()->Boolean={false}):BuildingInputRecipe{
        require(completion in 0..10000&&condition in 0..10000)
        checkpoint(cancelled)
        val display=pistonDisplay(blueprint.voxels,cancelled);val damage=10000-condition;val threshold=floor(damage*.18).toLong()
        val intact=ArrayList<RenderVoxel>();val missing=ArrayList<RenderVoxel>()
        for((index,v)in display.voxels.withIndex()){
            if(index%256==0)checkpoint(cancelled)
            if(v.buildOrder>completion)continue
            val roll=SourceNumbers.fnv32("damage:$projectId:${SourceNumbers.text(v.x)}:${SourceNumbers.text(v.y)}:${SourceNumbers.text(v.z)}")%10000
            if(v.buildOrder>1800&&v.y>0&&roll<threshold)missing+=v else intact+=v
        }
        val vineCount=if(damage==0)0 else minOf(12,maxOf(1,ceil(damage/850.0).toInt()))
        val vines=if(vineCount==0)emptyList()else intact.asSequence().filter{it.y>1&&it.buildOrder>1800}.map{v->
            v to SourceNumbers.fnv32("vine:$projectId:${SourceNumbers.text(v.x)}:${SourceNumbers.text(v.y)}:${SourceNumbers.text(v.z)}")
        }.sortedBy{it.second}.take(vineCount).map{(v,rank)->
            val xAxis=(rank and 1L)==0L;val side=if((rank and 2L)==0L)-.51 else .51
            VinePosition(v.x+if(xAxis)side else 0.0,v.y,v.z+if(xAxis)0.0 else side,if(xAxis)"x"else"z")
        }.toList()
        val field=LocalBlockOcclusion(intact);val occlusion=FloatArray(intact.size);val faceWords=IntArray(intact.size)
        for((index,v)in intact.withIndex()){
            if(index%256==0)checkpoint(cancelled)
            val levels=field.levels(v);var count=0;var sum=0;var maximum=0;var word=0
            for(face in 0..5){word=word or(levels[face] shl(face*2));if(!field.normalOccupied(v,face)){sum+=levels[face];maximum=maxOf(maximum,levels[face]);count++}}
            faceWords[index]=word
            occlusion[index]=if(count==0)0f else (maximum/3.0*.65+sum.toDouble()/count/3*.35).toFloat()
        }
        checkpoint(cancelled)
        return BuildingInputRecipe(key(blueprint,projectId,completion,condition),blueprint.geometrySha,intact,missing,vines,damage/10000.0,display,occlusion,faceWords)
    }
}

/** One generation-local neighbor index can serve all tree spatial batches.
 * It is not a persistent cache and does not retain business documents. */
class StaticStructurePreparation(neighbors:List<RenderVoxel>,cancelled:()->Boolean={false}) {
    private val field:LocalBlockOcclusion
    private fun check(cancelled:()->Boolean){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Static structure superseded")}
    init {check(cancelled);require(neighbors.size<=1_000_000);field=LocalBlockOcclusion(neighbors);check(cancelled)}
    fun prepare(voxels:List<RenderVoxel>,key:String,cancelled:()->Boolean={false}):BuildingInputRecipe {
        check(cancelled);require(key.isNotEmpty()&&voxels.size<=1_000_000);val ao=FloatArray(voxels.size);val words=IntArray(voxels.size)
        for((index,v)in voxels.withIndex()){
            if(index%128==0)check(cancelled);val levels=field.levels(v);var count=0;var sum=0;var maximum=0;var word=0
            for(face in 0..5){word=word or(levels[face] shl(face*2));if(!field.normalOccupied(v,face)){sum+=levels[face];maximum=maxOf(maximum,levels[face]);count++}}
            words[index]=word;ao[index]=if(count==0)0f else(maximum/3.0*.65+sum.toDouble()/count/3*.35).toFloat()
        }
        check(cancelled);return BuildingInputRecipe(key,key,voxels,emptyList(),emptyList(),0.0,PistonDisplay(voxels,emptyList(),emptyList()),ao,words)
    }
}

/** Same six-face sampling as the formal renderer. Integer fields use bounded
 * numeric cells; fractional piston positions retain exact membership instead
 * of rounding them into neighboring solid blocks. */
internal class LocalBlockOcclusion(voxels:List<RenderVoxel>){
    val minimumY=voxels.minOfOrNull{it.y}?:0.0
    private val minimumX=voxels.minOfOrNull{it.x}?:0.0;private val minimumZ=voxels.minOfOrNull{it.z}?:0.0
    private val maximumX=voxels.maxOfOrNull{it.x}?:0.0;private val maximumY=voxels.maxOfOrNull{it.y}?:0.0;private val maximumZ=voxels.maxOfOrNull{it.z}?:0.0
    private val spanY=maximumY-minimumY+1;private val spanZ=maximumZ-minimumZ+1;private val strideX=spanY*spanZ
    private val volume=(maximumX-minimumX+1)*strideX
    private val numeric=voxels.isNotEmpty()&&volume>0&&safeInteger(volume)&&voxels.all{safeInteger(it.x)&&safeInteger(it.y)&&safeInteger(it.z)}
    // Dense buildings need one bit per cell, not a boxed Long per block and
    // per neighbor probe. Sparse scenery and fractional pistons borrow the
    // immutable input through the compact exact-coordinate index instead.
    private val dense=if(numeric&&volume<=64.0*minOf(1_048_576L,maxOf(64L,voxels.size.toLong()*2)))LongArray((ceil(volume/64)).toInt())else null
    private val sparse:VoxelCoordinateIndex?
    init{
        val classes=HashMap<String,Boolean>()
        fun transparentPart(value:String):Boolean=classes[value]?:transparent.containsMatchIn(value.lowercase(Locale.ROOT)).also{if(classes.size<1024)classes[value]=it}
        fun full(v:RenderVoxel)=!transparentPart(v.sourceBlockId?:"")&&!transparentPart(v.materialId)
        if(dense!=null){
            for(v in voxels)if(full(v)){val at=index(v.x,v.y,v.z);val word=(at ushr 6).toInt();dense[word]=dense[word] or(1L shl(at.toInt() and 63))}
            sparse=null
        }else sparse=VoxelCoordinateIndex(voxels,::full)
    }
    private fun index(x:Double,y:Double,z:Double)=((x-minimumX)*strideX+(y-minimumY)*spanZ+z-minimumZ).toLong()
    internal val storageBytes:Long get()=dense?.let{it.size*8L}?:checkNotNull(sparse).storageBytes
    private fun has(x:Double,y:Double,z:Double):Boolean{
        if(dense==null)return checkNotNull(sparse)[x,y,z]!=null
        if(x<minimumX||x>maximumX||y<minimumY||y>maximumY||z<minimumZ||z>maximumZ||!safeInteger(x)||!safeInteger(y)||!safeInteger(z))return false
        val at=index(x,y,z);return dense[(at ushr 6).toInt()] and(1L shl(at.toInt() and 63))!=0L
    }
    fun normalOccupied(v:RenderVoxel,face:Int)=occupied(v,normals[face])
    private fun occupied(v:RenderVoxel,offset:IntArray)=has(v.x+offset[0],v.y+offset[1],v.z+offset[2])
    fun levels(v:RenderVoxel)=IntArray(6){face->
        if(normalOccupied(v,face))0 else {
            var score=0.0
            for(offset in edges[face])if(occupied(v,offset))score++
            for(offset in corners[face])if(occupied(v,offset))score+=.5
            var level=when{score==0.0->0;score<=1.5->1;score<=3.5->2;else->3}
            if(v.y==minimumY&&face>=2)level=maxOf(level,1)
            if(v.y==minimumY&&face==0)level=maxOf(level,2)
            level
        }
    }
    companion object {
        private val transparent=Regex("glass|pane|bars|fence|wall|leaves|leaf|water|lava|ice|vine|torch|lantern|door|trapdoor|flower|plant|short_grass|tall_grass|seagrass|sapling|cobweb")
        private fun safeInteger(v:Double)=v.isFinite()&&v in -9_007_199_254_740_991.0..9_007_199_254_740_991.0&&v==floor(v)
        private val normals=arrayOf(intArrayOf(0,-1,0),intArrayOf(0,1,0),intArrayOf(0,0,-1),intArrayOf(0,0,1),intArrayOf(-1,0,0),intArrayOf(1,0,0))
        private val tangents=arrayOf(arrayOf(intArrayOf(1,0,0),intArrayOf(0,0,1)),arrayOf(intArrayOf(1,0,0),intArrayOf(0,0,1)),
            arrayOf(intArrayOf(1,0,0),intArrayOf(0,1,0)),arrayOf(intArrayOf(1,0,0),intArrayOf(0,1,0)),
            arrayOf(intArrayOf(0,0,1),intArrayOf(0,1,0)),arrayOf(intArrayOf(0,0,1),intArrayOf(0,1,0)))
        private val edges=Array(6){face->listOf(-1,1).flatMap{sign->tangents[face].map{t->IntArray(3){normals[face][it]+t[it]*sign}}}}
        private val corners=Array(6){face->listOf(-1,1).flatMap{a->listOf(-1,1).map{b->IntArray(3){normals[face][it]+tangents[face][0][it]*a+tangents[face][1][it]*b}}}}
    }
}
