package com.blockcolc.world

import com.blockcolc.world.generation.TerrainMaterial
import com.blockcolc.world.resource.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.Base64
import java.util.concurrent.CancellationException

class NativeResourceTerrainTest{
    private val rows by lazy{JSONObject(javaClass.getResource("/native-resource-terrain-oracle.json")!!.readText()).getJSONArray("cases")}
    private fun <T> prepared(index:Int,block:(ResourcePackStack,ResourceTextureAtlas,ResourceBiomePalette)->T):T{
        val row=rows.getJSONObject(index)
        return NativeResourceArchive.from(Base64.getDecoder().decode(row.getString("zip"))).use{archive->
            val stack=ResourcePackStack.of(ResourcePackAssets.prepare(archive));block(stack,NativeResourceAtlas.build(stack),ResourceBiomePalette.from(stack))
        }
    }
    @Test fun allCropsTintFilteringAndSideShadingMatchTheFormalTerrainRoute(){
        var count=0
        for(i in 0 until rows.length())prepared(i){stack,atlas,palette->
            val row=rows.getJSONObject(i);val expected=row.getJSONObject("expected");val terrain=NativeResourceTerrain.prepare(stack,atlas,palette)
            assertEquals(row.getString("name"),expected.length(),terrain.tiles.size)
            assertNull(terrain.material(TerrainMaterial.WATER,NativeSurfaceState()))
            for((kind,tile)in terrain.tiles){
                count++;val e=expected.getJSONObject(kind.wireValue);val texture=tile.texture
                assertEquals(e.getString("blockId"),tile.blockId);assertEquals(e.getInt("width"),texture.width);assertEquals(e.getInt("height"),texture.height)
                assertEquals(e.getString("rgbaSha256"),texture.sha256);assertEquals(e.getInt("color"),tile.color);assertTrue(texture.pixels().isReadOnly)
                assertEquals(e.getBoolean("generateMipmaps"),texture.mipmaps);assertEquals(e.getInt("minFilter"),texture.minFilter);assertEquals(e.getInt("magFilter"),texture.magFilter)
                assertEquals(e.getDouble("anisotropy").toFloat(),texture.anisotropy,0f);assertEquals(1000,texture.wrapS);assertEquals(1000,texture.wrapT)
                for(side in listOf(false,true)){
                    val material=terrain.material(kind,NativeSurfaceState(),side)!!;val rgb=e.getJSONArray(if(side)"sideRgb"else"rgb")
                    for((axis,value)in listOf(material.color.red,material.color.green,material.color.blue).withIndex())assertEquals(rgb.getDouble(axis),value.toDouble(),1e-7)
                    assertSame(texture,material.texture);assertEquals(.94f,material.roughness,0f);assertFalse(material.transparent);assertFalse(material.vertexColors)
                    assertNull(material.atlas);assertNull(material.surface.optics.atlas)
                }
            }
        }
        assertEquals(13,rows.length());assertEquals(83,count)
    }
    @Test fun budgetIsCheckedBeforeCropsAndCancellationPublishesNothing(){prepared(0){stack,atlas,palette->
        val ready=NativeResourceTerrain.prepare(stack,atlas,palette)
        assertTrue(ready.estimatedResidentBytes>0);assertTrue(ready.estimatedPeakBytes>ready.estimatedResidentBytes)
        assertEquals("ATLAS_TOO_LARGE",assertThrows(ResourceAtlasException::class.java){NativeResourceTerrain.prepare(stack,atlas,palette,ready.estimatedPeakBytes-1)}.code)
        assertEquals(ready.tiles.keys,NativeResourceTerrain.prepare(stack,atlas,palette,ready.estimatedPeakBytes).tiles.keys)
        assertThrows(CancellationException::class.java){NativeResourceTerrain.prepare(stack,atlas,palette,cancelled={true})}
        var calls=0;assertThrows(CancellationException::class.java){NativeResourceTerrain.prepare(stack,atlas,palette,cancelled={++calls>25})}
        assertThrows(UnsupportedOperationException::class.java){(ready.tiles as MutableMap<TerrainMaterial,NativeResourceTerrainTile>).clear()}
    }}
}
