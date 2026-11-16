package com.blockcolc.world

import com.blockcolc.world.generation.TerrainMaterial
import com.blockcolc.world.resource.*
import java.nio.ByteBuffer
import java.util.Collections
import java.util.concurrent.CancellationException
import kotlin.math.floor

class NativeResourceTerrainTile internal constructor(val blockId:String,val color:Int,val texture:NativePixelTexture)

/** Repeating terrain owns tiny independent crops, never repeated atlas pages.
 * Prepared with the resource generation input; rendering only borrows pixels. */
class NativeResourceTerrain private constructor(tiles:Map<TerrainMaterial,NativeResourceTerrainTile>,
    val estimatedResidentBytes:Long,val estimatedPeakBytes:Long){
    val tiles:Map<TerrainMaterial,NativeResourceTerrainTile> = Collections.unmodifiableMap(LinkedHashMap(tiles))
    fun material(kind:TerrainMaterial,state:NativeSurfaceState,side:Boolean=false):NativeRenderMaterial?{
        val tile=tiles[kind]?:return null
        val color=LinearRgb.fromSrgb(tile.color).let{if(side)LinearRgb(it.red*.65f,it.green*.65f,it.blue*.65f)else it}
        val binding=NativeSurfaceBinding(0f)
        return NativeRenderMaterial(color=color,texture=tile.texture,roughness=.94f,metalness=0f,
            surface=binding.resolve(state),environment=NativeMaterialBinding(binding))
    }
    companion object{
        private val blocks=linkedMapOf(TerrainMaterial.GRASS to "grass_block",TerrainMaterial.DIRT to "dirt",TerrainMaterial.STONE to "stone",
            TerrainMaterial.SAND to "sand",TerrainMaterial.SNOW to "snow_block",TerrainMaterial.ICE to "ice",TerrainMaterial.TERRACOTTA to "terracotta")
        private data class Crop(val kind:TerrainMaterial,val block:String,val face:ResourceMappedFace,val page:ResourceAtlasPage,
            val x:Int,val y:Int,val width:Int,val height:Int)
        fun prepare(stack:ResourcePackStack,atlas:ResourceTextureAtlas,palette:ResourceBiomePalette=ResourceBiomePalette(),
            availableBytes:Long=134217728,cancelled:()->Boolean={false}):NativeResourceTerrain{
            require(availableBytes>=0)
            fun check(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Terrain materials superseded")}
            check();val resolver=stack.resolver();val position=ResourceBlockPosition(0.0,0.0,0.0);val crops=ArrayList<Crop>()
            for((kind,name)in blocks){
                check();val block="minecraft:$name"
                var resolution=resolver.textures(block,position=position,cancelled=cancelled)
                if(resolution is ResourceBlockFallback&&resolution.reason=="NO_MATCHING_VARIANT"){
                    val state=stack.blocks.state(block)?.variants?.firstOrNull()?.conditions.orEmpty()
                    resolution=resolver.textures(block,state,position,cancelled)
                }
                val mapped=NativeResourceAtlasMapping.textures(resolution,atlas) as? ResourceAtlasTextures?:continue
                val face=mapped.faces["up"]?:continue
                val page=atlas.pages.getOrNull(face.entry.page)?:continue
                val rect=face.entry.uv
                fun rounded(value:Double)=floor(value+.5).toInt()
                val x=rounded(rect.u0*page.width).coerceIn(0,page.width-1);val y=rounded(rect.v0*page.height).coerceIn(0,page.height-1)
                val x1=rounded(rect.u1*page.width).coerceIn(x+1,page.width);val y1=rounded(rect.v1*page.height).coerceIn(y+1,page.height)
                crops+=Crop(kind,block,face,page,x,y,x1-x,y1-y)
            }
            val pixels=crops.sumOf{it.width.toLong()*it.height*4}
            val gpu=crops.sumOf{GpuFootprint.mipBytes(it.width,it.height)}
            // Source crop, immutable copy and native upload staging; complete
            // private mip chain and GPU copy. Admit before allocating crops.
            val peak=pixels*3+gpu*2
            if(peak>availableBytes)throw ResourceAtlasException("ATLAS_TOO_LARGE")
            val tiles=linkedMapOf<TerrainMaterial,NativeResourceTerrainTile>()
            for(crop in crops){
                check();val source=crop.page.pixels();val data=ByteArray(crop.width*crop.height*4)
                repeat(crop.height){row->check();source.position(((crop.y+row)*crop.page.width+crop.x)*4);source.get(data,row*crop.width*4,crop.width*4)}
                val color=if(crop.block=="minecraft:grass_block"&&crop.face.metadata.tintIndex==0)palette.grass else 0xffffff
                val texture=NativePixelTexture(crop.width,crop.height,ByteBuffer.wrap(data),wrapS=1000,wrapT=1000,minFilter=1008,magFilter=1006,anisotropy=4f)
                tiles[crop.kind]=NativeResourceTerrainTile(crop.block,color,texture)
            }
            check();return NativeResourceTerrain(tiles,pixels+gpu,peak)
        }
    }
}
