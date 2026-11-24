package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.FloatBuffer
import java.security.MessageDigest
import java.util.concurrent.CancellationException
import kotlin.math.sqrt

class NativeWorldInteractionTest {
    private val oracle by lazy{JSONObject(javaClass.getResource("/native-interaction-oracle.json")!!.readText())}
    private fun point(a:JSONArray)=BlockPoint(a.getDouble(0),a.getDouble(1),a.getDouble(2))
    private fun camera(input:JSONObject):NativeSceneCamera {
        val low=point(input.getJSONArray("low"));val high=point(input.getJSONArray("high"));val delta=NativeWorldNavigation.sub(high,low)
        val radius=sqrt(NativeWorldNavigation.dot(delta,delta))/2
        val target=BlockPoint((low.x+high.x)/2,kotlin.math.max(1.5,(low.y+high.y)/2*.68),(low.z+high.z)/2)
        val volume=SourceCamera(radius,listOf(listOf(low.x,low.y,low.z),listOf(high.x,high.y,high.z)),360.0,.82,.91,1.5,360.0)
        return NativeSceneCamera(target,BlockPoint(target.x+20,target.y+20,target.z+20),100.0,40.0,volume)
    }
    private fun targets(input:JSONObject)=input.getJSONArray("targets").let{a->List(a.length()){i->a.getJSONObject(i).let{NativeOrbitTarget(it.getString("id"),point(it.getJSONArray("position")),it.getDouble("width"),it.getDouble("depth"),it.getDouble("height"))}}}
    private fun assertFrame(expected:JSONObject,actual:NativeOrbitFrame){
        assertEquals(expected.optString("selected").takeUnless{it=="null"||it.isEmpty()},actual.selected)
        for((key,value)in listOf("distance" to actual.distance,"fitted" to actual.fitted,"minimum" to actual.minimum,"maximum" to actual.maximum,"pitch" to actual.pitch,"azimuth" to actual.azimuth))assertEquals(key,expected.getDouble(key),value,1e-9)
        val target=expected.getJSONArray("target");repeat(3){assertEquals(target.getDouble(it),actual.target[it],1e-9)}
    }
    @Test fun cameraAndRaycastReferencesAreBoundToCurrentSource(){
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/voxel/src/renderer.ts").exists()}
        val hashes=oracle.getJSONObject("sourceHashes");hashes.keys().forEach{file->assertEquals(file,hashes.getString(file),MessageDigest.getInstance("SHA-256").digest(File(root,file).readBytes()).joinToString(""){"%02x".format(it.toInt()and 255)})}
    }
    @Test fun paperProjectionAndRayIncludeForegroundInFrontOfTheOrbit(){
        val camera=NativeSceneCamera(BlockPoint(0.0,2.0,0.0),BlockPoint(8.0,6.0,8.0),24.0,40.0,
            SourceCamera(8.0,listOf(listOf(-80.0,-8.0,-80.0),listOf(80.0,40.0,80.0)),360.0,.82,.91,1.5,360.0),
            paper=true)
        val navigation=NativeWorldNavigation(camera,emptyList(),.75)
        val frame=navigation.frame
        val point=BlockPoint(frame.eye.x+1.0,frame.eye.y+1.0,frame.eye.z+1.0)
        val screen=checkNotNull(navigation.screen(point,720,960))
        val ray=navigation.ray(screen.first,screen.second,720,960)
        val difference=NativeWorldNavigation.sub(point,ray.origin)
        assertTrue(NativeWorldNavigation.dot(difference,ray.direction)>0)
        assertEquals(0.0,NativeWorldNavigation.cross(difference,ray.direction).let{NativeWorldNavigation.dot(it,it)},1e-8)
    }
    @Test fun pixelCameraSnapsTheProjectionAndRayTogetherWithoutChangingOrbitDistance(){
        val camera=NativeSceneCamera(BlockPoint(13.0,2.0,9.0),BlockPoint(21.0,6.0,17.0),24.0,40.0,
            SourceCamera(12.0,listOf(listOf(-80.0,-8.0,-80.0),listOf(80.0,40.0,80.0)),360.0,.82,.91,1.5,360.0),paper=true)
        val orbit=NativeWorldNavigation(camera,emptyList(),.75)
        val base=orbit.frame
        orbit.pixelGrid(11,960);orbit.drag(15.0,9.0)
        assertTrue(orbit.settlePixelOrbit());assertFalse(orbit.settlePixelOrbit())
        val snapped=orbit.frame
        assertEquals(base.distance,snapped.distance,0.0)
        val angle=snapped.azimuth/(kotlin.math.PI/90)
        assertEquals(kotlin.math.round(angle),angle,1e-9)
        val expected=NativeWorldNavigation.sub(base.target,snapped.target)
        val forward=NativeWorldNavigation.unit(NativeWorldNavigation.sub(snapped.target,snapped.eye))
        assertEquals(0.0,NativeWorldNavigation.dot(forward,expected),1e-8)
        val screen=checkNotNull(orbit.screen(base.target,720,960))
        val ray=orbit.ray(screen.first,screen.second,720,960)
        val fromRay=NativeWorldNavigation.sub(base.target,ray.origin)
        val error=NativeWorldNavigation.cross(fromRay,ray.direction)
        assertEquals(0.0,NativeWorldNavigation.dot(error,error),1e-8)
        orbit.pixelGrid(0,960)
        assertEquals(base.target,orbit.frame.target)
    }
    @Test fun focusAndBothResetsMatchActualRendererAcrossAspectsAndWorldSizes(){
        val cases=oracle.getJSONArray("cameras");assertEquals(10,cases.length())
        repeat(cases.length()){i->val case=cases.getJSONObject(i);val input=case.getJSONObject("input");val navigation=NativeWorldNavigation(camera(input),targets(input),input.getDouble("aspect"));val frames=case.getJSONArray("frames")
            assertFrame(frames.getJSONObject(0),navigation.frame)
            val commands=input.getJSONArray("commands");repeat(commands.length()){n->val command=commands.getJSONObject(n)
                when(command.getString("kind")){"focus"->assertTrue(navigation.focus(command.getString("id")));"reset"->navigation.resetView();"map"->navigation.resetMap();"resize"->navigation.resize(command.getDouble("aspect"))}
                assertFrame(frames.getJSONObject(n+1),navigation.frame)
            }
        }
    }
    @Test fun openingZoomUsesAVisibleFrameClockAndCommitsTheNormalFocusedLimits(){
        val input=oracle.getJSONArray("cameras").getJSONObject(0).getJSONObject("input")
        val aspect=input.getDouble("aspect");val objects=targets(input);val id=objects.first().id
        fun navigation()=NativeWorldNavigation(camera(input),objects,aspect)
        val expected=navigation().apply{focus(id)}.frame
        val animated=navigation();animated.prepareOpening(id)
        val from=animated.frame
        assertTrue(animated.openingActive);assertEquals(id,from.selected)
        assertTrue(animated.advanceOpening(50_000_000_000));assertEquals(from,animated.frame)
        animated.advanceOpening(50_750_000_000)
        assertEquals(kotlin.math.sqrt(from.distance*expected.distance),animated.frame.distance,1e-8)
        animated.advanceOpening(51_500_000_000)
        assertFalse(animated.openingActive);assertEquals(expected,animated.frame)
        animated.drag(12.0,0.0);assertEquals(expected.target,animated.frame.target)
        assertEquals(expected.distance,animated.frame.distance,0.0)
        animated.resetMap();assertNull(animated.frame.selected)
        val reduced=navigation();reduced.prepareOpening(id,true)
        assertFalse(reduced.openingActive);assertEquals(expected,reduced.frame)
    }
    @Test fun minimalOpeningEndsAtTheExistingSettlementCompositionAndManualInputStopsIt(){
        val input=oracle.getJSONArray("cameras").getJSONObject(0).getJSONObject("input")
        val nav=NativeWorldNavigation(camera(input),targets(input),input.getDouble("aspect"));val expected=nav.frame
        nav.prepareOpening(null);val from=nav.frame.distance;assertTrue(from>=expected.distance)
        nav.advanceOpening(0);nav.advanceOpening(1_500_000_000)
        assertEquals(expected,nav.frame);assertFalse(nav.openingActive)
        nav.prepareOpening(null);nav.advanceOpening(0);nav.drag(1.0,0.0)
        assertFalse(nav.openingActive);assertFalse(nav.advanceOpening(2_000_000_000))
    }
    @Test fun openingRecomputesItsEndpointsAfterAViewportResizeWithoutRestartingItsClock(){
        val input=oracle.getJSONArray("cameras").getJSONObject(0).getJSONObject("input")
        val aspect=input.getDouble("aspect");val objects=targets(input);val id=objects.first().id
        for(selected in listOf(id,null)){
            val actual=NativeWorldNavigation(camera(input),objects,aspect);actual.prepareOpening(selected)
            actual.advanceOpening(50_000_000_000);actual.advanceOpening(50_500_000_000)
            actual.resize(aspect*1.7);actual.advanceOpening(50_750_000_000)
            val expected=NativeWorldNavigation(camera(input),objects,aspect*1.7);expected.prepareOpening(selected)
            expected.advanceOpening(50_000_000_000);expected.advanceOpening(50_750_000_000)
            assertEquals(expected.frame.distance,actual.frame.distance,1e-8)
            assertEquals(expected.frame.target,actual.frame.target)
            actual.advanceOpening(51_500_000_000);expected.advanceOpening(51_500_000_000)
            assertEquals(expected.frame,actual.frame);assertFalse(actual.openingActive)
        }
    }
    @Test fun openingExcludesTheBackgroundIntervalFromItsVisibleClock(){
        val input=oracle.getJSONArray("cameras").getJSONObject(0).getJSONObject("input")
        val nav=NativeWorldNavigation(camera(input),targets(input),input.getDouble("aspect"))
        nav.prepareOpening(null);nav.advanceOpening(0);nav.advanceOpening(500_000_000)
        val beforePause=nav.frame;nav.pauseOpening();nav.advanceOpening(30_000_000_000)
        assertEquals(beforePause,nav.frame);assertTrue(nav.openingActive)
        nav.advanceOpening(31_000_000_000);assertFalse(nav.openingActive)
    }
    private fun sources():List<NativePacketSource> {
        val raw=oracle.getJSONArray("sources")
        return List(raw.length()){index->val item=raw.getJSONObject(index);val position=item.getJSONArray("positions");val normal=item.getJSONArray("normals");val indices=item.getJSONArray("indices");val matrix=item.getJSONArray("matrices")
            val geometry=AttributeBlockGeometry(FloatArray(position.length()){position.getDouble(it).toFloat()},FloatArray(normal.length()){normal.getDouble(it).toFloat()},index=IntArray(indices.length()){indices.getInt(it)})
            NativePacketBuilder(item.getString("owner")).apply{add(geometry,NativeRenderMaterial(side=NativeFaceSide.entries.first{it.code==item.getInt("side")},opacity=item.getDouble("opacity").toFloat(),transparent=item.getDouble("opacity")<1),FloatBuffer.wrap(FloatArray(matrix.length()){matrix.getDouble(it).toFloat()}))}.build()
        }
    }
    @Test fun trianglesHolesSidesMirrorsNearestOwnersAndInstanceScalesMatchThree(){
        val index=NativeWorldPickCompiler().prepare(sources());val rays=oracle.getJSONArray("rays");assertEquals(1166,rays.length())
        assertFalse("world" in index.ids)
        repeat(rays.length()){i->val item=rays.getJSONObject(i);val actual=index.pick(NativePickRay(point(item.getJSONArray("origin")),point(item.getJSONArray("direction"))))
            if(item.isNull("hit"))assertNull("ray $i",actual)else {val expected=item.getJSONObject("hit");assertNotNull("ray $i",actual);assertEquals("ray $i",expected.getString("id"),actual!!.id);assertEquals("ray $i",expected.getDouble("distance"),actual.distance,1e-5)}
        }
    }
    @Test fun sceneReplacementPrunesOwnersAndCancellationDoesNotPublishHalfAnIndex(){
        val compiler=NativeWorldPickCompiler();val sources=sources();val first=compiler.prepare(sources);val ray=NativePickRay(BlockPoint(0.0,0.0,20.0),BlockPoint(0.0,0.0,-1.0))
        assertEquals("near",first.pick(ray)!!.id)
        try{compiler.prepare(sources){true};fail("cancelled prepare adopted")}catch(_:CancellationException){}
        assertEquals("near",first.pick(ray)!!.id)
        val next=compiler.prepare(sources.filter{it.owner!="building:near"});assertEquals("far",next.pick(ray)!!.id);assertFalse("near" in next.ids)
        compiler.clear();assertEquals("near",first.pick(ray)!!.id)
    }
    @Test fun unchangedStaticInputsReuseTheCompleteIndexButChangedOwnersAndContractsDoNot(){
        val compiler=NativeWorldPickCompiler();val sources=sources()
        val first=compiler.prepare(sources+NativeInteriorCompiler.empty(),true)
        assertSame(first,compiler.prepare(sources+NativeInteriorCompiler.empty(),true))
        assertThrows(CancellationException::class.java){compiler.prepare(sources,true){true}}
        val withoutOcclusion=compiler.prepare(sources,false);assertNotSame(first,withoutOcclusion)
        val reordered=compiler.prepare(sources.reversed(),false);assertNotSame(withoutOcclusion,reordered)
        val replaced=compiler.prepare(sources(),false);assertNotSame(reordered,replaced)
        assertEquals(withoutOcclusion.ids,replaced.ids)
        compiler.clear();assertNotSame(replaced,compiler.prepare(sources,false))
    }
    @Test fun pivotGesturesClampAndRemovedSelectionReturnsToMapWithoutMutatingScene(){
        val input=oracle.getJSONArray("cameras").getJSONObject(0).getJSONObject("input");val camera=camera(input);val targets=targets(input)
        val navigation=NativeWorldNavigation(camera,targets,input.getDouble("aspect"));assertTrue(navigation.focus("a"))
        val focused=navigation.frame;assertFalse(navigation.focus("not-in-scene"));assertEquals(focused,navigation.frame)
        navigation.drag(20.0,-8.0);assertEquals(focused.azimuth+.22,navigation.frame.azimuth,1e-12)
        navigation.pinch(1.0,10000.0);assertEquals(navigation.frame.minimum,navigation.frame.distance,0.0)
        navigation.pinch(10000.0,1.0);assertEquals(navigation.frame.maximum,navigation.frame.distance,0.0)
        val moved=navigation.frame;navigation.adopt(camera,targets,false);assertEquals(moved,navigation.frame)
        navigation.adopt(camera,targets.filter{it.id!="a"},false);assertNull(navigation.frame.selected)
        navigation.resetMap();val screen=navigation.screen(navigation.frame.target,600,900)!!;assertEquals(300.0,screen.first,1e-8);assertEquals(450.0,screen.second,1e-8)
        val ray=navigation.ray(300.0,450.0,600,900);val toTarget=NativeWorldNavigation.unit(NativeWorldNavigation.sub(navigation.frame.target,navigation.frame.eye))
        repeat(3){assertEquals(toTarget[it],ray.direction[it],1e-12)}
    }
    @Test fun queuedPickResultsAreRejectedAfterEveryInvalidationAndQueriesCooperateWithCancellation(){
        val gate=NativePickGate();assertFalse(gate.accepts(0));val first=gate.issue();assertTrue(gate.accepts(first))
        val second=gate.issue();assertFalse(gate.accepts(first));assertTrue(gate.accepts(second))
        gate.invalidate();assertFalse(gate.accepts(second));val resumed=gate.issue();assertTrue(gate.accepts(resumed));gate.invalidate();assertFalse(gate.accepts(resumed))
        val index=NativeWorldPickCompiler().prepare(sources());val ray=NativePickRay(BlockPoint(0.0,0.0,20.0),BlockPoint(0.0,0.0,-1.0))
        try{Thread.currentThread().interrupt();assertThrows(CancellationException::class.java){index.pick(ray)}}finally{Thread.interrupted()}
        assertEquals("near",index.pick(ray)!!.id)
    }
}
