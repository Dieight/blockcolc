package com.blockcolc.world.generation

import java.util.Collections
import java.util.IdentityHashMap
import java.util.concurrent.CancellationException
import kotlin.math.*

enum class SceneryTreeSpecies(val wireValue:String) { OAK("oak"),BIRCH("birch"),SPRUCE("spruce"),PALE_OAK("pale_oak"),POPLAR("poplar") }

/** Distant silhouettes retain references into the full immutable voxel list.
 * This is a subset LOD, not a second independently decoded object graph. */
class SceneryBlockSet internal constructor(voxels:List<RenderVoxel>,distant:List<RenderVoxel>) {
    val voxels:List<RenderVoxel> = Collections.unmodifiableList(voxels.toList())
    val distantVoxels:List<RenderVoxel> = Collections.unmodifiableList(distant.toList())
    @Volatile private var sourceIdentity:String?=null
    fun sourceKey(cancelled:()->Boolean={false}):String {
        if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Scenery identity superseded")
        return sourceIdentity?:RenderVoxelFingerprint.key(voxels,cancelled).also{sourceIdentity=it}
    }
    init {val full=IdentityHashMap<RenderVoxel,Boolean>();for(v in this.voxels)full[v]=true;require(this.distantVoxels.all{it in full}){"Subset scenery LOD must retain source voxel references"}}
    fun detail():List<RenderVoxel> {
        val silhouette=IdentityHashMap<RenderVoxel,Boolean>();for(v in distantVoxels)silhouette[v]=true
        return voxels.filter{it !in silhouette}
    }
    companion object {fun join(first:SceneryBlockSet,second:SceneryBlockSet)=SceneryBlockSet(first.voxels+second.voxels,first.distantVoxels+second.distantVoxels)}
}

internal class SceneryBlocksBuilder {
    private data class Cell(val x:Double,val y:Double,val z:Double)
    private data class Value(val voxel:RenderVoxel,val silhouette:Boolean)
    private val cells=HashMap<Cell,Value>()
    private val states=HashMap<Map<String,String>,Map<String,String>>()
    private val blockIds=HashMap<String,String>()
    private fun cell(x:Double,y:Double,z:Double)=Cell(if(x==0.0)0.0 else x,if(y==0.0)0.0 else y,if(z==0.0)0.0 else z)
    fun put(x:Int,y:Int,z:Int,block:String,material:String,silhouette:Boolean=true,state:Map<String,String>?=null)=put(x.toDouble(),y.toDouble(),z.toDouble(),block,material,silhouette,state)
    fun put(x:Int,y:Double,z:Int,block:String,material:String,silhouette:Boolean=true,state:Map<String,String>?=null)=put(x.toDouble(),y,z.toDouble(),block,material,silhouette,state)
    fun put(x:Double,y:Double,z:Double,block:String,material:String,silhouette:Boolean=true,state:Map<String,String>?=null) {
        val frozen=state?.let{val owned=Collections.unmodifiableMap(it.toSortedMap());states.getOrPut(owned){owned}}
        val id=blockIds.getOrPut(block){"minecraft:$block"}
        cells[cell(x,y,z)]=Value(RenderVoxel(x,y,z,material,0,id,frozen),silhouette)
    }
    fun result():SceneryBlockSet {
        val sorted=cells.values.sortedWith(compareBy<Value>{it.voxel.y}.thenBy{it.voxel.x}.thenBy{it.voxel.z})
        return SceneryBlockSet(sorted.map{it.voxel},sorted.filter{it.silhouette}.map{it.voxel})
    }
}

