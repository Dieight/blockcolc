package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CancellationException

class NativeLightningCompilerTest {
    @Test fun oneBoundedPacketPreservesItsStaticIdentityAcrossStrikesAndIsStrictlyTyped(){
        val context=NativeStormContext(BlockPoint(0.0,3.0,0.0),60.0,60.0,40.0);val compiler=NativeLightningCompiler()
        val source=compiler.prepare(context);assertSame(source,compiler.prepare(context.copy()))
        val environment=NativeEnvironment.sample(0,java.util.TimeZone.getTimeZone("UTC"),NativeLightingQuality.HIGH,25.0,100.0,50.0).uniforms()
        source.validateRuntime(environment);assertEquals(PacketOwners.LIGHTNING,source.owner);assertEquals(NativePacketLayer.LIGHTNING,source.layer)
        assertEquals(1,source.world!!.packets.size);assertEquals(8,source.world!!.packets.single().count);assertTrue(source.surfaces.single().optics.lightning)
        assertThrows(IllegalArgumentException::class.java){source.validateRuntime(NativeSceneEnvironment(environment.lighting,environment.surfaceState))}
        assertThrows(CancellationException::class.java){compiler.prepare(context){true}}
        assertSame(source,compiler.prepare(context));compiler.clear();assertNotSame(source,compiler.prepare(context))
    }
    @Test fun dynamicRowsRemainInsideTheConservativePacketBoundsAtMaximumZoomCompensation(){
        val context=NativeStormContext(BlockPoint(-125.0,6.0,250.0),60.0,60.0,40.0)
        val source=NativeLightningCompiler().prepare(context);val packet=source.world!!.packets.single();val shape=source.world!!.geometries.single()
        val positions=source.world!!.section(shape.vertex);val runtime=NativeStormRuntime(context);runtime.configure(NativeStormWeather(true,0xffffffffL),0.0)
        repeat(5){
            val burst=runtime.update(runtime.nextStrikeAtMs,true).burst!!;val data=ByteBuffer.allocate(8*96).order(ByteOrder.nativeOrder())
            NativeLightningRows.write(burst.vertices,32.0,data);assertEquals(8*96,data.position());data.flip()
            repeat(8){row->val m=DoubleArray(16){data.getFloat(row*96+it*4).toDouble()};val transform=BlockTransform.fromElements(m)
                repeat(shape.vertexCount){v->val p=BlockPoint(positions.getFloat(v*48).toDouble(),positions.getFloat(v*48+4).toDouble(),positions.getFloat(v*48+8).toDouble())
                    val value=transform.point(p);for(axis in 0..2)assertTrue(value[axis]>=packet.bounds.min[axis]&&value[axis]<=packet.bounds.max[axis])}
            }
        }
    }
}
