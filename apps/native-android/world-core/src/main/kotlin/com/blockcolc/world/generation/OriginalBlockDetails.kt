package com.blockcolc.world.generation

import java.nio.ByteBuffer
import java.util.Collections
import kotlin.math.PI

data class DetailCuboid(val x:Double,val y:Double,val z:Double,val width:Double,val height:Double,val depth:Double)

/** Original authored six-face atlas, not copied vanilla pixels. Padding is
 * present in the pixels and in the UVs, so mip filtering cannot bleed tiles. */
class OriginalDetailTexture internal constructor(private val pixels:ByteArray) {
    val width=128;val height=64
    val byteSize get()=pixels.size.toLong()
    val contentSha:String=java.security.MessageDigest.getInstance("SHA-256").digest(pixels).joinToString(""){"%02x".format(it.toInt() and 255)}
    fun rgba():ByteBuffer=ByteBuffer.wrap(pixels).asReadOnlyBuffer()
}

class OriginalBlockDetails(private val styles:OriginalMaterialStyles=OriginalMaterialStyles()) {
    companion object {
        val ids:Set<String> = Collections.unmodifiableSet(buildSet {
            addAll(("bookshelf chiseled_bookshelf crafting_table furnace blast_furnace smoker note_block jukebox barrel loom cartography_table fletching_table smithing_table "+
                "chest trapped_chest ender_chest hopper anvil chipped_anvil damaged_anvil flower_pot chain iron_chain copper_chain exposed_copper_chain weathered_copper_chain oxidized_copper_chain "+
                "waxed_copper_chain waxed_exposed_copper_chain waxed_weathered_copper_chain waxed_oxidized_copper_chain sea_pickle").split(' '))
            for(color in "white orange magenta light_blue yellow lime pink gray light_gray cyan purple blue brown green red black".split(' '))add(color+"_glazed_terracotta")
            for(ore in "coal iron copper gold redstone emerald lapis diamond".split(' ')){add(ore+"_ore");add("deepslate_${ore}_ore")}
            addAll(listOf("nether_gold_ore","nether_quartz_ore","ancient_debris"))
        }.mapTo(linkedSetOf()){ "minecraft:$it" })
        private val anyNumber=Regex("^[+-]?(?:(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?)$")
        internal fun number(text:String):Double {
            val value=SourceNumbers.trim(text);if(value.isEmpty())return 0.0
            return when {
                value.startsWith("0x",true)->value.substring(2).toLongOrNull(16)?.toDouble()?:Double.NaN
                value.startsWith("0b",true)->value.substring(2).toLongOrNull(2)?.toDouble()?:Double.NaN
                value.startsWith("0o",true)->value.substring(2).toLongOrNull(8)?.toDouble()?:Double.NaN
                anyNumber.matches(value)->value.toDoubleOrNull()?:Double.NaN
                else->Double.NaN
            }
        }
    }
    fun parts(voxel:RenderVoxel):List<DetailCuboid>? {
        val id=voxel.sourceBlockId?:return null;if(id !in ids)return null
        val s=voxel.sourceBlockState?:emptyMap();val path=id.substring(10)
        if(!s["facing"].isNullOrEmpty()&&s["facing"] !in setOf("north","east","south","west","up","down"))return null
        fun boxes(vararg p:List<Double>)=Collections.unmodifiableList(p.map{DetailCuboid(it[0],it[1],it[2],it[3],it[4],it[5])})
        return when {
            path in setOf("chest","trapped_chest","ender_chest")->boxes(listOf(0.0,-.08,0.0,.875,.65,.875),listOf(0.0,.3,0.0,.9,.18,.9),listOf(0.0,.13,.46,.14,.23,.04))
            path=="hopper"->boxes(listOf(0.0,.35,-.4,1.0,.3,.2),listOf(0.0,.35,.4,1.0,.3,.2),listOf(-.4,.35,0.0,.2,.3,.6),listOf(.4,.35,0.0,.2,.3,.6),listOf(0.0,.08,0.0,.65,.25,.65),listOf(0.0,-.12,0.0,.4,.2,.4),listOf(0.0,-.37,0.0,.22,.3,.22))
            "anvil" in path->boxes(listOf(0.0,-.4,0.0,.8,.2,.8),listOf(0.0,-.12,0.0,.38,.42,.48),listOf(0.0,.32,0.0,1.0,.3,.65))
            path=="flower_pot"->boxes(listOf(0.0,-.45,0.0,.4,.1,.4),listOf(-.2,-.28,0.0,.1,.3,.5),listOf(.2,-.28,0.0,.1,.3,.5),listOf(0.0,-.28,-.2,.3,.3,.1),listOf(0.0,-.28,.2,.3,.3,.1))
            path=="chain"||path.endsWith("_chain")->{
                if(!s["axis"].isNullOrEmpty()&&s["axis"] !in setOf("x","y","z"))return null
                boxes(listOf(-.09,-.25,0.0,.07,.5,.1),listOf(.09,-.25,0.0,.07,.5,.1),listOf(0.0,-.48,0.0,.18,.05,.1),listOf(0.0,-.02,0.0,.18,.05,.1),listOf(0.0,.25,-.09,.1,.5,.07),listOf(0.0,.25,.09,.1,.5,.07),listOf(0.0,.02,0.0,.1,.05,.18),listOf(0.0,.48,0.0,.1,.05,.18))
            }
            path=="sea_pickle"->{
                val n=number(s["pickles"]?:"1");if(!n.isFinite()||n%1!=0.0||n<1||n>4)return null
                Collections.unmodifiableList(List(n.toInt()){i->DetailCuboid((i%2)*.34-.17,-.29+(i%3)*.03,(i/2)*.32-.16,.18,.42+i%3*.06,.18)})
            }
            else->boxes(listOf(0.0,0.0,0.0,1.0,1.0,1.0))
        }
    }
    fun transform(voxel:RenderVoxel):BlockTransform {
        val yaw=when(voxel.sourceBlockState?.get("facing")){"west"->PI/2;"north"->PI;"east"->-PI/2;else->0.0}
        var rotation=BlockTransform.rotationY(yaw)
        if(voxel.sourceBlockId?.endsWith("chain")==true)rotation=when(voxel.sourceBlockState?.get("axis")){"x"->rotation*BlockTransform.rotationZ(PI/2);"z"->rotation*BlockTransform.rotationX(PI/2);else->rotation}
        return rotation.withPosition(voxel.x,voxel.y,voxel.z)
    }
    fun geometry(parts:List<DetailCuboid>):BlockGeometry {
        require(parts.size<=8);val position=FloatArray(parts.size*108);val normal=FloatArray(position.size);val uv=FloatArray(parts.size*72)
        for((partIndex,part)in parts.withIndex()) {
            val source=CuboidGeometry.create(part.width,part.height,part.depth);val p=source.positions();val n=source.normals();val t=source.textureCoordinates()!!
            for(vertex in 0 until source.vertexCount){val at=partIndex*108+vertex*3
                position[at]=(p.get().toDouble()+part.x).toFloat();position[at+1]=(p.get().toDouble()+part.y).toFloat();position[at+2]=(p.get().toDouble()+part.z).toFloat()
                normal[at]=n.get();normal[at+1]=n.get();normal[at+2]=n.get()
                val face=vertex/6;val tex=partIndex*72+vertex*2;uv[tex]=((face%4*32+8+t.get().toDouble()*16)/128).toFloat();uv[tex+1]=((face/4*32+8+t.get().toDouble()*16)/64).toFloat()
            }
        }
        return AttributeBlockGeometry(position,normal,uv)
    }
    fun pixels(voxel:RenderVoxel):OriginalDetailTexture {
        val id=voxel.sourceBlockId;require(id in ids);val path=id!!.substring(10);val tint=styles.voxel(voxel).color
        val result=ByteArray(128*64*4)
        val books=intArrayOf(0x9d5146,0x638a71,0xc6b674,0x617895,0xb18567)
        val metalLike=listOf("furnace","smoker","anvil","hopper","chain").any{it in path}
        val furnaceLike=path=="furnace"||path=="blast_furnace"||path=="smoker"
        for(face in 0 until 6)for(py in 0 until 32)for(px in 0 until 32) {
            val x=(px-8).coerceIn(0,15);val y=(py-8).coerceIn(0,15);val top=face==2;val bottom=face==3;val front=face==4
            val grain=(x*13+y*7+face*3)%11-5
            var color=when{ "terracotta" in path||"copper_chain" in path->tint;metalLike->0x68757a;path=="ender_chest"->0x245457;path=="sea_pickle"->0x859d48;else->0xb18a55}
            when {
                path.endsWith("_ore")||path=="ancient_debris"->{val vein=(x/2*11+y/2*7+face*5)%17<4&&x>1&&y>1&&x<15&&y<15
                    color=when{vein->tint;"deepslate" in path->0x50575b;path.startsWith("nether_")->0x794d42;path=="ancient_debris"->0x665045;else->0x83908a}}
                path.endsWith("glazed_terracotta")->color=if((x+y)%8<2||kotlin.math.abs(x-7)+kotlin.math.abs(y-7)<4)tint else if((x<8)!=(y<8))0xeee3cb else 0x506873
                path=="bookshelf"||path=="chiseled_bookshelf"->if(!top&&!bottom){val occupied=path=="bookshelf"||voxel.sourceBlockState?.get("slot_${x/5+y/8*3}_occupied")=="true";color=if(y%8<2)0x87613e else if(occupied)books[(x+y/8)%5]else 0x403b30}
                path=="crafting_table"->color=if(top)if(x%5==0||y%5==0)0x654b33 else 0xb38657 else if(x<2||x>13)0x735038 else if((x==5||x==10)&&y>4)0x5e5b4a else 0xa87e4d
                furnaceLike->{
                    color=if(top)if(x%5==0||y%5==0)0x4f5a5a else 0x879191 else if(x==0||x==15||y==0||y==15)0x4b5555 else 0x83908c
                    if(front&&x>2&&x<13&&(y>3&&y<7||y>9&&y<14))color=if(voxel.sourceBlockState?.get("lit")=="true"&&y>9)if((x+y)%3!=0)0xeb9d45 else 0xe8c47c else 0x2a3332
                    if(path=="smoker"&&!top&&(x<2||x>13))color=0x5e4a36
                }
                "chest" in path||"barrel" in path->{
                    color=if(x%5==0||y==3||y==12)0x6e5135 else 0xad8147
                    if(path=="barrel"&&(x==2||x==13))color=0x62686a
                    if(front&&"chest" in path&&x>6&&x<10&&y>5&&y<11)color=if(path=="ender_chest")0xd7c889 else 0xc5bd8d
                    if(path=="trapped_chest"&&front&&y==4)color=0xa44d3e
                    if(path=="ender_chest"&&!front)color=if((x+y)%7==0)0x7ca69a else 0x24494d
                }
                path=="note_block"||path=="jukebox"->{color=if((x%4<2)==(y%4<2))0x785039 else 0x95694b;if(top&&path=="jukebox"&&y>6&&y<10&&x>2&&x<13)color=0x343c35}
                path=="loom"->color=if(front)if(x%3==0)0x694e35 else 0xd9c6a0 else 0x9f784e
                path=="cartography_table"->color=if(top)if(x<3||y<3)0x8b6844 else if((x+y)%7<2)0x73855b else 0xe3d8ae else 0x8f7353
                path=="fletching_table"->color=if(top)if(x==y||x+y==15)0x736348 else 0xc8b787 else 0xb39c72
                path=="smithing_table"->color=if(top)if(x%6==0||y%6==0)0x363f40 else 0x535f60 else if(x%6==0)0x374341 else 0x704f40
                path=="flower_pot"->color=if(y<3)0x9c5b40 else 0xb17450
            }
            val offset=((face/4*32+py)*128+face%4*32+px)*4
            for(channel in 0..2)result[offset+channel]=(((color shr((2-channel)*8))and 255)+grain).coerceIn(0,255).toByte()
            result[offset+3]=(-1).toByte()
        }
        return OriginalDetailTexture(result)
    }
}
