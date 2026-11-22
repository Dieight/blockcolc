package com.blockcolc.world

import com.blockcolc.world.generation.RenderVoxel
import java.util.Collections

/** Coordinates use the same centered source cells as buildings. The floor top
 * is zero; walls end exactly at the ceiling underside. No stretched wall UVs. */
object NativeInteriorBlocks {
    const val EYE_HEIGHT=1.62
    const val DESK_HEIGHT=1.0
    const val VIEW_Z=-2.15
    private const val floor="polished_andesite"
    private const val wall="spruce_planks"
    private const val trim="dark_oak_planks"
    private const val desktop="dark_oak_slab"
    private const val deskLeg="dark_oak_fence"
    private const val chair="warped_stairs"
    val blockIds:Set<String> = setOf(floor,wall,trim,desktop,deskLeg,chair,"glass","red_bed","lantern").map{"minecraft:$it"}.toSet()
    fun layout(items:List<NativeInteriorItem>):List<RenderVoxel> {
        val cells=ArrayList<RenderVoxel>()
        fun block(x:Double,y:Double,z:Double,id:String,state:Map<String,String>?=null){
            val fallback=when(id){"glass"->"glass";floor->"stone";else->"wood"}
            cells+=RenderVoxel(x,y,z,fallback,cells.size,"minecraft:$id",state)
        }
        for(x in -5..4)for(z in -5..4){block(x+.5,-.5,z+.5,floor);block(x+.5,4.5,z+.5,trim)}
        for(z in -4..3)for(y in 0..3){block(-4.5,y+.5,z+.5,wall);block(4.5,y+.5,z+.5,wall)}
        for(x in -5..4)for(y in 0..3){
            block(x+.5,y+.5,4.5,wall)
            block(x+.5,y+.5,-4.5,if(x in -4..3&&y>0)"glass"else trim)
        }
        for(x in -3..2)block(x+.5,1.0,-3.5,desktop,mapOf("type" to "bottom","waterlogged" to "false"))
        for(x in listOf(-2.5,2.5))block(x,.5,-3.5,deskLeg,mapOf("north" to "false","south" to "false","east" to "false","west" to "false","waterlogged" to "false"))
        block(0.0,.5,VIEW_Z,chair,mapOf("facing" to "south","half" to "bottom","shape" to "straight","waterlogged" to "false"))
        block(2.35,1.5,-3.35,"lantern",mapOf("hanging" to "false","waterlogged" to "false"))
        for(item in items)if(item.id=="bed"){
            val turn=com.blockcolc.world.generation.BlockTransform.rotationY(item.quarterTurns*Math.PI/2)
            for((part,dz)in listOf("foot" to -.5,"head" to .5)){
                val position=turn.point(com.blockcolc.world.generation.BlockPoint(0.0,0.0,dz))
                block(item.x+position.x,item.y+.5,item.z+position.z,"red_bed",mapOf("facing" to listOf("south","east","north","west")[item.quarterTurns],"part" to part,"occupied" to "false"))
            }
        }
        return Collections.unmodifiableList(cells)
    }
}
