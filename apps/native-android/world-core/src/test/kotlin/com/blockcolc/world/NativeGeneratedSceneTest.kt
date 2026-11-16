package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.junit.Assert.*
import org.junit.Test
import java.nio.FloatBuffer

class NativeGeneratedSceneTest {
    private fun source(owner:String,count:Int=1,material:NativeRenderMaterial=NativeRenderMaterial()):NativePacketSource {
        val builder=NativePacketBuilder(owner)
        if(count>0)builder.add(CuboidGeometry.create(),material,FloatBuffer.wrap(FloatArray(count*16){when(it%16){0,5,10,15->1f;12->(it/16).toFloat();else->0f}}))
        return builder.build()
    }
    private fun lighting(color:List<Float> = listOf(1f,.95f,.8f))=SourceLighting(1f,listOf(.1f,.2f,.3f),listOf(
        SourceLight("DirectionalLight",color,3f,listOf(0f,-1f,0f),listOf(0f,30f,0f),true,listOf(0f,0f,0f),0f,.01f),
        SourceLight("HemisphereLight",listOf(.7f,.8f,1f),1f,listOf(0f,1f,0f),listOf(0f,0f,0f),false,listOf(.2f,.3f,.2f),0f,0f)),true,emptyList())
    private fun camera()=NativeSceneCamera(BlockPoint(0.0,0.0,0.0),BlockPoint(14.0,20.0,24.0),35.0,40.0,
        SourceCamera(20.0,listOf(listOf(-20.0,-5.0,-20.0),listOf(20.0,15.0,20.0)),120.0,.82,.91,1.5,120.0))
    @Test fun completeSceneKeepsEmptyOwnersAndChargesSharedGeometryOnlyOnce() {
        val scene=NativeGeneratedScene(listOf(source("world"),source("building:a"),source("building:empty",0)),lighting(),SourcePost.NONE,camera(),4,9)
        assertEquals(listOf("world","building:a","building:empty"),scene.sources.map{it.owner})
        assertEquals(36*64L+36*4L,scene.footprint.geometryBytes);assertEquals(2*96L+32,scene.footprint.instanceBytes);assertEquals(4L,scene.footprint.textureBytes)
        assertEquals(4L,scene.generation);assertEquals(9L,scene.revision)
        val metadata=scene.camera.metadata();assertEquals("native-generated",metadata.getString("sourceKind"));assertEquals(14.0,metadata.getJSONObject("camera").getJSONArray("position").getDouble(0),0.0)
        assertEquals(20.0,SourceCamera.read(metadata.getJSONObject("cameraVolume")).framingRadius,0.0)
        assertThrows(UnsupportedOperationException::class.java){(scene.sources as MutableList).clear()}
    }
    @Test fun nativeSurfaceAndLightingSnapshotsDoNotFollowMutableProducerLists() {
        val colors=mutableListOf(1f,.95f,.8f);val direction=mutableListOf(0f,1f,0f);val applied=mutableListOf("native-face-and-edge")
        val material=NativeRenderMaterial(surface=SurfaceCoverage(SurfaceEffects(direction,listOf(1f,1f,1f),listOf(.9f,.9f,.9f),.4f,.025f),applied,emptyList()))
        val input=source("world",material=material);val scene=NativeGeneratedScene(listOf(input),lighting(colors),SourcePost.NONE,camera(),0,1)
        colors[0]=0f;direction[1]=-1f;applied.clear()
        assertEquals(1f,scene.lighting.lights.first().color[0],0f);assertEquals(1f,input.surfaces.first().effects.direction[1],0f)
        assertEquals(listOf("native-face-and-edge"),input.surfaces.first().applied)
        assertThrows(UnsupportedOperationException::class.java){(scene.lighting.lights as MutableList).clear()}
    }
    @Test fun replacementInventoryRetiresOnlyItsOwnerAndDoesNotRetainSourceBuffers() {
        val before=NativeGeneratedScene(listOf(source("world"),source("building:a"),source("building:b",0)),lighting(),SourcePost.NONE,camera(),0,1).inventory
        val more=before.replacing(source("building:b",3))
        assertEquals(5*96L+32,more.footprint.instanceBytes);assertEquals(2*96L+32,before.footprint.instanceBytes)
        assertEquals(before.footprint.geometryBytes,more.footprint.geometryBytes)
        val empty=more.replacing(source("building:a",0));assertEquals(4*96L+32,empty.footprint.instanceBytes)
        assertThrows(IllegalArgumentException::class.java){before.replacing(source("building:unknown"))}
        assertThrows(IllegalArgumentException::class.java){before.replacing(source("world"))}
    }
    @Test fun invalidWorldEnvelopesAndUnimplementedRuntimeLayersCannotBeAdoptedAsStaticSuccess() {
        fun reject(inputs:List<NativePacketSource>)=assertThrows(IllegalArgumentException::class.java){NativeGeneratedScene(inputs,lighting(),SourcePost.NONE,camera(),0,1)}
        reject(emptyList());reject(listOf(source("building:a")));reject(listOf(source("world",0)));val root=source("world");reject(listOf(root,root))
        reject(listOf(source("world",material=NativeRenderMaterial(surface=SurfaceCoverage(SurfaceEffects.NONE,emptyList(),listOf("not-ported"))))))
        reject(listOf(source("world",material=NativeRenderMaterial(surface=SurfaceCoverage(SurfaceEffects.NONE,emptyList(),emptyList(),SurfaceOptics(sky=true))))))
        assertThrows(IllegalArgumentException::class.java){NativeGeneratedScene(listOf(root),lighting().copy(exposure=Float.NaN),SourcePost.NONE,camera(),0,1)}
        assertThrows(IllegalArgumentException::class.java){NativeGeneratedScene(listOf(root),lighting(),SourcePost.NONE,camera(),-1,1)}
        assertThrows(IllegalArgumentException::class.java){NativeSceneCamera(BlockPoint(0.0,0.0,0.0),BlockPoint(-0.0,0.0,0.0),1.0,40.0,camera().volume)}
    }
}