/** The existing self-authored block structures, not copied upstream NBT. */
object SceneryBlocks {
    private fun hash(text:String)=SourceNumbers.fnv32(text)
    private fun roof(b:SceneryBlocksBuilder,cx:Int,cz:Int,halfX:Int,halfZ:Int,baseY:Int,wood:String) {
        for(x in -halfX..halfX) {val rise=halfX-abs(x)
            for(z in -halfZ..halfZ) {
                b.put(cx+x,baseY+rise,cz+z,if(x==0)"${wood}_slab"else"${wood}_stairs","roof",true,
                    if(x==0)mapOf("type" to "bottom","waterlogged" to "false")else mapOf("facing" to if(x<0)"east"else"west","half" to "bottom","shape" to "straight","waterlogged" to "false"))
                if(abs(z)==halfZ-1)for(y in baseY until baseY+rise)b.put(cx+x,y,cz+z,"${wood}_planks","plank")
            }
        }
    }
    fun house(wood:String="oak",roofWood:String="spruce",chimney:Boolean=false):SceneryBlockSet {
        val b=SceneryBlocksBuilder()
        for(x in -3..3)for(z in -4..4) {
            b.put(x,0,z,"cobblestone","stone")
            if(abs(x)!=3&&abs(z)!=4)continue
            val corner=abs(x)==3&&abs(z)==4
            for(y in 1..4)b.put(x,y,z,if(corner)"${wood}_log"else"${wood}_planks",if(corner)"wood"else"plank",true,if(corner)mapOf("axis" to "y")else null)
        }
        for(z in listOf(-2,1))for(y in 2..3)for(x in listOf(-3,3))b.put(x,y,z,"glass_pane","glass",false,mapOf("north" to "true","south" to "true","west" to "false","east" to "false","waterlogged" to "false"))
        for(x in -1..1)b.put(x,2,-4,"glass_pane","glass",false,mapOf("west" to "true","east" to "true","north" to "false","south" to "false","waterlogged" to "false"))
        for(y in 1..2)b.put(0,y,4,"${wood}_door","wood",false,mapOf("facing" to "south","half" to if(y==1)"lower"else"upper","hinge" to "left","open" to "false","powered" to "false"))
        b.put(0,0,5,"cobblestone_stairs","stone",true,mapOf("facing" to "north","half" to "bottom","shape" to "straight","waterlogged" to "false"))
        roof(b,0,0,4,5,5,roofWood)
        b.put(-2,1,-3,"crafting_table","plank",false);b.put(2,1,-3,"bookshelf","plank",false)
        if(chimney)for(y in 1..8)b.put(2,y,-2,"stone_bricks","stone")
        return b.result()
    }
    fun well():SceneryBlockSet {
        val b=SceneryBlocksBuilder()
        for(x in -2..2)for(z in -2..2)if(abs(x)==2||abs(z)==2)b.put(x,0,z,"cobblestone","stone")else b.put(x,0,z,"water","glass",false,mapOf("level" to "0"))
        for(x in listOf(-2,2))for(z in listOf(-2,2))for(y in 1..3)b.put(x,y,z,"oak_fence","wood",true,mapOf("north" to "false","south" to "false","east" to "false","west" to "false","waterlogged" to "false"))
        for(x in -3..3)for(z in -3..3)b.put(x,4,z,"oak_slab","roof",true,mapOf("type" to "bottom","waterlogged" to "false"))
        return b.result()
    }
    fun farm():SceneryBlockSet {
        val b=SceneryBlocksBuilder()
        for(x in -3..3)for(z in -3..3) {
            val edge=abs(x)==3||abs(z)==3
            b.put(x,0,z,if(edge)"oak_log"else if(x==0)"water"else"farmland",if(edge)"wood"else if(x==0)"glass"else"accent",true,
                if(edge)mapOf("axis" to if(abs(x)==3)"z"else"x")else if(x==0)mapOf("level" to "0")else mapOf("moisture" to "7"))
            if(!edge&&x!=0)b.put(x,1,z,"wheat","accent",false,mapOf("age" to "7"))
        }
        return b.result()
    }
    fun tree(species:SceneryTreeSpecies,variant:Long,tallSpruce:Boolean=false):SceneryBlockSet {
        require(variant in 0..0xffffffffL)
        val b=SceneryBlocksBuilder();val name=species.wireValue
        if(species==SceneryTreeSpecies.POPLAR) {
            val height=7+(variant%5).toInt();val color=listOf("red","orange","yellow")[(variant%3).toInt()]
            for(y in 0 until height)b.put(0,y,0,"poplar_log","wood",true,mapOf("axis" to "y"))
            for(branch in 0 until 2+(variant%3).toInt()) {
                val dx=if(branch%2==0)1 else -1;val dz=if(branch<2)0 else 1;val y=height-5+branch
                for(i in 1..2)b.put(dx*i,y+i/2,dz*i,"poplar_log","wood",true,mapOf("axis" to if(dz!=0)"z"else"x"))
            }
            val radii=intArrayOf(2,3,4,3,2,1)
            for(layer in 0..5) {val y=height-4+layer;val radius=radii[layer]
                for(x in -radius..radius)for(z in -radius..radius) {
                    if(x*x+z*z>radius*radius+1||x==0&&z==0&&y<height||(abs(x)+abs(z)>radius&&hash("$variant:$x:$y:$z")%7==0L))continue
                    b.put(x,y,z,"${color}_poplar_leaves","accent",true,mapOf("distance" to "1","persistent" to "true","waterlogged" to "false"))
                }
            }
            return b.result()
        }
        val spruce=species==SceneryTreeSpecies.SPRUCE
        val height=if(spruce)if(tallSpruce)9+(variant%4).toInt()else 7+(variant%2).toInt()else 4+(variant%3).toInt()
        for(y in 0 until height)b.put(0,y,0,"${name}_log","wood",true,mapOf("axis" to "y"))
        if(!spruce)b.put(1,height-2,0,"${name}_log","wood",true,mapOf("axis" to "x"))
        val layers=if(spruce) {
            val radii=if(tallSpruce)intArrayOf(3,2,3,2,2,1,1,0)else intArrayOf(2,1,2,1,1,0)
            radii.indices.map{height-(if(tallSpruce)7 else 5)+it to radii[it]}
        }else listOf(height-2 to 2,height-1 to 2,height to 1,height+1 to 1)
        for((y,radius)in layers)for(x in -radius..radius)for(z in -radius..radius) {
            if(x==0&&z==0&&y<height)continue
            if(radius>0&&abs(x)==radius&&abs(z)==radius&&(spruce||(hash("$variant:$x:$y:$z") and 1L)==0L))continue
            b.put(x,y,z,"${name}_leaves","accent",true,mapOf("distance" to "1","persistent" to "true","waterlogged" to "false"))
        }
        return b.result()
    }
    fun camp(cloth:String="brown_wool"):SceneryBlockSet {
        val b=SceneryBlocksBuilder()
        for(x in -4..2)for(z in -4..1) {
            b.put(x,0,z,"spruce_planks","plank");val y=4-abs(x+1)
            if(y>0)b.put(x,y,z,cloth,"roof")
            if(z== -4&&y>1)for(yy in 1 until y)b.put(x,yy,z,cloth,"roof")
        }
        b.put(-1,4,-4,"spruce_log","wood",true,mapOf("axis" to "z"))
        b.put(4,0,3,"campfire","wood",false,mapOf("facing" to "north","lit" to "false","signal_fire" to "false","waterlogged" to "false"))
        for(x in 2..5)b.put(x,0,5,"oak_log","wood",true,mapOf("axis" to "x"))
        b.put(-3,1,-3,"barrel","wood",false,mapOf("facing" to "up","open" to "false"));return b.result()
    }
    fun wreck():SceneryBlockSet {
        val b=SceneryBlocksBuilder()
        for(z in -10..10) {val radius=if(abs(z)>7)1 else if(abs(z)>5)2 else 3
            for(x in -radius..radius) {
                b.put(x,-2,z,"dark_oak_planks","plank")
                if(abs(x)==radius)for(y in -1..if(z<4)2 else 0) {if(z==2&&y==2&&x>0)continue;b.put(x,y,z,"dark_oak_planks","plank")}
                if(z< -5||z>6)b.put(x,1,z,"spruce_slab","plank",true,mapOf("type" to "bottom","waterlogged" to "false"))
            }
        }
        for(y in -1..10)b.put(0,y,-2,"spruce_log","wood",true,mapOf("axis" to "y"))
        for(x in -4..3)b.put(x,8,-2,"spruce_log","wood",true,mapOf("axis" to "x"))
        for(x in -3..2)for(y in 4..7)if(hash("torn:$x:$y")%5!=0L)b.put(x,y,-2,"white_wool","accent")
        return b.result()
    }
    fun dock():SceneryBlockSet {
        val b=SceneryBlocksBuilder()
        for(z in -7..7)for(x in -2..2)b.put(x,0,z,"oak_slab","plank",true,mapOf("type" to "bottom","waterlogged" to "false"))
        for(x in listOf(-3,3))for(z in listOf(-5,0,5))for(y in -3..1)b.put(x,y,z,"oak_log","wood",true,mapOf("axis" to "y"))
        b.put(1,1,-5,"barrel","wood",false,mapOf("facing" to "up","open" to "false"));return b.result()
    }
    fun ruin():SceneryBlockSet {
        val b=SceneryBlocksBuilder()
        for(x in -4..4)for(z in -4..4) {
            b.put(x,0,z,"mossy_cobblestone","stone")
            if(abs(x)!=3&&abs(z)!=3||z==3&&abs(x)<=1)continue
            val height=4+(hash("ruin:$x:$z")%6).toInt()
            for(y in 1..height) {
                if(y==4&&(abs(x)==3&&z==0||abs(z)==3&&x==0))continue
                b.put(x,y,z,if(hash("moss:$x:$y:$z")%4==0L)"mossy_stone_bricks"else"stone_bricks","stone")
            }
        };return b.result()
    }
    fun rock(seed:String):SceneryBlockSet {
        val b=SceneryBlocksBuilder()
        for(x in -3..3)for(z in -3..3) {
            if(x*x+z*z>13)continue
            val height=max(1,5-abs(x)-abs(z)+(hash("$seed:rock:$x:$z")%2).toInt())
            for(y in 0 until height)b.put(x,y,z,if(y==height-1&&(x+z)%3!=0)"moss_block"else"andesite",if(y==height-1)"accent"else"stone")
        };return b.result()
    }
    fun iceSpire(seed:Long):SceneryBlockSet {
        require(seed in 0..0xffffffffL)
        val b=SceneryBlocksBuilder();val height=12+(seed%17).toInt()
        for(y in 0 until height) {
            val radius=max(0,floor(3*(1-y.toDouble()/height).pow(1.4)).toInt())
            for(x in -radius..radius)for(z in -radius..radius)if(abs(x)+abs(z)<=radius+1)b.put(x,y,z,if((x+z+y)%7==0)"blue_ice"else"packed_ice","glass")
        };return b.result()
    }
}
