package com.blockcolc.preview

import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.view.MotionEvent
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.filters.SdkSuppress
import com.blockcolc.world.NativeBlueprintPreviewScene
import com.blockcolc.world.NativeGlassRegion
import com.blockcolc.world.filament.NativeWorldView
import com.blockcolc.world.generation.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Actual native pixels from the submitted world. The isolated Activity never
 * opens the application database or changes a focus plan. Captures are test
 * evidence only; production glass performs no readback. */
@SdkSuppress(minSdkVersion=24)
class P3NativeGlassCaptureTest {
    @get:Rule val foreground=ActivityScenarioRule(P3DerivedCacheCheckActivity::class.java)
    @Test fun sameFrameGpuGlassPreservesOutsidePixelsAndMovesWithTheWorld(){
        val cpu=NativeBlueprintPreviewScene()
        val parsed=BlueprintSnapshot.read(BuiltinBlueprintCatalog.load().content("builtin-small-workshop").json())
        val scene=try{cpu.prepare(parsed,false,.75)}finally{cpu.clear()}
        val ready=CountDownLatch(1);val error=AtomicReference<String>()
        foreground.scenario.onActivity{activity->activity.onGeneratedFrame={if(it==scene.presentationIdentity)ready.countDown()}
            activity.onGeneratedError={error.set(it);ready.countDown()};activity.presentGenerated(scene)}
        assertTrue(ready.await(60,TimeUnit.SECONDS));assertNull(error.get())
        fun facts():JSONObject {
            val done=CountDownLatch(1);val result=AtomicReference<JSONObject>()
            foreground.scenario.onActivity{it.generatedWorld!!.generatedDiagnostics(false){json->result.set(json);done.countDown()}}
            assertTrue(done.await(10,TimeUnit.SECONDS));return result.get()
        }
        fun presented(after:Int){
            val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(10)
            while(System.nanoTime()<deadline){if(facts().getInt("frames")>after)return;android.os.SystemClock.sleep(20)}
            fail("No world frame was submitted after the glass change")
        }
        fun fence(){
            val ready=CountDownLatch(1)
            foreground.scenario.onActivity{activity->val view=checkNotNull(activity.generatedWorld);view.projectionWindow(view.height,0){ready.countDown()}}
            assertTrue("The rendered frame did not reach its GPU/display fence",ready.await(15,TimeUnit.SECONDS))
        }
        fun capture(name:String):Bitmap{
            val copied=CountDownLatch(1);val result=AtomicReference<Bitmap>();val success=AtomicReference(false)
            foreground.scenario.onActivity{activity->val view=checkNotNull(activity.generatedWorld)
                val bitmap=Bitmap.createBitmap(view.width,view.height,Bitmap.Config.ARGB_8888);result.set(bitmap)
                assertTrue(view.copyBackdrop(bitmap,Handler(Looper.getMainLooper())){ok->success.set(ok);copied.countDown()})}
            assertTrue(copied.await(10,TimeUnit.SECONDS));assertTrue(success.get())
            foreground.scenario.onActivity{activity->val file=File(activity.filesDir,"p3-glass-$name.png");file.outputStream().use{result.get().compress(Bitmap.CompressFormat.PNG,100,it)}}
            return result.get()
        }
        fence();val before=capture("source");val frames=facts().getInt("frames")
        foreground.scenario.onActivity{activity->val view=checkNotNull(activity.generatedWorld)
            view.glassRegions(listOf(NativeGlassRegion(0f,0f,1f,.6f,12f/view.width,12f/view.height,1f,.45f,1f)))}
        presented(frames);fence();val glass=capture("glass")
        val pipeline=facts().getJSONObject("colorPipeline")
        assertEquals("same-frame-gpu",pipeline.getString("glassSampling"));assertEquals(1,pipeline.getInt("glassRegions"))
        fun mean(bitmap:Bitmap,y0:Int,y1:Int):Double{var sum=0.0;var n=0;for(y in y0 until y1 step 5)for(x in 0 until bitmap.width step 5){val pixel=bitmap.getPixel(x,y);sum+=((pixel shr 16)and 255)+((pixel shr 8)and 255)+(pixel and 255);n+=3};return sum/n}
        var errorSum=0.0;var samples=0
        for(y in 8 until (before.height*.35).toInt() step 5)for(x in 8 until before.width-8 step 5){val a=before.getPixel(x,y);val b=glass.getPixel(x,y);for(shift in listOf(0,8,16)){errorSum+=kotlin.math.abs(((a shr shift)and 255)-((b shr shift)and 255));samples++}}
        assertTrue("Non-glass pixels changed or UVs/tone mapping were applied twice: ${errorSum/samples}",errorSum/samples<2.0)
        val bottom=(before.height*.45).toInt()
        assertTrue("No actual GPU finish was visible inside the registered panel",mean(glass,bottom,glass.height)<mean(before,bottom,before.height)*.7)
        val oldFrames=facts().getInt("frames")
        foreground.scenario.onActivity{activity->val view=checkNotNull(activity.generatedWorld);val now=android.os.SystemClock.uptimeMillis()
            fun touch(action:Int,x:Float,y:Float,time:Long){val event=MotionEvent.obtain(now,time,action,x,y,0);view.onTouchEvent(event);event.recycle()}
            touch(MotionEvent.ACTION_DOWN,view.width*.4f,view.height*.35f,now)
            touch(MotionEvent.ACTION_MOVE,view.width*.7f,view.height*.4f,now+60)
            touch(MotionEvent.ACTION_UP,view.width*.7f,view.height*.4f,now+90)
        }
        presented(oldFrames);fence();capture("rotated")
        val live=facts().getJSONObject("colorPipeline");assertEquals(1,live.getInt("glassRegions"))
        val beforeClear=facts().getInt("frames");foreground.scenario.onActivity{it.generatedWorld!!.glassRegions(emptyList())};presented(beforeClear)
        assertEquals(0,facts().getJSONObject("colorPipeline").getInt("glassRegions"))
        // Verify the submitted shader, not only CPU material parameters. A
        // fully covered output may contain roofs, sky and arbitrary shadows.
        for(whiteInk in listOf(false,true)){
            val previous=facts().getInt("frames")
            foreground.scenario.onActivity{activity->activity.generatedWorld!!.glassRegions(listOf(
                NativeGlassRegion(0f,0f,1f,1f,0f,0f,1f,1f,if(whiteInk).42f else 1f,if(whiteInk)0f else .48f)))}
            presented(previous);fence();val image=capture(if(whiteInk)"reading-dark"else"reading-light")
            for(y in 8 until image.height-8 step 17)for(x in 8 until image.width-8 step 17){
                val pixel=image.getPixel(x,y)
                for(shift in listOf(0,8,16)){
                    val channel=((pixel shr shift)and 255)/255.0
                    if(whiteInk)assertTrue("GPU ceiling was not applied: $channel",channel<=.42+3.0/255)
                    else assertTrue("GPU floor was not applied: $channel",channel>=.48-3.0/255)
                }
            }
            image.recycle()
        }
    }
}
