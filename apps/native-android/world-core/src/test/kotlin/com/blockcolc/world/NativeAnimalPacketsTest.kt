package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.CancellationException

class NativeAnimalPacketsTest {
    private val reference by lazy {JSONObject(javaClass.getResource("/native-animal-models-oracle.json")!!.readText())}
    private fun source()=NativeAnimalPackets.prepare(BlockBox(BlockPoint(-80.0,-8.0,-80.0),BlockPoint(80.0,30.0,80.0)))
    @Test fun modelReferenceUsesTheCurrentProductionAnimalModelsAndThree(){
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/voxel/src/animal-models.ts").isFile}
        val hashes=reference.getJSONObject("sourceHashes");assertTrue(hashes.has("packages/voxel/src/animal-models.ts"));assertTrue(hashes.has("node_modules/three/build/three.core.js"))
        hashes.keys().forEach{f->assertEquals(f,hashes.getString(f),MessageDigest.getInstance("SHA-256").digest(File(root,f).readBytes()).joinToString(""){"%02x".format(it.toInt()and 255)})}
    }
    @Test fun allFourPrimitiveMeshesMaterialsAndOriginalPixelsMatchTheCurrentRenderer(){
        val source=source();val world=source.world!!;assertEquals(5,world.packets.size)
        for(kind in 0..3){val e=reference.getJSONArray("meshes").getJSONObject(kind)
            val draws=world.packets.filter{world.section(it.aux!!).getFloat(4).toInt()==kind};val packet=draws.first();val g=world.geometries[packet.geometry]
            assertEquals(e.getInt("capacity"),draws.sumOf{it.count});assertTrue(draws.all{it.castShadow==e.getBoolean("castShadow")&&it.receiveShadow==e.getBoolean("receiveShadow")})
            val expectedIndex=e.getJSONArray("indices");val actualIndex=world.section(g.index).asIntBuffer();val vertices=world.section(g.vertex)
            assertEquals(expectedIndex.length(),actualIndex.remaining())
            repeat(expectedIndex.length()){i->val id=actualIndex.get();val eid=expectedIndex.getInt(i)
                for((name,offset,width)in listOf(Triple("position",0,3),Triple("normal",12,3),Triple("uv",24,2))){val values=e.getJSONArray(name)
                    repeat(width){c->assertEquals("kind $kind triangle $i $name $c",values.getDouble(eid*width+c),vertices.getFloat(id*48+offset+c*4).toDouble(),1e-7)}}}
            val m=JSONObject(world.materials[packet.material]);val expected=e.getJSONObject("material")
            for(name in listOf("color","emissive"))repeat(3){assertEquals(expected.getJSONArray(name).getDouble(it),m.getJSONArray(name).getDouble(it),1e-7)}
            for(name in listOf("opacity","emissiveIntensity","roughness","metalness"))if(!expected.isNull(name))assertEquals(expected.getDouble(name),m.getDouble(name),1e-7)
            for(name in listOf("unlit","transparent","vertexColors","depthWrite","depthTest","toneMapped","fog","flipY"))assertEquals("$kind $name",expected.getBoolean(name),m.getBoolean(name))
            assertEquals(expected.getInt("side"),m.getInt("side"))
            if(e.isNull("texture"))assertTrue(m.isNull("texture"))else{
                val t=source.textures[m.getInt("texture")];val et=e.getJSONObject("texture");val bytes=ByteArray(t.pixels().remaining()).also{t.pixels().get(it)}
                assertArrayEquals(Base64.getDecoder().decode(et.getString("pixels")),bytes)
                val metadata=t.metadata(0);for(name in listOf("width","height","wrapS","wrapT","minFilter","magFilter"))assertEquals(et.getInt(name),metadata.getInt(name))
                assertEquals(et.getString("colorSpace"),metadata.getString("colorSpace"));assertEquals(et.getBoolean("generateMipmaps"),t.mipmaps);assertEquals(et.getDouble("anisotropy"),t.anisotropy.toDouble(),0.0)
            }
        }
    }
    @Test fun allSlotsAreAdmittedAndThePacketCannotBeUsedAsAnOrdinaryStaticOwner(){
        val source=source();NativeAnimalPackets.validate(source)
        assertThrows(IllegalArgumentException::class.java){NativePacketSource("building:wrong",source.world,source.textures,source.surfaces,source.bindings,NativePacketLayer.ANIMALS)}
        assertThrows(IllegalArgumentException::class.java){NativePacketBuilder(PacketOwners.ANIMALS)}
        assertThrows(CancellationException::class.java){NativeAnimalPackets.prepare(BlockBox(BlockPoint(-1.0,-1.0,-1.0),BlockPoint(1.0,1.0,1.0))){true}}
    }
}
