package com.blockcolc.world.generation

import java.util.Collections
import java.util.Locale
import java.util.concurrent.CancellationException
import kotlin.math.*

data class FluidCorners(val northWest:Double,val northEast:Double,val southEast:Double,val southWest:Double) {
    operator fun get(index:Int)=when(index){0->northWest;1->northEast;2->southEast;3->southWest;else->throw IndexOutOfBoundsException()}
    init {require((0..3).all{this[it].isFinite()&&this[it] in 0.0..1.0})}
    fun packed():Int=(0..3).sumOf{floor(this[it]*63+.5).toInt() shl(it*6)}
}
data class OriginalFluidEntry(val sourceIndex:Int,val kind:OriginalFluid,val height:Double,val faceMask:Int,val corners:FluidCorners,val flowing:Boolean,val flowAngle:Double) {
    val packedCorners get()=corners.packed()
    val packedMetadata:Int get(){
        val tau=PI*2;val angle=((flowAngle%tau)+tau)%tau
        val code=if(flowing)floor(angle/tau*4096+.5).toInt()%4096 else 0
        return 1_000_000+(if(kind==OriginalFluid.WATER)65536 else 0)+(if(flowing)32768 else 0)+code
    }
}
class OriginalFluidBatch internal constructor(val kind:OriginalFluid,val height:Double,val faceMask:Int,val waterlogged:Boolean,entries:List<OriginalFluidEntry>) {
    val entries:List<OriginalFluidEntry> = Collections.unmodifiableList(entries.toList())
}
class OriginalFluidPlan internal constructor(entries:List<OriginalFluidEntry>,batches:List<OriginalFluidBatch>) {
    val entries:List<OriginalFluidEntry> = Collections.unmodifiableList(entries.toList())
    val batches:List<OriginalFluidBatch> = Collections.unmodifiableList(batches.toList())
}

/** Static Java-style neighbor approximation, shared by original fluid and
 * future pack atlas routing. Waterlogged sources retain their solid model.
 * No tick simulation, storage writes or GPU objects are created here. */
