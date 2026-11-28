package com.blockcolc.world.filament

import android.content.Context
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.view.Choreographer
import android.view.MotionEvent
import android.view.Surface
import android.view.SurfaceView
import android.widget.FrameLayout
import com.google.android.filament.*
import com.google.android.filament.android.UiHelper
import com.blockcolc.world.SourceLighting
import com.blockcolc.world.SourceLight
import com.blockcolc.world.SourcePost
import com.blockcolc.world.SourceWorldColor
import com.blockcolc.world.NativeColorEncoding
import com.blockcolc.world.WorldRuntimeClock
import com.blockcolc.world.SourceCamera
import com.blockcolc.world.CameraFrame
import com.blockcolc.world.NativeGeneratedScene
import com.blockcolc.world.NativeInteriorScene
import com.blockcolc.world.NativeInteriorCompiler
import com.blockcolc.world.NativeSceneEnvironment
import com.blockcolc.world.NativeSceneCamera
import com.blockcolc.world.NativePacketSource
import com.blockcolc.world.PacketOwners
import com.blockcolc.world.NativeViewportWindow
import com.blockcolc.world.NativeWorldNavigation
import com.blockcolc.world.NativeWorldPickIndex
import com.blockcolc.world.NativeOrbitTarget
import com.blockcolc.world.NativeOrbitFrame
import com.blockcolc.world.NativePickGate
import org.json.JSONObject
import java.io.File
import kotlin.math.*

