package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.FloatBuffer
import java.nio.ReadOnlyBufferException
import java.util.concurrent.CancellationException

class NativePacketBuilderTest {
    private fun matrices(count:Int=1):FloatBuffer=FloatBuffer.wrap(FloatArray(count*16){i->val instance=i/16;val element=i%16
        when(element){0,5,10,15->1f;12->instance.toFloat();else->0f}})
    @Test fun currentGeometryReachesTheValidatedVertexIndexAndSixTexelInstanceContract() {
        val g=CuboidGeometry.create(.45,.75,.65);val matrix=matrices(2)
        val color=FloatBuffer.wrap(floatArrayOf(.2f,.4f,.8f,1f,1f,.8f,.4f,1f))
        val aux=FloatBuffer.wrap(floatArrayOf(1098304f,16777215f,0f,0f,123f,4f,0f,0f))
        val builder=NativePacketBuilder("building:real-owner");builder.add(g,NativeRenderMaterial(color=LinearRgb.fromSrgb(0x8eb4b7)),matrix,color,aux)
        val source=builder.build();val world=source.world!!
        assertEquals(1,world.geometries.size);assertEquals(1,world.materials.size);assertEquals(1,world.packets.size)
        val mesh=world.geometries.single();assertEquals(36,mesh.vertexCount);assertEquals(36,mesh.indexCount)
        val data=world.section(mesh.vertex).asFloatBuffer();val expected=g.positions();val normal=g.normals();val uv=g.textureCoordinates()!!
        repeat(g.vertexCount){repeat(3){assertEquals(expected.get(),data.get(),0f)};repeat(3){assertEquals(normal.get(),data.get(),0f)};repeat(2){assertEquals(uv.get(),data.get(),0f)};repeat(4){assertEquals(1f,data.get(),0f)}}
        val indices=world.section(mesh.index).asIntBuffer();repeat(36){assertEquals(it,indices.get())}
        val packet=world.packets.single();assertEquals("building:real-owner",packet.owner)
        assertEquals(listOf("instanceFaceOcclusion","instanceMaterialResponse"),packet.auxChannels)
        val rows=world.instanceRows(packet)
        assertEquals(.2f,rows.getFloat(64),0f);assertEquals(1098304f,rows.getFloat(80),0f);assertEquals(16777215f,rows.getFloat(84),0f)
        assertEquals(1f,rows.getFloat(96+48),0f);assertEquals(4f,rows.getFloat(96+84),0f)
        assertTrue(world.section(mesh.vertex).isReadOnly);assertEquals(0,matrix.position());assertEquals(0,color.position());assertEquals(0,aux.position())
        assertEquals(36*64L+36*4L,source.footprint.geometryBytes);assertEquals(2*96L,source.footprint.instanceBytes);assertEquals(4L,source.footprint.textureBytes)
    }
    @Test fun largeInstanceGroupsSplitWithoutDuplicatingGeometryOrLosingSourceRows() {
        val builder=NativePacketBuilder("world");val g=CuboidGeometry.create();val m=NativeRenderMaterial();builder.add(g,m,matrices(2050))
        val source=builder.build();val world=source.world!!
        assertEquals(listOf(1024,1024,2),world.packets.map{it.count});assertEquals(1,world.geometries.size);assertEquals(1,world.materials.size)
        var index=0
        for(packet in world.packets){val rows=world.instanceRows(packet);repeat(packet.count){assertEquals(index++.toFloat(),rows.getFloat(it*96+48),0f)}}
        assertEquals(2050,index)
    }
    @Test fun pixelOwnershipDimensionsAndSamplersAreIndependentOfGpuPixelReuse() {
        val input=ByteBuffer.wrap(ByteArray(8){it.toByte()});val first=NativePixelTexture(1,2,input,mipmaps=false,minFilter=1003)
        val differentSampler=NativePixelTexture(1,2,input,mipmaps=false,minFilter=1006,wrapS=1001)
        val differentShape=NativePixelTexture(2,1,input,mipmaps=false,minFilter=1003)
        assertEquals(first.sha256,differentShape.sha256);assertNotEquals(first.identity,differentShape.identity)
        assertEquals(first.identity,differentSampler.identity);assertNotEquals(first.samplingIdentity,differentSampler.samplingIdentity)
        input.put(0,99.toByte());assertEquals(0.toByte(),first.pixels().get(0))
        assertThrows(ReadOnlyBufferException::class.java){first.pixels().put(0,1.toByte())}
        val builder=NativePacketBuilder("reward:real-reward");val g=CuboidGeometry.create()
        for(texture in listOf(first,differentSampler,differentShape))builder.add(g,NativeRenderMaterial(texture=texture),matrices())
        val source=builder.build();assertEquals(3,source.textures.size);assertEquals(16L,source.footprint.textureBytes)
        assertEquals(listOf(1003,1006,1003),source.textures.map{it.metadata(0).getInt("minFilter")})
        assertEquals(listOf(0,1,2),source.world!!.materials.map{JSONObject(it).getInt("texture")})
        assertThrows(UnsupportedOperationException::class.java){(source.textures as MutableList).clear()}
    }
    @Test fun packetBoundsEncloseAllActualTransformedCornersAndKeepLodDescriptors() {
        val g=CuboidGeometry.create(2.0,3.0,4.0);val transform=BlockTransform.translation(-14.5,4.0,9.25)*BlockTransform.rotationY(.7)
        val data=FloatArray(16){transform[it].toFloat()};val builder=NativePacketBuilder("world")
        val lod=SceneryLod("village-0","full",Point3(-14.5f,4f,9.25f),4f)
        builder.add(g,NativeRenderMaterial(),FloatBuffer.wrap(data),lod=lod)
        val packet=builder.build().world!!.packets.single();assertEquals(lod,packet.lod)
        val actual=BlockTransform.fromElements(DoubleArray(16){data[it].toDouble()}).box(g.bounds!!)
        for(axis in 0..2){assertTrue(packet.bounds.min[axis]<=actual.min[axis]);assertTrue(packet.bounds.max[axis]>=actual.max[axis])}
        val copied=DoubleArray(16){transform[it]};val matrix=BlockTransform.fromElements(copied);copied[12]=999.0;assertEquals(-14.5,matrix[12],0.0)
    }
    @Test fun emptyOwnersRemainExplicitAndPackingDoesNotBorrowMutableCallerRowsAfterBuild() {
        val empty=NativePacketBuilder("building:empty").build();assertEquals("building:empty",empty.owner);assertNull(empty.world);assertEquals(0L,empty.footprint.geometryBytes)
        val input=FloatArray(16){BlockTransform.IDENTITY[it].toFloat()};val builder=NativePacketBuilder("building:copied")
        builder.add(CuboidGeometry.create(),NativeRenderMaterial(),FloatBuffer.wrap(input));val first=builder.build();input[12]=45f
        val packet=first.world!!.packets.single();assertEquals(0f,first.world.section(packet.instances).getFloat(48),0f)
        assertThrows(UnsupportedOperationException::class.java){(first.surfaces as MutableList).clear()}
    }
    @Test fun invalidOrCancelledUploadsFailBeforePublishingAnEngineInput() {
        val g=CuboidGeometry.create();val m=NativeRenderMaterial()
        assertThrows(IllegalArgumentException::class.java){NativePacketBuilder("../world")}
        assertThrows(IllegalArgumentException::class.java){NativePacketBuilder("world").add(g,m,FloatBuffer.wrap(FloatArray(15)))}
        assertThrows(IllegalArgumentException::class.java){NativePixelTexture(2,2,ByteBuffer.allocate(15))}
        for(values in listOf(FloatArray(16),FloatArray(16){if(it==15)1f else Float.NaN})) {
            val builder=NativePacketBuilder("world");builder.add(g,m,FloatBuffer.wrap(values));assertThrows(IllegalArgumentException::class.java){builder.build()}
        }
        val packed=NativePacketBuilder("world");packed.add(g,m,matrices(),aux=FloatBuffer.wrap(floatArrayOf(16777216f,0f,0f,0f)))
        assertThrows(IllegalArgumentException::class.java){packed.build()}
        val builder=NativePacketBuilder("world");builder.add(g,m,matrices(2050));var checks=0
        assertThrows(CancellationException::class.java){builder.build{++checks>4}};assertEquals(2050,builder.build().world!!.packets.sumOf{it.count})
    }
    @Test fun cullingBoundsComeFromActualUploadedPositionsRatherThanClaimedModelMetadata() {
        val cube=CuboidGeometry.create(4.0,6.0,8.0)
        val misleading=object:BlockGeometry by cube{override val bounds=BlockBox(BlockPoint(-.1,-.1,-.1),BlockPoint(.1,.1,.1))}
        val builder=NativePacketBuilder("world");builder.add(misleading,NativeRenderMaterial(),matrices());val world=builder.build().world!!
        assertEquals(-2f,world.geometries.single().bounds.min.x,0f);assertEquals(4f,world.geometries.single().bounds.max.z,0f)
        assertTrue(world.packets.single().bounds.min.y<=-3f);assertTrue(world.packets.single().bounds.max.y>=3f)
    }
}
