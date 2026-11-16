package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.CancellationException

class NativeConstructionDetailsTest {
    private val oracle by lazy{JSONObject(javaClass.getResource("/native-construction-oracle.json")!!.readText())}
    @Test fun referenceUsesTheCurrentRendererMaterialGeometryAndTextureFunctions(){
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/voxel/src/renderer.ts").exists()}
        val hashes=oracle.getJSONObject("sourceHashes");hashes.keys().forEach{file->
            assertEquals(file,hashes.getString(file),MessageDigest.getInstance("SHA-256").digest(File(root,file).readBytes()).joinToString(""){"%02x".format(it.toInt()and 255)})}
    }
    @Test fun allRendererCasesMatchMatricesMaterialsTexturesCountsAndShadowRoles(){
        val cases=oracle.getJSONArray("cases");assertEquals(48,cases.length());val compiler=NativeConstructionDetails()
        repeat(cases.length()){index->val c=cases.getJSONObject(index);val input=c.getJSONObject("input");val p=input.getJSONObject("placement")
            val position=p.getJSONArray("position");val offset=p.getJSONArray("offset")
            val pose=NativeStructurePlacement(BlockPoint(position.getDouble(0),position.getDouble(1),position.getDouble(2)),p.getDouble("rotation"),Position2(offset.getDouble(0),offset.getDouble(1)))
            val blueprint=BlueprintSnapshot.read(input.getJSONObject("blueprint"));val origin=blueprint.bounds.let{BlockPoint(it.minX.toDouble(),it.minY.toDouble(),it.minZ.toDouble())}
            val raw=input.getJSONArray("vines");val vines=List(raw.length()){i->raw.getJSONObject(i).let{VinePosition(it.getDouble("x"),it.getDouble("y"),it.getDouble("z"),it.getString("axis"))}}
            val target=NativePacketBuilder("building:test")
            compiler.appendVines(target,vines,origin,pose,NativeSurfaceState())
            compiler.appendOutline(target,blueprint,input.getInt("completion"),input.getBoolean("visible"),origin,pose)
            val source=target.build();val meshes=c.getJSONArray("meshes");assertEquals(meshes.length(),source.world?.packets?.size?:0)
            if(meshes.length()>0){val world=checkNotNull(source.world)
                repeat(meshes.length()){meshIndex->val expected=meshes.getJSONObject(meshIndex);val packet=world.packets[meshIndex]
                    assertEquals(expected.getInt("count"),packet.count);val matrix=world.section(packet.instances).asFloatBuffer();val expectedMatrices=expected.getJSONArray("matrices")
                    assertEquals(packet.count*16,expectedMatrices.length());assertEquals(packet.count*20,matrix.remaining())
                    repeat(packet.count){instance->repeat(16){element->val n=instance*16+element
                        assertEquals("$index / $meshIndex / $n",expectedMatrices.getDouble(n),matrix.get().toDouble(),3e-4)}
                        repeat(4){assertEquals(1f,matrix.get(),0f)}}
                    val material=JSONObject(world.materials[packet.material]);val e=expected.getJSONObject("material")
                    for(key in listOf("opacity","roughness","metalness"))assertEquals(e.getDouble(key),material.getDouble(key),1e-7)
                    for(key in listOf("transparent","depthWrite"))assertEquals(e.getBoolean(key),material.getBoolean(key))
                    assertEquals(e.getBoolean("castShadow"),packet.castShadow);assertEquals(e.getBoolean("receiveShadow"),packet.receiveShadow)
                    repeat(3){channel->assertEquals(e.getJSONArray("color").getDouble(channel),material.getJSONArray("color").getDouble(channel),1e-7)}
                    if(e.isNull("texture"))assertTrue(material.isNull("texture"))else{
                        val texture=source.textures[material.getInt("texture")];assertEquals(e.getInt("textureWidth"),texture.width);assertEquals(e.getInt("textureHeight"),texture.height)
                        val pixels=texture.pixels();val expectedPixels=e.getJSONArray("texture");assertEquals(expectedPixels.length(),pixels.remaining())
                        repeat(pixels.remaining()){n->assertEquals(expectedPixels.getInt(n),pixels.get().toInt()and 255)}
                        assertEquals(0f,source.bindings[packet.material]!!.surface!!.edge,0f)
                    }
                }
            }
        }
    }
    @Test fun visibilityCompletionValidationAndCancellationKeepTheSourceBounds(){
        for(value in NativeOutlineVisibility.entries){assertSame(value,NativeOutlineVisibility.fromWire(value.wire))
            assertFalse(value.shows(true,10000));assertEquals(value!=NativeOutlineVisibility.OFF,value.shows(true,0));assertEquals(value==NativeOutlineVisibility.ALL,value.shows(false,0))}
        assertThrows(IllegalArgumentException::class.java){NativeOutlineVisibility.fromWire("unknown")}
        val compiler=NativeConstructionDetails();val pose=NativeStructurePlacement(BlockPoint(0.0,0.0,0.0));val origin=BlockPoint(0.0,0.0,0.0)
        assertThrows(CancellationException::class.java){compiler.appendVines(NativePacketBuilder("building:b"),emptyList(),origin,pose,NativeSurfaceState()){true}}
        assertThrows(IllegalArgumentException::class.java){compiler.appendVines(NativePacketBuilder("building:b"),listOf(VinePosition(0.0,1.0,0.0,"y")),origin,pose,NativeSurfaceState())}
        assertThrows(IllegalArgumentException::class.java){compiler.appendVines(NativePacketBuilder("building:b"),List(13){VinePosition(0.0,1.0,0.0,"x")},origin,pose,NativeSurfaceState())}
    }
    @Test fun distantBlueprintOriginsCancelBeforeVineAndOutlineMatricesNarrowToFloat(){
        val base=1_000_000_000_000L
        val raw=JSONObject(oracle.getJSONArray("cases").getJSONObject(0).getJSONObject("input").getJSONObject("blueprint").toString())
        val bounds=raw.getJSONObject("bounds");for(key in listOf("minX","maxX","minY","maxY","minZ","maxZ"))bounds.put(key,bounds.getLong(key)+base)
        val voxels=raw.getJSONArray("voxels");repeat(voxels.length()){i->val v=voxels.getJSONObject(i);for(key in listOf("x","y","z"))v.put(key,v.getLong(key)+base)}
        val blueprint=BlueprintSnapshot.read(raw);val origin=blueprint.bounds.let{BlockPoint(it.minX.toDouble(),it.minY.toDouble(),it.minZ.toDouble())}
        val pose=NativeStructurePlacement(BlockPoint(10.0,-base.toDouble()+4,20.0),offset=Position2(-base.toDouble(),-base.toDouble()))
        val compiler=NativeConstructionDetails();val target=NativePacketBuilder("building:distant")
        compiler.appendVines(target,listOf(VinePosition(base+.51,base+2.0,base+.51,"x")),origin,pose,NativeSurfaceState())
        assertEquals(26,compiler.appendOutline(target,blueprint,0,true,origin,pose))
        val world=checkNotNull(target.build().world);val matrix=world.section(world.packets.first().instances).asFloatBuffer()
        assertEquals(10.51,matrix.get(12).toDouble(),2e-4);assertEquals(6.0,matrix.get(13).toDouble(),1e-6);assertEquals(20.51,matrix.get(14).toDouble(),2e-4)
        assertTrue(world.packets.all{packet->(0..2).all{axis->kotlin.math.abs(packet.bounds.min[axis])<50&&kotlin.math.abs(packet.bounds.max[axis])<50}})
    }
}