class OriginalFluids(private val styles:OriginalMaterialStyles=OriginalMaterialStyles()) {
    private data class Fluid(val kind:OriginalFluid,val ownHeight:Double)
    private val fluidSamples=Array(OriginalFluid.entries.size){kind->Array(9){height->Fluid(OriginalFluid.entries[kind],height/9.0)}}
    private inner class Context(val blocks:VoxelCoordinateIndex,val fluids:VoxelCoordinateIndex){
        private val heights=HashMap<String,Int>()
        fun fluid(x:Double,y:Double,z:Double):Fluid? {
            val v=fluids[x,y,z]?:return null
            val waterlogged=v.sourceBlockState?.get("waterlogged")=="true"
            val kind=styles.fluid(v.sourceBlockId)?:if(waterlogged)OriginalFluid.WATER else return null
            // Lookup runs for every neighbor and corner. Parse each raw level
            // once per context instead of opening an ICU matcher per query.
            // The formal rule has only eight possible own-height samples.
            val height=if(waterlogged)8 else {
                val raw=v.sourceBlockState?.get("level")?:"0"
                heights[raw]?:((styles.fluidHeight(v.sourceBlockState)*9).roundToInt()).also{if(heights.size<64)heights[raw]=it}
            }
            return fluidSamples[kind.ordinal][height]
        }
    }
    private data class Key(val kind:OriginalFluid,val height:Double,val mask:Int)
    private val sides=listOf(intArrayOf(0,-1,0),intArrayOf(0,1,0),intArrayOf(0,0,-1),intArrayOf(0,0,1),intArrayOf(-1,0,0),intArrayOf(1,0,0))
    private val cardinals=listOf(intArrayOf(0,0,-1),intArrayOf(1,0,0),intArrayOf(0,0,1),intArrayOf(-1,0,0))
    private fun checkpoint(cancelled:()->Boolean){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Fluid planning superseded")}
    private fun context(voxels:List<RenderVoxel>,cancelled:()->Boolean):Context {
        val blocks=VoxelCoordinateIndex(voxels,cancelled=cancelled)
        // Keep an independent admission index: a later solid at the same
        // coordinate does not erase the last fluid in the source algorithm.
        val fluids=VoxelCoordinateIndex(voxels,{styles.fluid(it.sourceBlockId)!=null||it.sourceBlockState?.get("waterlogged")=="true"},cancelled)
        return Context(blocks,fluids)
    }
    private fun heightAt(x:Double,y:Double,z:Double,kind:OriginalFluid,c:Context):Double {
        val f=c.fluid(x,y,z)
        if(f?.kind==kind)return if(c.fluid(x,y+1,z)?.kind==kind)1.0 else f.ownHeight
        val v=c.blocks[x,y,z]
        if(v==null||styles.fluid(v.sourceBlockId)!=null||v.sourceBlockState?.get("waterlogged")=="true")return 0.0
        return if(partial(v.sourceBlockId))0.0 else -1.0
    }
    private fun entry(index:Int,v:RenderVoxel,kind:OriginalFluid,c:Context):OriginalFluidEntry? {
        val x=v.x;val y=v.y;val z=v.z;val own=c.fluid(x,y,z);val above=c.fluid(x,y+1,z)
        val height=if(own?.kind==kind&&above?.kind==kind)1.0 else own?.ownHeight?:styles.fluidHeight(v.sourceBlockState)
        var mask=0;for((face,offset)in sides.withIndex())if(c.fluid(x+offset[0],y+offset[1],z+offset[2])?.kind!=kind)mask=mask or(1 shl face)
        if(mask==0)return null
        val current=heightAt(x,y,z,kind,c);val north=heightAt(x,y,z-1,kind,c);val east=heightAt(x+1,y,z,kind,c);val south=heightAt(x,y,z+1,kind,c);val west=heightAt(x-1,y,z,kind,c)
        val corners=FluidCorners(average(north,west,heightAt(x-1,y,z-1,kind,c),current),average(north,east,heightAt(x+1,y,z-1,kind,c),current),
            average(south,east,heightAt(x+1,y,z+1,kind,c),current),average(south,west,heightAt(x-1,y,z+1,kind,c),current))
        val currentHeight=if(own?.kind==kind)own.ownHeight else 8/9.0;var flowX=0.0;var flowZ=0.0
        for(offset in cardinals) {
            val nx=x+offset[0];val nz=z+offset[2];val neighbor=c.fluid(nx,y,nz)
            val delta=if(neighbor?.kind==kind&&neighbor.ownHeight>0)currentHeight-neighbor.ownHeight else if(neighbor==null) {
                val block=c.blocks[nx,y,nz];if(block!=null&&!partial(block.sourceBlockId))continue
                val lower=c.fluid(nx,y-1,nz);if(lower?.kind!=kind||lower.ownHeight<=0)continue
                currentHeight-lower.ownHeight-8/9.0
            }else continue
            flowX+=delta*offset[0];flowZ+=delta*offset[2]
        }
        val flowing=flowX*flowX+flowZ*flowZ>1e-10
        return OriginalFluidEntry(index,kind,height,mask,corners,flowing,if(flowing)atan2(flowZ,flowX)-PI/2 else 0.0)
    }
    fun free(voxels:List<RenderVoxel>,neighboringVoxels:List<RenderVoxel> = voxels,cancelled:()->Boolean={false}):OriginalFluidPlan=plan(voxels,neighboringVoxels,false,4096,cancelled)
    fun waterlogged(voxels:List<RenderVoxel>,maximumBatchEntries:Double=4096.0,cancelled:()->Boolean={false}):OriginalFluidPlan {
        val value=floor(maximumBatchEntries);val safe=if(value.isNaN()||value==0.0)1 else value.coerceIn(1.0,4096.0).toInt()
        return plan(voxels,voxels,true,safe,cancelled)
    }
    private fun plan(voxels:List<RenderVoxel>,neighbors:List<RenderVoxel>,waterlogged:Boolean,maximum:Int,cancelled:()->Boolean):OriginalFluidPlan {
        checkpoint(cancelled);val selected=voxels.indices.filter{if(waterlogged)voxels[it].sourceBlockState?.get("waterlogged")=="true"else styles.fluid(voxels[it].sourceBlockId)!=null}
        if(selected.isEmpty())return OriginalFluidPlan(emptyList(),emptyList())
        val context=context(neighbors,cancelled);val entries=ArrayList<OriginalFluidEntry>();val groups=linkedMapOf<Key,MutableList<OriginalFluidEntry>>()
        for((n,index)in selected.withIndex()) {
            if(n%128==0)checkpoint(cancelled);val v=voxels[index];val kind=if(waterlogged)OriginalFluid.WATER else styles.fluid(v.sourceBlockId)!!
            val e=entry(index,v,kind,context)?:continue;entries+=e;groups.getOrPut(Key(kind,e.height,e.faceMask)){arrayListOf()}.add(e)
        }
        val batches=ArrayList<OriginalFluidBatch>()
        for((key,values)in groups.entries.sortedWith(compareBy<Map.Entry<Key,MutableList<OriginalFluidEntry>>>{it.key.kind.name}.thenBy{it.key.height}.thenBy{it.key.mask})) {
            for(start in values.indices step maximum){checkpoint(cancelled);batches+=OriginalFluidBatch(key.kind,key.height,key.mask,waterlogged,values.subList(start,minOf(values.size,start+maximum)))}
        }
        checkpoint(cancelled);return OriginalFluidPlan(entries,batches)
    }
    companion object {
        private val partialIds="air cave_air void_air iron_bars cobweb lily_pad kelp seagrass tall_seagrass sugar_cane vine ladder chain tripwire fire soul_fire torchflower_crop".split(' ').toSet()
        private val suffixes=("_stairs _slab _fence _fence_gate _wall _pane _door _trapdoor _button _pressure_plate _sign _hanging_sign _torch _rod _rail _bed _carpet _banner _skull _head _flower _sapling _coral "+
            "_coral_fan _coral_wall_fan _tulip _mushroom _pot _bush _crop _stem _roots _plant _orchid _allium _daisy _poppy _dandelion _cornflower _rose _lily _peony _lilac _sunflower _pitcher_plant").split(' ')
        fun partial(id:String?):Boolean {val path=id?.lowercase(Locale.ROOT)?.removePrefix("minecraft:")?:return false;return path in partialIds||suffixes.any{path.endsWith(it)}}
        fun average(first:Double,second:Double,diagonal:Double,current:Double):Double {
            if(first>=1||second>=1||diagonal>=1)return 1.0
            var sum=0.0;var weight=0
            for(height in doubleArrayOf(diagonal,current,second,first)){if(height<0)continue;val sample=if(height>=.8)10 else 1;sum+=height*sample;weight+=sample}
            return if(weight==0)0.0 else sum/weight
        }
        /** Non-indexed equivalent of the original 0.97 cube after fluid inset.
         * Actual corner displacement and flow UVs remain packed GPU inputs. */
        fun geometry(faceMask:Int,waterlogged:Boolean):BlockGeometry {
            require(faceMask in 1..63);val cube=CuboidGeometry.create(.97,.97,.97);val source=cube.positions();val normal=cube.normals();val tex=cube.textureCoordinates()!!
            val p=FloatAttributeBuilder(108);val n=FloatAttributeBuilder(108);val uv=FloatAttributeBuilder(72);val slots=intArrayOf(5,4,1,0,3,2)
            val inset=if(waterlogged).985 else .995
            for(vertex in 0 until 36){val x=source.get().toDouble();val y=source.get().toDouble();val z=source.get().toDouble();val nx=normal.get().toDouble();val ny=normal.get().toDouble();val nz=normal.get().toDouble();val u=tex.get().toDouble();val v=tex.get().toDouble()
                if(faceMask and(1 shl slots[vertex/6])==0)continue
                p.add(x*(inset/.97));p.add(y*(1/.97));p.add(z*(inset/.97));n.add(nx);n.add(ny);n.add(nz);uv.add(u);uv.add(v)
            }
            return AttributeBlockGeometry(p.freeze(),n.freeze(),uv.freeze())
        }
    }
}
