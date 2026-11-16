package com.blockcolc.world

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import kotlin.math.PI

class SourceCloudTest {
    @Test fun connectedCloudWrapsAndNegativeCoordinatesMatchSourceModulo() {
        val cloud=SourceCloud.read(JSONObject("{cloudElapsed:0,cloudSpan:[100,80]}"))
        assertEquals(listOf(2f,3f),cloud.offset(listOf(12f,-20f),listOf(2f,3f),1f))
        assertEquals(listOf(-96f,0f),cloud.offset(listOf(48f,0f),listOf(2f,0f),2f))
        assertEquals(listOf(96f,0f),cloud.offset(listOf(-48f,0f),listOf(-2f,0f),2f))
        assertThrows(IllegalArgumentException::class.java){SourceCloud.read(JSONObject("{cloudElapsed:0,cloudSpan:[0,80]}"))}
    }
    @Test fun sourceDiffuseIsNotAnApproximateRoughPbrSurface() {
        val lighting=SourceLighting(1f,List(3){0f},listOf(
            SourceLight("DirectionalLight",listOf(.8f,.6f,.4f),3f,listOf(0f,-1f,0f),List(3){0f},false,List(3){0f},0f,0f),
            SourceLight("HemisphereLight",listOf(.7f,.8f,.9f),2f,listOf(0f,1f,0f),List(3){0f},false,listOf(.2f,.3f,.4f),0f,0f)
        ),false,emptyList())
        val lambert=SourceLambert.read(lighting,Bounds(Point3(-1f,20f,-1f),Point3(1f,30f,1f)))
        val top=lambert.irradiance(listOf(0f,1f,0f));val bottom=lambert.irradiance(listOf(0f,-1f,0f))
        assertEquals((.7*2+.8*3)/PI,top[0].toDouble(),1e-6);assertEquals(.2*2/PI,bottom[0].toDouble(),1e-6)
        val point=lighting.copy(lights=lighting.lights+SourceLight("PointLight",List(3){1f},5f,List(3){0f},listOf(0f,25f,0f),false,List(3){0f},10f,0f))
        assertThrows(IllegalArgumentException::class.java){SourceLambert.read(point,Bounds(Point3(-1f,20f,-1f),Point3(1f,30f,1f)))}
    }
}