class NativeWorldView(context: Context, private val fixture: String, private val projectionOnly: Boolean,
                      private val cullingEnabled: Boolean, private val surfaceEffects: Boolean,
                      private val shadowsEnabled: Boolean, private val colorProbe: Boolean, private val surfaceOptics:Boolean,
                      private val nightReflections:Boolean,
                      private val fogEnabled:Boolean,
                      private val runtimeEnabled:Boolean,
                      private val weatherOnly:Boolean,
                      private val animalOnly:Boolean,
                      private val animalProbe:String?,
                      private val benchmarkRun:String?,
                      private val skyProbe:Boolean,
                      private val moonProbe:Boolean,
                      private val initialConstruction:Int?=null,
                      generatedInput:NativeGeneratedScene?=null,
                      private val generatedFrame:((Long,Long,Long)->Unit)?=null,
                      private val generatedSelection:((Long,Long,Long,String)->Unit)?=null,
                      private val fixedGeneratedCamera:Boolean=false,
                      private val optimizeRendering:Boolean=false,
                      private val onCameraMoved:(()->Unit)?=null,
                      private val status: (String)->Unit): FrameLayout(context), Choreographer.FrameCallback {
    companion object {
        fun preview(context:Context,input:NativeGeneratedScene,reducedMotion:Boolean,onFrame:(Long,Long,Long)->Unit,status:(String)->Unit)=NativeWorldView(
            context=context,fixture="native-blueprint-preview",projectionOnly=false,cullingEnabled=true,surfaceEffects=true,shadowsEnabled=true,colorProbe=false,
            surfaceOptics=true,nightReflections=true,fogEnabled=true,runtimeEnabled=!reducedMotion&&runCatching{
                if(android.os.Build.VERSION.SDK_INT>=26)android.animation.ValueAnimator.areAnimatorsEnabled()
                else android.provider.Settings.Global.getFloat(context.contentResolver,android.provider.Settings.Global.ANIMATOR_DURATION_SCALE,1f)>0f
            }.getOrDefault(false),weatherOnly=false,animalOnly=false,animalProbe=null,benchmarkRun=null,
            skyProbe=false,moonProbe=false,generatedInput=input,generatedFrame=onFrame,status=status)
        fun generated(context:Context,input:NativeGeneratedScene,onFrame:(Long,Long,Long)->Unit,status:(String)->Unit,onSelection:((Long,Long,Long,String)->Unit)?=null,fixedCamera:Boolean=false,optimizeRendering:Boolean=true,onCameraMoved:(()->Unit)?=null)=NativeWorldView(
            context=context,fixture="native-generated",projectionOnly=false,cullingEnabled=true,surfaceEffects=true,shadowsEnabled=true,colorProbe=false,
            surfaceOptics=true,nightReflections=true,fogEnabled=true,runtimeEnabled=true,weatherOnly=false,animalOnly=false,animalProbe=null,benchmarkRun=null,
            skyProbe=false,moonProbe=false,generatedInput=input,generatedFrame=onFrame,generatedSelection=onSelection,fixedGeneratedCamera=fixedCamera,optimizeRendering=optimizeRendering,onCameraMoved=onCameraMoved,status=status)
    }
    private val generatedMode=!BuildConfig.NATIVE_DIAGNOSTICS||generatedInput!=null
    private var pendingGenerated=generatedInput
    private var generatedOwners=emptyMap<String,String>()
    private var generatedGeneration=-1L;private var generatedRevision=-1L
    private var pendingGeneratedFrame:Triple<Long,Long,Long>?=null
    private var generatedSubmittedFrames=0L
    private fun platformMotionAllowed()=runCatching{
        if(android.os.Build.VERSION.SDK_INT>=26)android.animation.ValueAnimator.areAnimatorsEnabled()
        else android.provider.Settings.Global.getFloat(context.contentResolver,android.provider.Settings.Global.ANIMATOR_DURATION_SCALE,1f)>0f
    }.getOrDefault(false)
    private var stormMotionAllowed=platformMotionAllowed()
    private var generatedReadyFrames=0L
    private var generatedSubmittedNs=0L
    private var generatedGpuCompleteNs=0L
    private var generatedAdoptionStartedNs=0L
    private var generatedAdoptionEndedNs=0L
    @Volatile private var generatedNotifiedFrames=0L
    @Volatile private var generatedUiFrame=0
    @Volatile private var nativeWindowChanges=0
    @Volatile private var nativeWindowDetaches=0
    @Volatile private var nativeWindowResizes=0
    @Volatile private var nativeWindowRetirements=0
    @Volatile private var nativeWindowRetirementFailures=0
    @Volatile private var longestWindowRetirementNs=0L
    private val surfaceLease=RenderSurfaceLease()
    @Volatile private var generatedPresentation=-1L
    private var generatedEnvironmentVersion=-1L
    private var generatedEnvironmentUpdates=0L
    private var generatedEnvironmentFailures=0L
    private var presentationFence:Fence?=null
    private var projectionFence:Fence?=null;@Volatile private var projectionTicket=0L
    private class ProjectionReceipt(val surfaceWidth:Int,val callback:()->Unit){val delivered=java.util.concurrent.atomic.AtomicBoolean(false)}
    private var pendingProjectionFrame=false;private var projectionReceipt:ProjectionReceipt?=null
    private var generatedPost:SourcePost?=null
    private val main=Handler(Looper.getMainLooper())
    private val thread=HandlerThread("blockcolc-native-world").apply { start() }
    private val render=Handler(thread.looper)
    private val surface=SurfaceView(context)
    private val helper=UiHelper(UiHelper.ContextErrorPolicy.DONT_CHECK)
    private var engine: Engine?=null
    private var renderer: Renderer?=null
    private var scene: Scene?=null
    private var view: com.google.android.filament.View?=null
    private var camera: Camera?=null
    private var swap: SwapChain?=null
    private var packets: PacketRenderer?=null
    private var indirect: IndirectLight?=null
    private var sky: Skybox?=null
    private var colorPipeline:NativeColorPipeline?=null
    private var desiredGlassRegions:List<com.blockcolc.world.NativeGlassRegion> = emptyList()
    private var sourceLighting:SourceLighting?=null
    private var directionalShadows: DirectionalShadowCache? = null
    private var shadowCamera: NativeSceneCamera? = null
    private var shadowLight: SourceLight? = null
    private var shadowLightEntity = 0
    private var useStockDirectionalShadows = false
    private var frameQueue: WorldFrameQueue? = null
    private var gestureChangedCamera = false
    private var cameraEntity=0;private val lightEntities=mutableListOf<Int>()
    @Volatile private var active=false;private var failed=false;@Volatile private var closed=false;private var submitted=false
    private var frameRequested=false
    private val clock=WorldRuntimeClock()
    private var lastDrawNs=0L
    private var cameraDirty=true
    private var logicalHeight=960.0
    @Volatile private var focused=false
    private var orbit:OrbitMeasurement?=null
    private var orbitStart=0.0
    override fun onWindowFocusChanged(hasWindowFocus:Boolean){super.onWindowFocusChanged(hasWindowFocus);focused=hasWindowFocus}
    override fun onSizeChanged(w:Int,h:Int,oldw:Int,oldh:Int){
        super.onSizeChanged(w,h,oldw,oldh)
        visibleRegion(visibleBottom)
        if(h>0)render.post{logicalHeight=h.toDouble()/resources.displayMetrics.density;cameraDirty=true;requestFrame()}
    }
    private var pendingOwnerReport:JSONObject?=null
    private var firstFrameResources:JSONObject?=null
    private var businessRevision=-1L
    private var businessProgress=10000
    private var pendingBusinessReport:JSONObject?=null
    private var runtimeSampleId=0
    private fun requestFrame() {
        if(active&&!closed&&!failed&&!frameRequested&&surfaceLease.frameTicket()!=null){frameRequested=true;Choreographer.getInstance().postFrameCallback(this)}
    }
    private var lastX=0f;private var lastY=0f
    private val target=DoubleArray(3)
    private var radius=24.0;private var fitted=24.0;private var pitch=.6;private var azimuth=0.0;private var fov=40.0
    private var sourceCamera:SourceCamera?=null
    private var navigation:NativeWorldNavigation?=null
    private var pickIndex=NativeWorldPickIndex.EMPTY
    private var orbitTargets=emptyList<NativeOrbitTarget>()
    private var lastPickMs=0.0
    private var pickCount=0L
    private var lastPickId:String?=null
    private var lastPickThread:String?=null
    private val pickGate=NativePickGate()
    private val pickWorker=java.util.concurrent.ScheduledThreadPoolExecutor(1){task->Thread(task,"blockcolc-native-pick")}.apply{removeOnCancelPolicy=true}
    private var pickFuture:java.util.concurrent.Future<*>?=null
    private var previousNavigation:NativeOrbitFrame?=null
    private var currentInterior:NativeInteriorScene?=null
    private var interiorLamp=0
    private fun sceneDistance():Double{
        val room=currentInterior?:return radius
        val bounds=sourceCamera?.visibility?:return radius
        return max(radius,sqrt((0..2).sumOf{i->val center=(bounds[0][i]+bounds[1][i])/2;val value=when(i){0->room.pose.eye.x;1->room.pose.eye.y;else->room.pose.eye.z};(value-center).pow(2)}))
    }
    private fun retireInteriorLamp(entity:Int){if(entity!=0){scene?.removeEntity(entity);engine?.destroyEntity(entity);EntityManager.get().destroy(entity)}}
    private fun prepareInteriorLamp(room:NativeInteriorScene):Int{
        val entity=EntityManager.get().create()
        try{LightManager.Builder(LightManager.Type.POINT).color(1f,.71f,.39f).intensityCandela(7f)
            .position(room.lamp.x.toFloat(),room.lamp.y.toFloat(),room.lamp.z.toFloat()).falloff(7.5f).castShadows(false).build(checkNotNull(engine),entity)
            return entity
        }catch(error:Throwable){engine?.destroyEntity(entity);EntityManager.get().destroy(entity);throw error}
    }
    private var viewportWidth=720;private var viewportHeight=960;private var physicalViewportReady=false
    private var frame=CameraFrame(.1,10000.0,360.0)
    private var presentationHeight=0;private var presentationTop=0
    private var openingPlaying=false
    private var openingFinished:(()->Unit)?=null
    fun prepareOpening(id:String?){render.post{if(!closed&&!failed){navigation?.prepareOpening(id,!platformMotionAllowed());project();cameraDirty=true}}}
    fun playOpening(id:String?,onFinished:()->Unit){render.post{
        if(!closed&&!failed){
            // Core actions remain available while the world loads. Use the
            // current mode/owner, rather than the one captured at preparation.
            navigation?.prepareOpening(id,!platformMotionAllowed())
            openingFinished=onFinished;openingPlaying=true;cameraDirty=true;requestFrame()
        }else main.post(onFinished)
    }}
    private var orthographicEyeOffset=0.0
    private fun project(width:Int=viewportWidth,height:Int=viewportHeight) {
        val window=NativeViewportWindow.clamped(height,presentationTop,if(presentationHeight>0)presentationHeight else height)
        val visibleHeight=window.height
        navigation?.let{if(physicalViewportReady)it.resize(width.toDouble()/visibleHeight);val current=it.frame
            if(current!=previousNavigation){invalidatePicks();previousNavigation=current}
            target[0]=current.target.x;target[1]=current.target.y;target[2]=current.target.z
            radius=current.distance;fitted=current.fitted;pitch=current.pitch;azimuth=PI/2-current.azimuth;fov=current.fov}
        val eye=doubleArrayOf(target[0]+radius*cos(pitch)*sin(azimuth),target[1]+radius*sin(pitch),target[2]+radius*cos(pitch)*cos(azimuth))
        frame=sourceCamera?.frame(eye,radius)?:frame
        if(navigation?.indoors==true)frame=CameraFrame(.025,frame.far,frame.skyRadius)
        val aspect=width.toDouble()/visibleHeight
        orthographicEyeOffset=navigation?.orthographicEyeOffset?:0.0
        if(navigation?.orthographic==true){
            val halfHeight=radius*tan(fov*PI/360)
            val halfWidth=halfHeight*aspect
            camera?.setProjection(Camera.Projection.ORTHO,-halfWidth,halfWidth,-halfHeight,halfHeight,.1,frame.far+orthographicEyeOffset)
        }else camera?.setProjection(fov,aspect,frame.near,frame.far,Camera.Fov.VERTICAL)
        camera?.setScaling(1.0,window.scaleY)
        camera?.setShift(0.0,window.shiftY)
        packets?.projectFog(navigation?.atmosphericDistance?:radius,orthographicEyeOffset)
    }
    private fun report(value:String) {main.post {status(value)}}
    init {
        require(!fixedGeneratedCamera||BuildConfig.NATIVE_DIAGNOSTICS){"A fixed oracle camera is instrumentation-only"}
        Filament.init()
        addView(surface, LayoutParams(-1,-1))
        render.post {
            if(closed)return@post
            try { initialize() } catch(error:Throwable){failed=true;android.util.Log.e("BlockcolcWorld","World initialization failed",error);report("ERROR: "+error.javaClass.simpleName+": "+error.message)}
        }
        if(BuildConfig.NATIVE_DIAGNOSTICS&&!generatedMode)helper.setDesiredSize(720,960)
        helper.renderCallback=object:UiHelper.RendererCallback {
            override fun onNativeWindowChanged(window:Surface) {
                nativeWindowChanges++;val ticket=surfaceLease.begin()
                render.post {
                    val e=engine?:return@post;if(closed||!window.isValid)return@post
                    try{
                        if(surfaceLease.acquire(ticket){
                            cancelPresentationFence();cancelProjectionFence(false);swap?.let{e.destroySwapChain(it)};swap=null
                            swap=e.createSwapChain(window)
                            if(generatedMode&&generatedPresentation>0)pendingGeneratedFrame=Triple(generatedGeneration,generatedRevision,generatedPresentation)
                        })requestFrame()
                    }catch(error:Throwable){failed=true;android.util.Log.e("BlockcolcP3","Surface acquisition failed",error);report("NATIVE_UPDATE_ERROR")}
                }
            }
            override fun onDetachedFromSurface()=retireNativeWindow()
            override fun onResized(width:Int,height:Int) {
                nativeWindowResizes++;val ticket=surfaceLease.currentTicket()?:return
                render.post {
                    if(closed||!surfaceLease.isCurrent(ticket))return@post
                    try{
                        if(width!=viewportWidth||height!=viewportHeight)cancelProjectionFence(false)
                        invalidatePicks();physicalViewportReady=true;viewportWidth=width;viewportHeight=height
                        // The pipeline owns its offscreen world viewport. A
                        // same-size Surface recreation reuses those targets;
                        // overwriting its viewport with display pixels crops
                        // both outdoor and indoor cameras until engine restart.
                        val pipeline=colorPipeline
                        if(pipeline==null)view?.viewport=Viewport(0,0,width,height) else pipeline.resize(width,height)
                        syncRasterSize();project(width,height);cameraDirty=true;requestFrame()
                    }catch(error:Throwable){failed=true;android.util.Log.e("BlockcolcP3","Surface resize failed",error);report("NATIVE_UPDATE_ERROR")}
                }
            }
        }
        helper.attachTo(surface)
    }
    /** Android may destroy the Surface immediately after this callback returns.
     * Invalidate queued work first, then synchronously drain ONLY its swap
     * chain on the owning thread. Before acquisition there is nothing to wait
     * for, even if initial geometry preparation is still running. */
    private fun retireNativeWindow(){
        check(Looper.myLooper()==main.looper){"Surface callbacks must run on the UI thread"}
        val started=System.nanoTime();nativeWindowDetaches++
        if(surfaceLease.detach()){
            val done=java.util.concurrent.CountDownLatch(1)
            val failure=java.util.concurrent.atomic.AtomicReference<Throwable>()
            val retire=Runnable{
                try{surfaceLease.retire{
                    frameRequested=false;Choreographer.getInstance().removeFrameCallback(this)
                    cancelPresentationFence();cancelProjectionFence(false)
                    gestureChangedCamera=false
                    engine?.let{e->swap?.let{e.destroySwapChain(it)};swap=null;e.flushAndWait()}
                    frameQueue?.clear()
                }}catch(error:Throwable){failed=true;failure.set(error)}finally{done.countDown()}
            }
            if(Looper.myLooper()==render.looper)retire.run()else{
                check(render.postAtFrontOfQueue(retire)){"Surface render thread has stopped before retirement"}
                var interrupted=false
                while(true){try{done.await();break}catch(_:InterruptedException){interrupted=true}}
                if(interrupted)Thread.currentThread().interrupt()
            }
            failure.get()?.let{error->nativeWindowRetirementFailures++;android.util.Log.e("BlockcolcP3","Surface retirement failed",error);report("NATIVE_UPDATE_ERROR");return}
        }
        nativeWindowRetirements++
        longestWindowRetirementNs=max(longestWindowRetirementNs,System.nanoTime()-started)
    }
    private fun initialize() {
        val e=Engine.create(Engine.Backend.OPENGL);engine=e
        val r=e.createRenderer();renderer=r
        val s=e.createScene();scene=s
        val v=e.createView();view=v
        cameraEntity=EntityManager.get().create();val c=e.createCamera(cameraEntity);camera=c
        // Unitless source lights use manual unit exposure. Its image exposure
        // is applied explicitly below, not hidden in arbitrary daylight lux.
        c.setExposure(1f);v.camera=c;v.scene=s;v.setSampleCount(1)
        v.antiAliasing=com.google.android.filament.View.AntiAliasing.NONE;v.dithering=com.google.android.filament.View.Dithering.NONE
        val generated=pendingGenerated
        val p=PacketRenderer(e,s,context.assets,cullingEnabled,surfaceEffects,surfaceOptics,nightReflections,fogEnabled,initialCloudSeconds=clock.cloudSeconds,initialWeatherElapsedMs=clock.weatherElapsedMs.toFloat());packets=p
        if (generated != null && cacheDirectionalShadows(generated)) {
            directionalShadows = DirectionalShadowCache.create(e)
            p.directionalShadows = directionalShadows
            if (directionalShadows != null) frameQueue = WorldFrameQueue(e)
            shadowCamera = generated.camera
        }
        if(!BuildConfig.NATIVE_DIAGNOSTICS)p.loadGenerated(checkNotNull(generated))
        else if(generated!=null)p.loadGenerated(generated)else p.load(fixture,projectionOnly)
        if(BuildConfig.NATIVE_DIAGNOSTICS)initialConstruction?.let { progress ->
            require(progress in 0..10000)
            if(progress!=10000){check(p.replaceConstruction(fixture,progress,p.ownerToken("building:complex-0")!!).accepted);businessProgress=progress}
        }
        val metadata=p.metadata;val input=metadata.getJSONObject("camera");val point=input.getJSONArray("target");val eye=input.getJSONArray("position")
        for(i in 0..2)target[i]=point.getDouble(i)
        val dx=eye.getDouble(0)-target[0];val dy=eye.getDouble(1)-target[1];val dz=eye.getDouble(2)-target[2]
        radius=sqrt(dx*dx+dy*dy+dz*dz);fitted=input.getDouble("fittedDistance");pitch=asin(dy/radius);azimuth=atan2(dx,dz);fov=input.getDouble("fov")
        sourceCamera=SourceCamera.read(metadata.getJSONObject("cameraVolume"));project()
        if(generated!=null){if(!fixedGeneratedCamera)navigation=NativeWorldNavigation(generated.camera,generated.orbitTargets,generated.camera.aspect);pickIndex=generated.picking;orbitTargets=generated.orbitTargets;project()}
        if(BuildConfig.NATIVE_DIAGNOSTICS&&skyProbe){pitch=.08;radius=fitted*.9;azimuth=PI/4;project()}
        if(BuildConfig.NATIVE_DIAGNOSTICS&&moonProbe){
            val moon=p.moonCenter();for(i in 0..2)target[i]=moon[i]
            val mx=eye.getDouble(0)-target[0];val my=eye.getDouble(1)-target[1];val mz=eye.getDouble(2)-target[2]
            radius=sqrt(mx*mx+my*my+mz*mz);pitch=asin(my/radius);azimuth=atan2(mx,mz);fov=10.0;project()
        }
        if(BuildConfig.NATIVE_DIAGNOSTICS)animalProbe?.let{kind->val point=p.animalCenter(kind);for(i in 0..2)target[i]=point[i];radius=8.0;pitch=PI/3;azimuth=PI/4;fov=34.0;project()}
        if(BuildConfig.NATIVE_DIAGNOSTICS)benchmarkRun?.let{run->
            require(!colorProbe&&!weatherOnly&&!animalOnly&&animalProbe==null&&!skyProbe&&!moonProbe){"Matched orbit cannot use diagnostic-only views"}
            pitch=PI/6;radius=fitted*.55;project();orbitStart=azimuth
            orbit=OrbitMeasurement(File(context.filesDir,"p1-orbit-$run.json"),run,fixture,input,runtimeEnabled,metadata.optString("environmentProfile","legacy-unspecified"),p::diagnostics)
        }
        val lighting=generated?.lighting?:SourceLighting.read(metadata.getJSONObject("environment"));sourceLighting=lighting
        val post=generated?.post?:SourcePost.read(metadata.getJSONObject("environment").getJSONObject("pipeline"))
        installLighting(lighting,p.hasSkyBackdrop,post.direct)
        colorPipeline=NativeColorPipeline(e,context.assets,v,c,lighting.exposure,colorProbe,post,resources.displayMetrics.density).also{it.glassRegions(desiredGlassRegions)}
        syncRasterSize()
        if(generated!=null){generatedPost=post;generatedOwners=generated.sources.associate{it.owner to it.ownerIdentity};generatedGeneration=generated.generation;generatedRevision=generated.revision
            generatedPresentation=generated.presentationIdentity;pendingGeneratedFrame=Triple(generated.generation,generated.revision,generated.presentationIdentity);pendingGenerated=null
            report("NATIVE_PREPARED")
        }else report("P1 prepared · ${p.loadedPackets} real instance packets · custom shader parity pending")
    }
    private fun cacheDirectionalShadows(input: NativeGeneratedScene): Boolean =
        optimizeRendering && shadowsEnabled && input.post.bloom && !input.camera.preview && !input.camera.paper

    private fun prepareDirectionalShadows(): Boolean {
        val cache = directionalShadows ?: return false
        val useCache = cache.prepare(shadowCamera, shadowLight.takeIf { currentInterior == null && generatedPost?.bloom == true })
        val useStock = shadowLight != null && (!useCache || cache.needsLiveShadows)
        if (shadowLightEntity != 0 && useStock != useStockDirectionalShadows) {
            val manager = checkNotNull(engine).lightManager
            manager.setShadowCaster(manager.getInstance(shadowLightEntity), useStock)
            useStockDirectionalShadows = useStock
        }
        return useCache
    }

    /** Allocate replacements before retiring live lights. A failed preparation
     * must leave the visible generation and its lighting usable. */
    private fun installLighting(lighting:SourceLighting,hasSky:Boolean,direct:Boolean=false){
        val e=checkNotNull(engine);val s=checkNotNull(scene);val staged=mutableListOf<Int>();var nextIndirect:IndirectLight?=null;var nextSky:Skybox?=null
        var nextShadowLight: SourceLight? = null
        var nextShadowEntity = 0
        try {
        for(light in lighting.lights){
            if(light.type=="HemisphereLight")continue
            val entity=EntityManager.get().create();staged+=entity
            val type=if(light.type=="DirectionalLight")LightManager.Type.DIRECTIONAL else LightManager.Type.POINT
            val castsShadow = light.castShadow && shadowsEnabled && lighting.shadowsEnabled
            if (type == LightManager.Type.DIRECTIONAL && castsShadow) {
                nextShadowLight = light
                nextShadowEntity = entity
            }
            val options=LightManager.ShadowOptions().apply{
                mapSize=2048;shadowFar=(sceneDistance()*1.5).toFloat();constantBias=light.shadowBiasWorld
            }
            val builder=LightManager.Builder(type).color(light.color[0],light.color[1],light.color[2])
                .castShadows(castsShadow).shadowOptions(options)
            if(type==LightManager.Type.DIRECTIONAL)builder.intensity(light.intensity).direction(light.direction[0],light.direction[1],light.direction[2])
            else builder.intensityCandela(light.intensity).position(light.position[0],light.position[1],light.position[2])
                .falloff(if(light.distance>0f)light.distance else 10000f)
            builder.build(e,entity)
        }
        nextIndirect=IndirectLight.Builder().irradiance(2,lighting.hemisphereCoefficients()).intensity(1f).build(e)
        // Filament draws its built-in sky on untouched depth after opaque
        // geometry; it would overwrite the source dome (depthWrite=false).
        if(!hasSky){val color=if(direct)lighting.clearColor.map(NativeColorEncoding::srgb)else lighting.clearColor
            nextSky=Skybox.Builder().color(color[0],color[1],color[2],1f).build(e)}
        }catch(error:Throwable){for(entity in staged){e.destroyEntity(entity);EntityManager.get().destroy(entity)};nextIndirect?.let{e.destroyIndirectLight(it)};nextSky?.let{e.destroySkybox(it)};throw error}
        s.indirectLight=nextIndirect;s.skybox=nextSky;for(entity in staged)s.addEntity(entity)
        for(entity in lightEntities){s.removeEntity(entity);e.destroyEntity(entity);EntityManager.get().destroy(entity)};lightEntities.clear();lightEntities.addAll(staged)
        indirect?.let{e.destroyIndirectLight(it)};indirect=nextIndirect;sky?.let{e.destroySkybox(it)};sky=nextSky;sourceLighting=lighting
        shadowLight = nextShadowLight
        shadowLightEntity = nextShadowEntity
        useStockDirectionalShadows = shadowLight != null
    }
    fun updateGenerated(input:NativeGeneratedScene,resetCamera:Boolean=false,animateSingleArrival:Boolean=false){render.post{
        if(closed||failed||!generatedMode||input.generation<generatedGeneration||input.generation==generatedGeneration&&input.revision<generatedRevision)return@post
        val old=packets?:return@post;val changed=input.sources.filter{generatedOwners[it.owner]!=it.ownerIdentity}
        if(BuildConfig.NATIVE_DIAGNOSTICS)generatedAdoptionStartedNs=System.nanoTime()
        var preparedPost:PreparedColorConfiguration?=null
        var stagedShadows: DirectionalShadowCache? = null
        try {
            val pipeline=checkNotNull(colorPipeline)
            if(input.post!=pipeline.configuration){preparedPost=pipeline.prepareConfiguration(input.post);preparedPost.commit()}
            val local=input.generation==generatedGeneration&&input.sources.map{it.owner}.toSet()==generatedOwners.keys&&
                changed.none{it.owner=="world"}
            if(local){
                val previous=adoptGeneratedEnvironment(old,input.environment,input.camera)
                try{
                    if(changed.isNotEmpty())check(old.replaceGeneratedMany(changed,changed.associate{it.owner to checkNotNull(old.ownerToken(it.owner))},animals=input.animals).accepted)
                }catch(error:Throwable){
                    try{adoptGeneratedEnvironment(old,previous.uniforms,previous.camera)}catch(rollback:Throwable){error.addSuppressed(rollback)}
                    throw error
                }
            }
            else {
                val e=checkNotNull(engine);val s=checkNotNull(scene)
                val next=PacketRenderer(e,s,context.assets,cullingEnabled,surfaceEffects,surfaceOptics,nightReflections,fogEnabled,initialCloudSeconds=clock.cloudSeconds,initialWeatherElapsedMs=clock.weatherElapsedMs.toFloat())
                val previousShadows = directionalShadows
                val wantsCache = cacheDirectionalShadows(input)
                if (wantsCache && previousShadows == null) stagedShadows = DirectionalShadowCache.create(e)
                val nextShadows = if (wantsCache) previousShadows ?: stagedShadows else null
                next.directionalShadows = nextShadows
                try{next.loadGenerated(input);installLighting(input.lighting,next.hasSkyBackdrop,input.post.direct)}catch(error:Throwable){
                    try{next.close()}catch(cleanup:Throwable){error.addSuppressed(cleanup)}
                    throw error
                }
                packets=next
                directionalShadows=nextShadows
                stagedShadows=null
                try{old.close()}catch(error:Throwable){android.util.Log.w("BlockcolcP3","Retired generated resources need cleanup",error)}
                if (previousShadows !== nextShadows) {
                    previousShadows?.close()
                    if (nextShadows != null && frameQueue == null) frameQueue = WorldFrameQueue(e)
                }
                colorPipeline?.exposure(input.lighting.exposure)
            }
            navigation?.adopt(input.camera,input.orbitTargets,resetCamera)
            if(animateSingleArrival&&!fixedGeneratedCamera){navigation?.playSingleArrival(!platformMotionAllowed())}
            if(BuildConfig.NATIVE_DIAGNOSTICS&&fixedGeneratedCamera){
                val camera=input.camera
                for(i in 0..2)target[i]=camera.target[i]
                val dx=camera.position.x-target[0];val dy=camera.position.y-target[1];val dz=camera.position.z-target[2]
                radius=sqrt(dx*dx+dy*dy+dz*dz);fitted=camera.fittedDistance;pitch=asin(dy/radius);azimuth=atan2(dx,dz);fov=camera.fov
            }
            currentInterior?.takeIf{!local||changed.any{it.owner==PacketOwners.INTERIOR}}?.let{room->
                val active=checkNotNull(packets);val token=active.ownerToken(PacketOwners.INTERIOR)
                if(token!=null)check(active.replaceGenerated(room.source,token).accepted)
                navigation?.interior(room.pose)
            }
            invalidatePicks()
            pickIndex=input.picking;orbitTargets=input.orbitTargets
            sourceCamera=input.camera.volume
            shadowCamera=input.camera
            generatedPost=input.post
            syncRasterSize()
            preparedPost?.let{if(it.finish()!=0)android.util.Log.w("BlockcolcP3","Retired color targets need cleanup")};preparedPost=null
            generatedOwners=input.sources.associate{it.owner to it.ownerIdentity};generatedGeneration=input.generation;generatedRevision=input.revision
            cancelPresentationFence();generatedPresentation=input.presentationIdentity;generatedEnvironmentVersion= -1
            if(BuildConfig.NATIVE_DIAGNOSTICS)generatedAdoptionEndedNs=System.nanoTime()
            pendingGeneratedFrame=Triple(input.generation,input.revision,input.presentationIdentity);cameraDirty=true;requestFrame()
        }catch(error:Throwable){
            try{stagedShadows?.close()}catch(cleanup:Throwable){error.addSuppressed(cleanup)}
            try{preparedPost?.discard()}catch(rollback:Throwable){error.addSuppressed(rollback)}
            syncRasterSize()
            android.util.Log.e("BlockcolcP3","Generated scene adoption failed",error);report("NATIVE_UPDATE_ERROR")
        }
    }}
    /** Render-thread only camera commands, independent of scene generation. */
    private fun syncRasterSize(){colorPipeline?.let{packets?.resize(it.sceneWidth,it.sceneHeight)}}
    fun navigate(id:String?,reset:Boolean=false,animate:Boolean=false){render.post{
        if(closed||failed||!generatedMode)return@post
        val orbit=navigation?:return@post;invalidatePicks()
        if(!orbit.indoors){
            val ok=if(animate&&!reset)orbit.flyTo(id,!platformMotionAllowed()) else orbit.focus(id)
            if(!ok)return@post
        }
        if(reset)orbit.resetView()
        project();cameraDirty=true;requestFrame()
    }}
    /** Lightweight display preference, independent of generation and time. */
    private var interiorPresented:(()->Unit)?=null
    private var interiorFence:Fence?=null
    @Volatile private var interiorSequence=0L
    private var interiorReadySequence=0L;private var pendingInteriorFrame=false
    fun interior(input:NativeInteriorScene?,reset:Boolean=false,onPresented:(()->Unit)?=null){render.post{
        if(closed||failed||!generatedMode)return@post
        val active=packets?:return@post;val token=active.ownerToken(PacketOwners.INTERIOR)?:return@post
        var stagedLamp=0
        try{
            cancelInteriorFence();interiorSequence++
            val cameraChanged=currentInterior?.pose!=input?.pose
            stagedLamp=input?.let(::prepareInteriorLamp)?:0
            check(active.replaceGenerated(input?.source?:NativeInteriorCompiler.empty(),token).accepted)
            if(stagedLamp!=0)scene?.addEntity(stagedLamp)
            retireInteriorLamp(interiorLamp);interiorLamp=stagedLamp;stagedLamp=0
            currentInterior=input;navigation?.interior(input?.pose);if(reset)navigation?.resetView()
            invalidatePicks();project()
            if(cameraChanged)sourceLighting?.let{installLighting(it,active.hasSkyBackdrop,generatedPost?.direct==true)}
            interiorPresented=onPresented;pendingInteriorFrame=true;cameraDirty=true;requestFrame()
        }catch(error:Throwable){retireInteriorLamp(stagedLamp);android.util.Log.e("BlockcolcWorld","Study update failed",error);report("NATIVE_INTERIOR_ERROR")}
    }}
    /** Lightweight display preference, independent of generation and time. */
    fun glassRegions(value:List<com.blockcolc.world.NativeGlassRegion>){render.post{
        if(closed||failed)return@post
        try{desiredGlassRegions=value.toList();colorPipeline?.glassRegions(desiredGlassRegions);requestFrame()}
        catch(error:Throwable){android.util.Log.e("BlockcolcWorld","Glass composition failed",error);report("NATIVE_GLASS_ERROR")}
    }}
    /** Lightweight display preference, independent of generation and time. */
    fun worldColor(value:SourceWorldColor){render.post{
        if(closed||failed)return@post
        try{colorPipeline?.worldColor(value);generatedPost=generatedPost?.copy(worldColor=value);requestFrame()}
        catch(error:Throwable){android.util.Log.e("BlockcolcP3","Native world color adoption failed",error);report("NATIVE_UPDATE_ERROR")}
    }}
    private fun adoptGeneratedEnvironment(packets:PacketRenderer,input:NativeSceneEnvironment,camera:NativeSceneCamera?=null):PacketRenderer.GeneratedEnvironment {
        val previous=packets.updateGeneratedEnvironment(input,camera)
        try{
            // Fog-only changes do not allocate new lights. A light replacement
            // stages its own resources; meshes, images and instance rows stay.
            if(input.lighting.copy(fog=sourceLighting?.fog)!=sourceLighting||!packets.hasSkyBackdrop&&input.directColor!=previous.uniforms.directColor)installLighting(input.lighting,packets.hasSkyBackdrop,input.directColor)
            sourceLighting=input.lighting;colorPipeline?.exposure(input.lighting.exposure)
        }catch(error:Throwable){
            try{packets.updateGeneratedEnvironment(previous.uniforms,previous.camera)
                if(sourceLighting!=previous.uniforms.lighting||!packets.hasSkyBackdrop&&input.directColor!=previous.uniforms.directColor)installLighting(previous.uniforms.lighting,packets.hasSkyBackdrop,previous.uniforms.directColor)
                sourceLighting=previous.uniforms.lighting;colorPipeline?.exposure(previous.uniforms.lighting.exposure)
            }catch(rollback:Throwable){error.addSuppressed(rollback)}
            throw error
        }
        return previous
    }
    /** An independent clock/provider update has no CPU world payload. Stale
     * scenes, old samples and hidden/closed hosts cannot change the renderer. */
    fun updateEnvironment(presentation:Long,version:Long,environment:NativeSceneEnvironment,clouds:NativePacketSource?=null,precipitation:NativePacketSource?=null,onResult:((Boolean)->Unit)?=null){
        require(version>=0)
        require(clouds==null||clouds.owner==PacketOwners.CLOUDS&&clouds.cloudKey!=null)
        require(precipitation==null||precipitation.owner==PacketOwners.PRECIPITATION&&precipitation.precipitationKey!=null)
        fun result(accepted:Boolean){if(onResult!=null)main.post{onResult(accepted)}}
        val posted=render.post{
            if(closed||failed||!generatedMode||!active||presentation!=generatedPresentation||version<=generatedEnvironmentVersion){result(false);return@post}
            val current=packets?:run{result(false);return@post}
            try{
                require(environment.directColor==colorPipeline?.configuration?.direct){"Environment sample cannot change the active colour path"}
                val changed=listOfNotNull(clouds,precipitation).filter{generatedOwners[it.owner]!=it.ownerIdentity}
                for(source in changed)source.validateRuntime(environment)
                val previous=adoptGeneratedEnvironment(current,environment)
                try{
                    if(changed.isNotEmpty()){
                        check(current.replaceGeneratedMany(changed,changed.associate{it.owner to checkNotNull(current.ownerToken(it.owner))}).accepted)
                        generatedOwners=generatedOwners+changed.associate{it.owner to it.ownerIdentity}
                        if(changed.any{it.owner==PacketOwners.PRECIPITATION})cameraDirty=true
                    }
                }catch(error:Throwable){try{adoptGeneratedEnvironment(current,previous.uniforms,previous.camera)}catch(rollback:Throwable){error.addSuppressed(rollback)};throw error}
                generatedEnvironmentVersion=version;generatedEnvironmentUpdates++;requestFrame();result(true)
            }
            catch(error:Throwable){generatedEnvironmentFailures++;android.util.Log.e("BlockcolcP3","Native environment adoption failed",error);result(false)}
        }
        if(!posted)result(false)
    }
    /** Debug readers never receive scene buffers or an engine handle. The
     * resource inventory is optional: readiness polling must not reconstruct
     * thousands of geometry/material rows every time it checks a frame. */
    fun generatedDiagnostics(result:(JSONObject)->Unit)=generatedDiagnostics(true,result)
    fun generatedDiagnostics(includeResources:Boolean,result:(JSONObject)->Unit){render.post{
        val value=JSONObject().put("sourceKind",if(!BuildConfig.NATIVE_DIAGNOSTICS||generatedMode)"native-generated"else"fixture").put("generation",generatedGeneration).put("revision",generatedRevision)
            .put("frames",generatedSubmittedFrames).put("gpuReadyFrames",generatedReadyFrames).put("presentationIdentity",generatedPresentation)
            .put("diagnosticSubmittedNs",if(BuildConfig.NATIVE_DIAGNOSTICS)generatedSubmittedNs.toString()else org.json.JSONObject.NULL)
            .put("diagnosticGpuCompleteNs",if(BuildConfig.NATIVE_DIAGNOSTICS)generatedGpuCompleteNs.toString()else org.json.JSONObject.NULL)
            .put("diagnosticAdoptionStartedNs",if(BuildConfig.NATIVE_DIAGNOSTICS)generatedAdoptionStartedNs.toString()else org.json.JSONObject.NULL)
            .put("diagnosticAdoptionEndedNs",if(BuildConfig.NATIVE_DIAGNOSTICS)generatedAdoptionEndedNs.toString()else org.json.JSONObject.NULL)
            .put("failed",failed).put("closed",closed).put("active",active).put("swapReady",swap!=null).put("frameRequested",frameRequested)
            .put("pendingPresentation",pendingGeneratedFrame?.third).put("fencePending",presentationFence!=null)
            .put("uiFrame",generatedUiFrame).put("notifiedFrames",generatedNotifiedFrames)
            .put("environmentVersion",generatedEnvironmentVersion).put("environmentUpdates",generatedEnvironmentUpdates).put("environmentFailures",generatedEnvironmentFailures)
            .put("nightClockSeconds",clock.seconds.toDouble()).put("nightActive",packets?.hasNightAnimation==true)
            .put("colorPipeline",colorPipeline?.diagnostics())
            .put("worldViewport",view?.viewport?.let{JSONObject().put("left",it.left).put("bottom",it.bottom).put("width",it.width).put("height",it.height)})
            .put("cloudOwnerIdentity",generatedOwners[PacketOwners.CLOUDS])
            .put("ownerIdentities",JSONObject(generatedOwners))
            .put("interior",JSONObject().put("active",currentInterior!=null).put("sequence",interiorSequence).put("presentedSequence",interiorReadySequence).put("ownerIdentity",currentInterior?.source?.ownerIdentity)
                .put("items",org.json.JSONArray(currentInterior?.items?.map{it.id}.orEmpty())))
            .put("precipitationOwnerIdentity",generatedOwners[PacketOwners.PRECIPITATION])
            .put("windowChanges",nativeWindowChanges).put("windowDetaches",nativeWindowDetaches).put("windowResizes",nativeWindowResizes)
            .put("windowRetirements",nativeWindowRetirements).put("windowRetirementFailures",nativeWindowRetirementFailures)
            .put("longestWindowRetirementMs",longestWindowRetirementNs/1e6).put("surfaceTicket",surfaceLease.frameTicket())
            .put("camera",JSONObject().put("target",org.json.JSONArray(target.toList())).put("distance",radius).put("fittedDistance",fitted)
                .put("pitch",pitch).put("azimuth",azimuth).put("fov",fov).put("width",viewportWidth).put("height",viewportHeight).put("aspect",viewportWidth.toDouble()/viewportHeight))
            .put("owners",generatedOwners.size).put("resources",if(includeResources)packets?.diagnostics()else JSONObject.NULL)
            .put("navigation",navigation?.frame?.let{n->JSONObject().put("selected",n.selected?:JSONObject.NULL).put("minimum",n.minimum).put("maximum",n.maximum).put("opening",navigation?.openingActive==true)
                .put("eye",org.json.JSONArray(listOf(n.eye.x,n.eye.y,n.eye.z))).put("indoors",navigation?.indoors==true)
                .put("lastPickMs",lastPickMs).put("pickCount",pickCount).put("lastPickId",lastPickId?:JSONObject.NULL).put("pickBytes",pickIndex.estimatedBytes)
                .put("pickPending",pickFuture!=null).put("pickThread",lastPickThread?:JSONObject.NULL)
                .put("animalTargets",org.json.JSONArray(packets?.animalPickPoints().orEmpty().map{(id,point)->val p=navigation!!.screen(point,viewportWidth,if(presentationHeight>0)presentationHeight else viewportHeight)?.let{it.first to it.second+presentationTop}
                    JSONObject().put("id",id).put("x",p?.first).put("y",p?.second)}))
                .put("targets",org.json.JSONArray(orbitTargets.map{t->val p=navigation!!.screen(t.position,viewportWidth,if(presentationHeight>0)presentationHeight else viewportHeight)?.let{it.first to it.second+presentationTop}
                    JSONObject().put("id",t.id).put("x",p?.first).put("y",p?.second)}))})
        main.post{result(value.put("attached",isAttachedToWindow).put("width",width).put("height",height)
            .put("presentationHeight",presentationHeight).put("presentationTop",presentationTop).put("visibility",visibility).put("surfaceWidth",surface.width).put("surfaceHeight",surface.height)
            .put("surfaceValid",surface.holder.surface.isValid).put("surfaceShown",surface.isShown).put("windowVisibility",surface.windowVisibility)
            .put("uiHelperReady",helper.isReadyToRender).put("ancestors",org.json.JSONArray(generateSequence(surface as android.view.View?){it.parent as? android.view.View}.take(12)
                .map{JSONObject().put("type",it.javaClass.simpleName).put("visible",it.visibility).put("width",it.width).put("height",it.height)}.toList())))}
    }}
    private fun cancelProjectionFence(clear:Boolean=true){
        projectionTicket++;projectionFence?.let{engine?.destroyFence(it)};projectionFence=null
        if(clear||projectionReceipt?.delivered?.get()==true)projectionReceipt=null
        pendingProjectionFrame=projectionReceipt!=null
    }
    private fun cancelPresentationFence(){presentationFence?.let{engine?.destroyFence(it)};presentationFence=null}
    /** endFrame only schedules display. GLES 1.56 has no supported completed-
     * frame callback; use a zero-timeout fence poll on this render thread, not
     * a main-thread flush/readback or a delay on every animated frame. */
    private fun awaitGeneratedFrame(identity:Triple<Long,Long,Long>,surfaceTicket:Long){
        cancelPresentationFence();val e=checkNotNull(engine);val fence=e.createFence();presentationFence=fence;e.flush();val started=System.nanoTime()
        fun current()=!closed&&identity.third==generatedPresentation&&surfaceLease.frameTicket()==surfaceTicket
        fun poll(){
            if(!current()||failed||presentationFence!==fence)return
            when(val outcome=fence.wait(Fence.Mode.FLUSH,0)){
                Fence.FenceStatus.CONDITION_SATISFIED->{e.destroyFence(fence);presentationFence=null;generatedReadyFrames++
                    if(BuildConfig.NATIVE_DIAGNOSTICS)generatedGpuCompleteNs=System.nanoTime()
                    // Give SurfaceFlinger a display opportunity after the GPU
                    // fence. This is not a measured presentation timestamp.
                    main.post{if(current())Choreographer.getInstance().postFrameCallback{
                        generatedUiFrame=1
                        if(current())Choreographer.getInstance().postFrameCallback{
                            generatedUiFrame=2
                            if(current()){generatedNotifiedFrames++;generatedFrame?.invoke(identity.first,identity.second,identity.third)}
                        }
                    }}
                }
                Fence.FenceStatus.TIMEOUT_EXPIRED->if(System.nanoTime()-started<15_000_000_000L)render.postDelayed({poll()},8)else{
                    android.util.Log.e("BlockcolcWorld","Scene frame fence timed out: presentation=${identity.third}, surface=$surfaceTicket")
                    e.destroyFence(fence);presentationFence=null;report("NATIVE_UPDATE_ERROR")
                }
                else->{android.util.Log.e("BlockcolcWorld","Scene frame fence failed: $outcome, presentation=${identity.third}, surface=$surfaceTicket");e.destroyFence(fence);presentationFence=null;report("NATIVE_UPDATE_ERROR")}
            }
        }
        render.post{poll()}
    }
    fun resume() {val motion=platformMotionAllowed();render.post {if(!closed){stormMotionAllowed=motion;active=true;requestFrame()}}}
    fun construction(progress:Int,revision:Long){render.post{
        check(!generatedMode){"Generated scenes use their native owner inputs"}
        if(closed||failed||revision<businessRevision)return@post
        val p=packets?:return@post
        businessRevision=revision
        if(progress==businessProgress)return@post
        val start=System.nanoTime();val before=p.diagnostics()
        try{
            val token=p.ownerToken("building:complex-0")?:error("Missing construction owner")
            val result=p.replaceConstruction(fixture,progress,token);check(result.accepted&&result.retirementErrors==0)
            val after=p.diagnostics()
            val owners=before.getJSONObject("owners");val next=after.getJSONObject("owners")
            for(key in owners.keys())if(key!="building:complex-0")check(owners.getJSONArray(key).toString()==next.getJSONArray(key).toString()){"Business report changed another world owner"}
            businessProgress=progress
            val report=JSONObject().put("progress",progress).put("revision",revision).put("durationMs",(System.nanoTime()-start)/1e6).put("before",before).put("after",after)
            pendingBusinessReport=report
            android.util.Log.i("BlockcolcP2","construction:${progress}:${(System.nanoTime()-start)/1e6}");requestFrame()
        }catch(error:Exception){report("世界更新未完成，记录已经保存：${error.message}")}
    }}
    fun projectionWindow(height:Int,top:Int,surfaceWidth:Int=0,onPresented:(()->Unit)?=null){
        check(Looper.myLooper()==Looper.getMainLooper());if(closed||height<=0)return
        render.post{if(!closed){
            cancelProjectionFence();presentationHeight=height;presentationTop=top;projectionReceipt=onPresented?.let{ProjectionReceipt(surfaceWidth,it)}
            pendingProjectionFrame=onPresented!=null;project();cameraDirty=true;requestFrame()
        }}
    }
    /** Independent from a scene's first-frame fence: camera preparation must
     * never cancel or impersonate a new scene's presentation receipt. */
    private fun awaitProjectionFrame(surfaceTicket:Long){
        val receipt=projectionReceipt?:return
        val e=checkNotNull(engine);val fence=e.createFence();projectionFence=fence;e.flush()
        val ticket=projectionTicket;val started=System.nanoTime()
        fun current()=!closed&&active&&!failed&&projectionFence===fence&&projectionTicket==ticket&&surfaceLease.frameTicket()==surfaceTicket
        fun displayCurrent()=!closed&&projectionTicket==ticket&&surfaceLease.frameTicket()==surfaceTicket
        fun poll(){
            if(!current())return
            when(val outcome=fence.wait(Fence.Mode.FLUSH,0)){
                Fence.FenceStatus.CONDITION_SATISFIED->{e.destroyFence(fence);projectionFence=null
                    // Keep the request until display acknowledgement, so a
                    // replaced Surface can rearm it after the GPU completes.
                    main.post{if(displayCurrent())Choreographer.getInstance().postFrameCallback{
                        if(displayCurrent())Choreographer.getInstance().postFrameCallback{
                            if(displayCurrent()&&receipt.delivered.compareAndSet(false,true)){
                                render.post{if(projectionReceipt===receipt)projectionReceipt=null}
                                receipt.callback()
                            }
                        }
                    }}
                }
                Fence.FenceStatus.TIMEOUT_EXPIRED->if(System.nanoTime()-started<15_000_000_000L)render.postDelayed({poll()},8)else{
                    android.util.Log.e("BlockcolcWorld","Projection frame fence timed out: request=$ticket, surface=$surfaceTicket");cancelProjectionFence();report("NATIVE_UPDATE_ERROR")
                }
                else->{android.util.Log.e("BlockcolcWorld","Projection frame fence failed: $outcome, request=$ticket, surface=$surfaceTicket");cancelProjectionFence();report("NATIVE_UPDATE_ERROR")}
            }
        };poll()
    }
    private fun cancelInteriorFence(clear:Boolean=true){
        interiorFence?.let{engine?.destroyFence(it)};interiorFence=null
        if(clear){interiorPresented=null;pendingInteriorFrame=false}
    }
    /** A submitted replacement is not yet a displayed room. Keep its cover
     * until the GPU fence and two display opportunities have both completed. */
    private fun awaitInteriorFrame(surfaceTicket:Long,sequence:Long){
        val e=checkNotNull(engine);val fence=e.createFence();interiorFence=fence;e.flush();val started=System.nanoTime()
        fun poll(){
            if(interiorFence!==fence)return
            if(closed||failed||!active||interiorSequence!=sequence||surfaceLease.frameTicket()!=surfaceTicket){
                e.destroyFence(fence);interiorFence=null
                if(!closed&&!failed&&interiorSequence==sequence){pendingInteriorFrame=true;if(active)requestFrame()}
                return
            }
            when(fence.wait(Fence.Mode.FLUSH,0)){
                Fence.FenceStatus.CONDITION_SATISFIED->{
                    e.destroyFence(fence);interiorFence=null;val callback=interiorPresented
                    main.post{if(!closed&&active&&interiorSequence==sequence&&surfaceLease.frameTicket()==surfaceTicket)Choreographer.getInstance().postFrameCallback{
                        if(!closed&&active&&interiorSequence==sequence&&surfaceLease.frameTicket()==surfaceTicket)Choreographer.getInstance().postFrameCallback{
                            if(!closed&&active&&interiorSequence==sequence&&surfaceLease.frameTicket()==surfaceTicket){render.post{if(!closed&&interiorSequence==sequence){interiorReadySequence=sequence;interiorPresented=null}}
                                callback?.invoke()}
                        }
                    }}
                }
                Fence.FenceStatus.TIMEOUT_EXPIRED->if(System.nanoTime()-started<15_000_000_000L)render.postDelayed({poll()},8)else{cancelInteriorFence();report("NATIVE_INTERIOR_ERROR")}
                else->{cancelInteriorFence();report("NATIVE_INTERIOR_ERROR")}
            }
        };poll()
    }
    /** A viewport crop changes no camera, buffer dimensions or GPU scene.
     * Native bounds complement Compose clipping for SurfaceView's own layer. */
    private var visibleBottom:Int?=null
    fun visibleRegion(bottom:Int?){
        check(Looper.myLooper()==Looper.getMainLooper());if(closed)return
        visibleBottom=bottom;if(width<=0||height<=0)return
        val crop=bottom?.let{android.graphics.Rect(0,0,width,it.coerceIn(0,height))}
        if(clipBounds!=crop){clipBounds=crop;surface.clipBounds=crop}
    }
    /** Asynchronous Surface copy; never reads Filament/GPU pixels on UI.
     * Caller owns bounded buffers and fences callbacks against replacement. */
    fun copyBackdrop(target:android.graphics.Bitmap,handler:Handler,done:(Boolean)->Unit):Boolean {
        check(Looper.myLooper()==Looper.getMainLooper())
        if(android.os.Build.VERSION.SDK_INT<24||closed||!surface.isAttachedToWindow||!surface.holder.surface.isValid)return false
        return try{android.view.PixelCopy.request(surface,target,{result->done(result==android.view.PixelCopy.SUCCESS)},handler);true}catch(_:IllegalArgumentException){false}
    }
    fun pause() {render.post {invalidatePicks();cancelProjectionFence(false);cancelInteriorFence(false);if(interiorReadySequence<interiorSequence)pendingInteriorFrame=true;active=false;gestureChangedCamera=false;clock.pause();navigation?.pauseOpening();packets?.pauseRuntime();frameRequested=false;Choreographer.getInstance().removeFrameCallback(this)}}
    fun sampleRuntime(){render.post {
        if(closed||failed||!submitted)return@post
        val snapshot=JSONObject().put("fixture",fixture).put("package",context.packageName).put("sampleId",++runtimeSampleId)
            .put("monotonicNs",System.nanoTime().toString()).put("runtimeEnabled",runtimeEnabled)
            .put("seconds",clock.seconds).put("cloudSeconds",clock.cloudSeconds).put("weatherSeconds",clock.weatherSeconds)
            .put("gpuSkySeconds",if(weatherOnly||animalOnly)0f else clock.seconds)
            .put("gpuCloudSeconds",if(weatherOnly||animalOnly)0f else clock.cloudSeconds)
            .put("gpuWeatherSeconds",if(animalOnly)0f else clock.weatherSeconds)
            .put("weatherOnly",weatherOnly)
            .put("animalOnly",animalOnly).put("animalProbe",animalProbe)
            .put("camera",JSONObject().put("target",org.json.JSONArray(target.toList())).put("radius",radius).put("pitch",pitch).put("azimuth",azimuth)
                .put("fov",fov).put("near",frame.near).put("far",frame.far))
            .put("resources",packets?.diagnostics()).put("p1GatePassed",false)
        File(context.filesDir,"p1-runtime-$fixture.json").writeText(snapshot.toString())
        report("P1 runtime sampled · $fixture · $runtimeSampleId")
    }}
    fun runOwnerCheck() {render.post {
        val p=packets?:return@post
        if(closed||failed||!submitted)return@post
        val result=JSONObject().put("fixture",fixture).put("package",context.packageName).put("p1GatePassed",false)
            .put("shadowsEnabled",shadowsEnabled)
            .put("colorPipeline",if(colorPipeline?.attachmentFormat=="RGBA16F")"linear-hdr-to-three-aces-srgb" else "linear-rgba8-to-three-aces-srgb").put("colorProbe",colorProbe)
            .put("attachmentFormat",colorPipeline?.attachmentFormat)
            .put("sourceBloom",colorPipeline?.bloomEnabled?:false)
            .put("runtimeEnabled",runtimeEnabled).put("runtimeSeconds",clock.seconds)
            .put("weatherSeconds",clock.weatherSeconds)
            .put("firstFrameResources",firstFrameResources)
            .put("environment",p.metadata.getJSONObject("environment")).put("lightingPending",org.json.JSONArray(sourceLighting?.pending.orEmpty()))
        val owner="building:complex-0"
        try {
            val token=p.ownerToken(owner)?:error("Missing owner")
            val before=p.diagnostics();result.put("before",before)
            var injected=false
            try {p.replaceOwner(fixture,owner,token,2)}catch(error:IllegalStateException){
                check(error.message=="Injected staged-upload failure");injected=true
            }
            check(injected)
            val failedStage=p.diagnostics();result.put("afterFailedStage",failedStage)
            for(key in listOf("owners","geometries","textures"))check(before.getJSONObject(key).toString()==failedStage.getJSONObject(key).toString()){"Failed stage changed $key"}
            check(p.ownerToken(owner)==token)
            before.optJSONObject("nativeAnimals")?.let{animals->
                check(animals.toString()==failedStage.getJSONObject("nativeAnimals").toString()){"Failed stage changed animal collision / behavior"}
            }
            val started=System.nanoTime()
            val update=p.replaceOwner(fixture,owner,token)
            result.put("validationAndUploadSubmitMs",(System.nanoTime()-started)/1e6)
            check(update.accepted&&update.retirementErrors==0)
            val after=p.diagnostics();result.put("after",after)
            before.optJSONObject("nativeAnimals")?.let{animals->
                val current=after.getJSONObject("nativeAnimals")
                check(current.getInt("count")==animals.getInt("count"))
                check(current.getInt("ownerReplacements")==animals.getInt("ownerReplacements")+1)
                check(current.getJSONObject("collision").getLong("revision")==animals.getJSONObject("collision").getLong("revision")+1)
                result.put("localAnimalCollisionSwapPassed",true)
            }
            val originalOwners=before.getJSONObject("owners")
            var unchanged=0
            for(key in originalOwners.keys())if(key!=owner){
                val old=originalOwners.getJSONArray(key);val next=after.getJSONObject("owners").getJSONArray(key)
                check(old.toString()==next.toString()){"Unrelated owner changed: $key"};unchanged++
                for(i in 0 until old.length())for(pair in listOf("geometry" to "geometries","texture" to "textures")){
                    val resource=old.getJSONObject(i).getString(pair.first)
                    check(before.getJSONObject(pair.second).getJSONObject(resource).getInt("identity")==after.getJSONObject(pair.second).getJSONObject(resource).getInt("identity"))
                }
            }
            check(originalOwners.getJSONArray(owner).toString()!=after.getJSONObject("owners").getJSONArray(owner).toString())
            val stale=p.replaceOwner(fixture,owner,token);check(!stale.accepted)
            check(after.toString()==p.diagnostics().toString()){"Stale update allocated resources"}
            result.put("unchangedOtherOwners",unchanged).put("failureRolledBack",true).put("staleRejectedWithoutAllocation",true)
                .put("localGpuSwapPassed",true).put("scope","GPU resource/attachment checks; frame submission is not measured screen presentation")
            pendingOwnerReport=result;cameraDirty=true;requestFrame()
        }catch(error:Throwable){
            result.put("failure",error.javaClass.simpleName+": "+error.message).put("localGpuSwapPassed",false)
            File(context.filesDir,"p1-owner-$fixture.json").writeText(result.toString())
            report("ERROR: owner check: "+error.message)
        }
    }}
    override fun doFrame(timestamp:Long) {
        frameRequested=false
        if(!active||closed||failed)return
        val surfaceTicket=surfaceLease.frameTicket()?:return
        val c=camera?:return;val r=renderer?:return;val chain=swap?:return;val v=view?:return
        try {
            if((openingPlaying||navigation?.transitionActive==true)&&navigation?.advanceOpening(timestamp)==true)cameraDirty=true
            if(openingPlaying&&navigation?.openingActive!=true){
                openingPlaying=false;openingFinished?.let{main.post(it)};openingFinished=null
            }
            val animated=runtimeEnabled&&packets?.hasAnimation==true&&!colorProbe
            val measure=if(BuildConfig.NATIVE_DIAGNOSTICS)orbit else null
            if(measure!=null&&!measure.completed){azimuth=orbitStart-measure.angle(System.nanoTime());cameraDirty=true}
            val paper=navigation?.orthographic==true
            if(animated&&!cameraDirty&&timestamp-lastDrawNs<(if(paper)41_000_000L else 32_000_000L)){requestFrame();return}
            if (frameQueue?.hasSpace() == false) {requestFrame();return}
            val nightActive=!generatedMode||packets?.hasNightAnimation==true
            if(animated&&clock.advance(timestamp,nightActive))packets?.setRuntime(if(weatherOnly||animalOnly)0f else clock.seconds,!weatherOnly&&!animalOnly&&nightActive,
                if(weatherOnly||animalOnly)0f else clock.cloudSeconds,if(animalOnly)0f else clock.weatherElapsedMs.toFloat(),
                if(weatherOnly||animalOnly)0f else clock.cascadeSeconds,if(weatherOnly||animalOnly)0f else clock.weatherElapsedMs.toFloat(),runtimeEnabled&&stormMotionAllowed&&!weatherOnly&&!animalOnly)
            if(animalProbe!=null&&runtimeEnabled){val point=packets!!.animalCenter(animalProbe);if((0..2).any{target[it]!=point[it]}){for(i in 0..2)target[i]=point[i];cameraDirty=true}}
            if(cameraDirty){
                project();val eye=doubleArrayOf(target[0]+radius*cos(pitch)*sin(azimuth),target[1]+radius*sin(pitch),target[2]+radius*cos(pitch)*cos(azimuth))
                packets?.selectLod(eye,target,fov,logicalHeight)
                packets?.updateWeather(eye,target,fov,viewportWidth.toDouble()/viewportHeight,frame.near,frame.far,logicalHeight)
            }
            packets?.advanceAnimals(timestamp,doubleArrayOf(target[0]+radius*cos(pitch)*sin(azimuth),target[1]+radius*sin(pitch),target[2]+radius*cos(pitch)*cos(azimuth)),
                target,fov,viewportWidth.toDouble()/if(paper&&presentationHeight>0)presentationHeight else viewportHeight,
                if(paper).1-orthographicEyeOffset else frame.near,frame.far,runtimeEnabled&&stormMotionAllowed&&!weatherOnly&&!colorProbe,paper)
            packets?.updateLightning(clock.weatherElapsedMs,sceneDistance(),fov,logicalHeight,runtimeEnabled&&stormMotionAllowed&&!weatherOnly&&!animalOnly&&!colorProbe)
            val viewRadius=radius+orthographicEyeOffset
            val horizontal=viewRadius*cos(pitch)
            c.lookAt(target[0]+horizontal*sin(azimuth),target[1]+viewRadius*sin(pitch),target[2]+horizontal*cos(azimuth),target[0],target[1],target[2],0.0,1.0,0.0)
            packets?.moveSky(target[0]+horizontal*sin(azimuth),target[1]+viewRadius*sin(pitch),target[2]+horizontal*cos(azimuth),frame.skyRadius)
            val cached = prepareDirectionalShadows()
            val accepted = r.beginFrame(chain,timestamp)
            if (accepted || (cached && gestureChangedCamera && frameQueue?.canContinueDrag == true)) {
                directionalShadows?.draw(r)
                colorPipeline?.draw(r)?:r.render(v);r.endFrame()
                if (cached) frameQueue?.submitted()
                cameraDirty=false;lastDrawNs=timestamp
                if(pendingInteriorFrame){pendingInteriorFrame=false;awaitInteriorFrame(surfaceTicket,interiorSequence)}
                if(pendingProjectionFrame&&projectionReceipt?.let{it.surfaceWidth==0||it.surfaceWidth==viewportWidth}==true){
                    pendingProjectionFrame=false;awaitProjectionFrame(surfaceTicket)
                }
                if(!BuildConfig.NATIVE_DIAGNOSTICS||generatedMode){generatedSubmittedFrames++;pendingGeneratedFrame?.let{identity->
                    if(BuildConfig.NATIVE_DIAGNOSTICS)generatedSubmittedNs=System.nanoTime()
                    pendingGeneratedFrame=null;awaitGeneratedFrame(identity,surfaceTicket)}}
                if(measure?.presentedSubmit(System.nanoTime(),focused)==true)report("P1 orbit completed · $fixture · actual presentation collected separately")
                if(!submitted){submitted=true;firstFrameResources=if(BuildConfig.NATIVE_DIAGNOSTICS)packets?.diagnostics()else null;report(if(!BuildConfig.NATIVE_DIAGNOSTICS||generatedMode)"NATIVE_SUBMITTED"else"P1 submitted · $fixture · ${packets?.loadedPackets} packets · not yet gate-approved")}
                pendingOwnerReport?.let {result->
                    result.put("updatedFrameSubmittedNs",System.nanoTime())
                    File(context.filesDir,"p1-owner-$fixture.json").writeText(result.toString())
                    pendingOwnerReport=null;report("P1 owner-check submitted · $fixture · local GPU swap verified; P1 still pending")
                }
                pendingBusinessReport?.let{result->
                    result.put("updatedFrameSubmittedNs",System.nanoTime())
                    File(context.filesDir,"p2-construction-$fixture.json").writeText(result.toString());pendingBusinessReport=null
                }
            }else requestFrame()
            if(animated||(openingPlaying||navigation?.transitionActive==true)&&navigation?.transitionActive==true)requestFrame()
            if(measure!=null&&!measure.completed)requestFrame()
        } catch(error:Throwable){
            android.util.Log.e("BlockcolcWorld","World frame failed",error)
            if(BuildConfig.NATIVE_DIAGNOSTICS)NativeWorldFailureEvidence.capture(error)
            failed=true;report("ERROR: "+error.javaClass.simpleName+": "+error.message)
        }
    }
    private var downX=0f;private var downY=0f;private var downTimeMs=0L;private var touchMoved=false;private var multiTouch=false;private var cameraMovedNotified=false
    private var pinchDistance=0.0;private var pinchCenter=0.0
    private val touchSlop=android.view.ViewConfiguration.get(context).scaledTouchSlop
    private fun pinchReference(event:MotionEvent){pinchDistance=hypot((event.getX(1)-event.getX(0)).toDouble(),(event.getY(1)-event.getY(0)).toDouble());pinchCenter=(event.getY(0)+event.getY(1))/2.0}
    override fun onTouchEvent(event:MotionEvent):Boolean {
        if(!isEnabled)return false
        if(!BuildConfig.NATIVE_DIAGNOSTICS||generatedMode)return generatedTouch(event)
        when(event.actionMasked) {
            MotionEvent.ACTION_DOWN->{lastX=event.x;lastY=event.y;return true}
            MotionEvent.ACTION_MOVE->{val dx=event.x-lastX;val dy=event.y-lastY;lastX=event.x;lastY=event.y;render.post {azimuth-=dx*.006;radius=(radius*exp(dy*.003)).coerceIn(fitted*.1,fitted*.9);project();cameraDirty=true;requestFrame()};return true}
            MotionEvent.ACTION_UP->{performClick();return true}
        }
        return super.onTouchEvent(event)
    }
    private fun generatedTouch(event:MotionEvent):Boolean {
        val density=resources.displayMetrics.density.toDouble()
        if(BuildConfig.NATIVE_DIAGNOSTICS&&event.actionMasked!=MotionEvent.ACTION_MOVE)android.util.Log.i("BlockcolcTouch","action=${event.actionMasked} pointers=${event.pointerCount} x=${event.x} y=${event.y} bottom=$visibleBottom")
        if(event.actionMasked==MotionEvent.ACTION_DOWN&&(visibleBottom?.let{event.y>=it}==true||event.y<0f))return false
        when(event.actionMasked){
            MotionEvent.ACTION_DOWN->{downX=event.x;downY=event.y;downTimeMs=event.eventTime;lastX=event.x;lastY=event.y;touchMoved=false;multiTouch=false;cameraMovedNotified=false;pinchDistance=0.0;parent?.requestDisallowInterceptTouchEvent(true)
                if(optimizeRendering)render.post{gestureChangedCamera=false}}
            MotionEvent.ACTION_POINTER_DOWN->{multiTouch=true;if(event.pointerCount==2)pinchReference(event)}
            MotionEvent.ACTION_MOVE->{
                if(event.pointerCount==2){val before=pinchDistance;val beforeCenter=pinchCenter;pinchReference(event);val current=pinchDistance;val delta=(pinchCenter-beforeCenter)/density
                    if(before>0&&current>0){
                        if(!cameraMovedNotified){cameraMovedNotified=true;onCameraMoved?.invoke()}
                        render.post{moveCamera{pinch(before,current,delta)}}
                    }}
                else if(event.pointerCount==1&&!multiTouch){val dx=(event.x-lastX)/density;val dy=(event.y-lastY)/density;lastX=event.x;lastY=event.y
                    if(hypot(event.x-downX,event.y-downY)>touchSlop)touchMoved=true
                    if(touchMoved){
                        if(!cameraMovedNotified){cameraMovedNotified=true;onCameraMoved?.invoke()}
                        render.post{moveCamera{drag(dx,dy)}}
                    }}
            }
            MotionEvent.ACTION_UP->{parent?.requestDisallowInterceptTouchEvent(false)
                if(optimizeRendering)render.post{gestureChangedCamera=false}
                if(!touchMoved&&!multiTouch&&hypot(event.x-downX,event.y-downY)<=touchSlop){performClick();val x=event.x.toDouble();val y=event.y.toDouble()
                    render.post{if(!closed&&active&&!failed)queryPick(x,y)}
                }
            }
            MotionEvent.ACTION_CANCEL->{parent?.requestDisallowInterceptTouchEvent(false);multiTouch=false;touchMoved=false;cameraMovedNotified=false;pinchDistance=0.0
                if(optimizeRendering)render.post{gestureChangedCamera=false}}
        }
        return true
    }
    /** Apply every gesture delta in order, then update the GPU projection once
     * in doFrame. Invalidate picks as soon as a newer gesture is accepted. */
    private inline fun moveCamera(action:NativeWorldNavigation.()->Unit){
        if(closed||failed)return
        val current=navigation?:return
        current.action()
        gestureChangedCamera=true
        invalidatePicks();cameraDirty=true;requestFrame()
    }
    private fun invalidatePicks(){pickGate.invalidate();pickFuture?.cancel(true);pickFuture=null}
    private fun queryPick(x:Double,y:Double){
        // Walls and furniture must not become invisible pick-through surfaces
        // that unexpectedly select a building behind the viewer.
        if(navigation?.indoors==true)return
        val orbit=navigation?:return;invalidatePicks();val ticket=pickGate.issue()
        val window=NativeViewportWindow.clamped(viewportHeight,presentationTop,if(presentationHeight>0)presentationHeight else viewportHeight)
        val ray=orbit.ray(x,window.localY(y),viewportWidth,window.height);val index=pickIndex;val animals=packets?.animalPickSnapshot()
        val generation=generatedGeneration;val revision=generatedRevision;val presentation=generatedPresentation
        pickFuture=pickWorker.submit{
            val start=System.nanoTime()
            try{
                val animal=animals?.pick(ray,index);val hit=if(animal==null)index.pick(ray)else null
                val duration=(System.nanoTime()-start)/1e6;val worker=Thread.currentThread().name
                render.post{if(!closed&&active&&!failed&&pickGate.accepts(ticket)){
                    pickFuture=null;lastPickMs=duration;lastPickId=animal?.let{"animal:${it.id}"}?:hit?.id;lastPickThread=worker;pickCount++
                    if(animal!=null&&packets?.tapAnimal(animal.id)==true)requestFrame()
                    if(hit!=null)main.post{if(!closed&&pickGate.accepts(ticket))generatedSelection?.invoke(generation,revision,presentation,hit.id)}
                }}
            }catch(_:java.util.concurrent.CancellationException){}catch(error:Exception){
                render.post{if(!closed&&pickGate.accepts(ticket)){pickFuture=null;android.util.Log.e("BlockcolcP3","Native pick failed",error)}}
            }
        }
    }
    override fun performClick():Boolean {super.performClick();return true}
    fun close() {
        check(Looper.myLooper()==main.looper){"World views are closed by their UI owner"}
        if(closed)return;closed=true;helper.detach()
        render.post {
            invalidatePicks();pickWorker.shutdownNow()
            pickIndex=NativeWorldPickIndex.EMPTY;orbitTargets=emptyList();navigation=null
          val retirement=if(BuildConfig.NATIVE_DIAGNOSTICS)JSONObject().put("fixture",fixture).put("startedNs",System.nanoTime()).put("p1GatePassed",false)else null
          try {
            active=false;Choreographer.getInstance().removeFrameCallback(this)
            engine?.let {e->
                cancelPresentationFence();cancelProjectionFence();cancelInteriorFence();pendingGeneratedFrame=null
                packets?.let {p->
                    retirement?.put("before",p.diagnostics());p.close();e.flushAndWait()
                    retirement?.put("after",p.diagnostics())
                };packets=null
                frameQueue?.clear();frameQueue=null
                directionalShadows?.close();directionalShadows=null
                swap?.let{e.destroySwapChain(it)};swap=null
                for(entity in lightEntities){e.destroyEntity(entity);EntityManager.get().destroy(entity)};lightEntities.clear()
                retireInteriorLamp(interiorLamp);interiorLamp=0;currentInterior=null
                indirect?.let{e.destroyIndirectLight(it)};sky?.let{e.destroySkybox(it)}
                colorPipeline?.let{it.close();retirement?.put("colorPipelineRetired",it.closed)};colorPipeline=null
                if(cameraEntity!=0){e.destroyCameraComponent(cameraEntity);EntityManager.get().destroy(cameraEntity)}
                view?.let{e.destroyView(it)};scene?.let{e.destroyScene(it)};renderer?.let{e.destroyRenderer(it)};e.destroy()
                retirement?.put("engineDestroyed",true)
            }
          } catch(error:Throwable){retirement?.put("failure",error.javaClass.simpleName+": "+error.message)}
          finally {
              try {if(BuildConfig.NATIVE_DIAGNOSTICS&&!generatedMode)File(context.filesDir,"p1-retire-$fixture.json").writeText(retirement?.toString().orEmpty())}
              finally {engine=null;thread.quitSafely()}
          }
        }
    }
}
