package com.blockcolc.preview.world

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.View
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.*
import kotlinx.coroutines.delay
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.blockcolc.preview.CommittedWorldInput
import com.blockcolc.preview.PreviewRuntime
import com.blockcolc.preview.resources.ResourceWorldSelection
import com.blockcolc.preview.ui.*
import com.blockcolc.world.NativeLightingQuality
import com.blockcolc.world.SourceWorldColor
import com.blockcolc.world.NativeGeneratedScene
import com.blockcolc.world.NativeSceneCamera
import com.blockcolc.world.NativeOrbitTarget
import com.blockcolc.world.NativeInteriorItem
import com.blockcolc.world.NativeInteriorScene
import com.blockcolc.world.NativeInteriorCompiler
import com.blockcolc.world.NativeEnvironmentContext
import com.blockcolc.world.NativeAtmosphereFacts
import com.blockcolc.world.NativeSceneEnvironment
import com.blockcolc.world.NativeCloudCompiler
import com.blockcolc.world.NativeCloudContext
import com.blockcolc.world.NativeCloudKey
import com.blockcolc.world.NativePrecipitationCompiler
import com.blockcolc.world.NativePrecipitationContext
import com.blockcolc.world.NativePrecipitationKey
import com.blockcolc.world.NativePrecipitationPrepared
import com.blockcolc.world.filament.NativeWorldView
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/** Stable composition-root host. It remains mounted behind non-world pages;
 * hidden pages neither regenerate a scene nor keep its frame pump running. */
@Composable fun NativeWorldHost(runtime:PreviewRuntime,visible:Boolean,quality:String,modifier:Modifier=Modifier,worldColor:SourceWorldColor=SourceWorldColor(),atmosphere:NativeAtmosphereFacts?,buildingCondition:Int?=null,outlineVisibility:String="current",interaction:NativeWorldInteractionState=remember{NativeWorldInteractionState()},labels:Map<String,String> = emptyMap(),resourceSelection:ResourceWorldSelection?=ResourceWorldSelection(),onReady:(Boolean)->Unit={},room:com.blockcolc.presentation.RoomPresentation?=null,retainSurface:Boolean=false) {
    val context=LocalContext.current;val ui=LocalNativeUi.current
    val owner=remember(context,interaction){NativeWorldHostOwner(context,interaction)}
    val backdrop=LocalNativeBackdrop.current
    val nativeView=androidx.compose.ui.platform.LocalView.current
    var measuredBounds by remember{mutableStateOf(Rect.Zero)}
    val worldBounds=measuredBounds
    var input by remember(runtime){mutableStateOf(runtime.committedWorld)}
    val lifecycle=remember(context){generateSequence(context){(it as? android.content.ContextWrapper)?.baseContext}.filterIsInstance<androidx.lifecycle.LifecycleOwner>().firstOrNull()?.lifecycle}
    var foreground by remember{mutableStateOf(lifecycle?.currentState?.isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED)?:true)}
    val captureRequested=backdrop?.requested==true
    val clipBottom=backdrop?.clipBottom
    val projectionHeight=backdrop?.projectionHeight?:measuredBounds.height.toInt()
    val projectionTop=backdrop?.projectionTop?:0
    val density=androidx.compose.ui.platform.LocalDensity.current
    SideEffect{
        backdrop?.ready=owner.hasScene&&!owner.loading&&!owner.error
        backdrop?.opening=owner.opening
        backdrop?.failed=owner.error
        val current=runtime.latest
        owner.openingTarget=if(backdrop?.immersive==true)null else current.activeProject?.takeIf{id->
            current.projects.any{it.id==id&&it.status!="deleted"}&&current.workspace?.projects?.find{it.id==id}?.awaitingBuilding!=true
        }
        owner.projectionWindow(projectionHeight,projectionTop,backdrop)
        owner.clip(clipBottom)
        owner.backdrop(backdrop,visible&&foreground&&captureRequested,worldBounds)
    }
    DisposableEffect(runtime,owner){val unsubscribe=runtime.subscribeWorld{input=it};onDispose{unsubscribe();owner.close()}}
    DisposableEffect(lifecycle){val observer=androidx.lifecycle.LifecycleEventObserver{_,event->
        if(event==androidx.lifecycle.Lifecycle.Event.ON_START)foreground=true else if(event==androidx.lifecycle.Lifecycle.Event.ON_STOP)foreground=false
    };lifecycle?.addObserver(observer);onDispose{lifecycle?.removeObserver(observer)}}
    val ready=visible&&foreground&&owner.hasScene&&!owner.loading&&!owner.roomLoading&&!owner.error
    val readyCallback by rememberUpdatedState(onReady)
    LaunchedEffect(ready){readyCallback(ready)}
    DisposableEffect(owner){onDispose{readyCallback(false)}}
    val prepareWorld=backdrop?.corePresented!=false
    LaunchedEffect(input,visible,foreground,quality,atmosphere,buildingCondition,outlineVisibility,resourceSelection,prepareWorld){owner.atmosphere(atmosphere);owner.request(input,visible&&foreground,quality,buildingCondition,outlineVisibility,resourceSelection,prepareWorld)}
    LaunchedEffect(worldColor){owner.color(worldColor)}
    val furniture=remember(room){room?.placed?.map{p->NativeInteriorItem(p.owned.item.id,p.slot.x,p.slot.y,p.slot.z,p.slot.mount==com.blockcolc.presentation.RoomMount.WALL,p.slot.quarterTurns)}.orEmpty()}
    LaunchedEffect(interaction.indoors,furniture,interaction.selected,interaction.resetVersion){
        // Leave the room before focusing an outdoor owner. The render queue
        // otherwise rejects that focus while its indoor camera is still live.
        owner.interior(interaction.indoors,furniture)
        owner.navigate(interaction.selected,interaction.resetVersion)
    }
    Box(modifier.then(if(visible)Modifier.semantics{
        contentDescription=ui.text("聚落世界")
        stateDescription=ui.text(if(owner.currentScene(input,quality,buildingCondition,outlineVisibility,resourceSelection))"世界已就绪" else "正在建造世界")
        customActions=owner.targetIds.map{id->CustomAccessibilityAction(ui.text("查看 {0}",labels[id]?:id)){interaction.pick(id);true}}
    }else Modifier.clearAndSetSemantics{}).onGloballyPositioned{measuredBounds=it.nativeScreenBounds(nativeView)}.onSizeChanged{owner.resize(it.width,it.height)}){
        // Create the SurfaceView hierarchy inside AndroidView's factory. Adding
        // it later to an already measured, otherwise empty native container can
        // leave Compose with no created Surface despite an attached/sized view.
        owner.viewKey?.let{viewKey->key(viewKey){
            AndroidView(factory={owner.createView(it,viewKey)},modifier=Modifier.fillMaxSize(),
                update={
                    // Opaque ordinary pages already cover the world. Keep its
                    // Surface lease while its frame pump is paused, instead of
                    // hiding and restoring a separately composited window.
                    it.visibility=if(visible||retainSurface&&owner.hasScene&&!owner.error)View.VISIBLE else View.INVISIBLE
                    it.isEnabled=visible
                    it.importantForAccessibility=if(visible)View.IMPORTANT_FOR_ACCESSIBILITY_AUTO else View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
                })
        }}
        if(visible&&(owner.loading||!owner.hasScene||owner.roomLoading||owner.roomError||owner.error))Box(Modifier.fillMaxWidth().padding(top=with(density){projectionTop.toDp()}).height(with(density){projectionHeight.coerceAtLeast(1).toDp()}).background(MaterialTheme.colorScheme.background.copy(alpha=if(owner.hasScene).88f else 1f)),contentAlignment=Alignment.Center){
            Column(horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(12.dp)){
                if(owner.error){Text(ui.text("世界暂未准备好"));NativeAction(ui.text("重试"),owner::retry,primary=false,icon="reset")}
                else if(owner.roomError){Text(ui.text("书房暂未准备好"));NativeAction(ui.text("重试"),owner::retryRoom,primary=false,icon="reset")}
                else NativeLoadingScene(ui.text("正在建造世界"),Modifier.fillMaxSize(),embedded=true)
            }
        }
        if(visible&&owner.hasScene&&!owner.loading&&!owner.error){
            val immersive=backdrop?.immersive==true
            var show by remember{mutableStateOf(!immersive)};var lastReveal by remember{mutableLongStateOf(0)}
            var revealSequence by remember{mutableIntStateOf(0)}
            LaunchedEffect(immersive){show=!immersive;lastReveal=0}
            LaunchedEffect(revealSequence){if(revealSequence>0&&show){delay(5000);show=false}}
            val alpha by androidx.compose.animation.core.animateFloatAsState(if(show)1f else 0f,androidx.compose.animation.core.tween(if(ui.reduceMotion)0 else 180),label="world-hud")
            val top=maxOf(12.dp+with(density){projectionTop.toDp()},WindowInsets.statusBars.asPaddingValues().calculateTopPadding())
            Box(Modifier.align(Alignment.TopEnd).padding(top=top).size(112.dp,88.dp).clickable(interactionSource=remember{androidx.compose.foundation.interaction.MutableInteractionSource()},indication=null){
                if(show)show=false else{show=true;lastReveal=android.os.SystemClock.uptimeMillis();revealSequence++}
            }.semantics{contentDescription=ui.text("显示世界操作")})
            if(alpha>0f)Row(Modifier.fillMaxWidth().align(Alignment.TopCenter).padding(start=12.dp,end=12.dp,top=top).graphicsLayer{this.alpha=alpha},verticalAlignment=Alignment.Top,horizontalArrangement=Arrangement.spacedBy(8.dp)){
                if(!immersive){
                    val settlement=ui.text(when(runtime.latest.workspace?.settings?.environment){"natural-valley"->"山谷";"ocean-island"->"海岛";"mosaic-coast"->"海岸";else->"空岛"})
                    val title=interaction.selected?.let{labels[it]}
                    Box(Modifier.weight(1f)){NativeText(if(title!=null)ui.text("正在查看 · {0}",title)else ui.text("{0}聚落 · {1} 栋",settlement,owner.targetIds.size),NativeTextRole.CAPTION,Modifier.background(androidx.compose.ui.graphics.Color(0xe6141d19)).padding(horizontal=10.dp,vertical=7.dp),androidx.compose.ui.graphics.Color.White,maxLines=2)}
                }else Spacer(Modifier.weight(1f))
                fun run(action:()->Unit){if(show&&(lastReveal==0L||android.os.SystemClock.uptimeMillis()-lastReveal>=400))action()}
                if(room!=null)FormalWorldAction(ui.text(if(interaction.indoors)"返回聚落"else"室内视角"),if(interaction.indoors)"map"else"study",{run(interaction::toggleInterior)})
                if(!interaction.indoors&&interaction.selected!=null)FormalWorldAction(ui.text("重置地图"),"map",{run(interaction::resetMap)})
                FormalWorldAction(ui.text("重置视角"),"reset",{run(interaction::resetView)})
            }
        }

    }
}

/** UI-thread controller; immutable facts cross to the worker, GPU ownership
 * stays in NativeWorldView. A failed build keeps the prior rendered world. */
internal class NativeWorldHostOwner(context:Context,private val interaction:NativeWorldInteractionState=NativeWorldInteractionState()):AutoCloseable {
    private val main=Handler(Looper.getMainLooper());private val session=NativeWorldSession(context,{main.post(it)})
    private var view:NativeWorldView?=null;private var database:String?=null;private var spatial:String?=null
    private var closed=false;private var active=false;private var target:CommittedWorldInput?=null;private var quality="cinematic"
    private var preparationAllowed=true
    private var worldColor=SourceWorldColor()
    private var selected:String?=null;private var resetVersion=0L
    var openingTarget:String?=null
    private var openingConsumed=false
    var opening by mutableStateOf(true);private set
    private var indoors=false;private var furniture=emptyList<NativeInteriorItem>()
    private var roomCamera:NativeSceneCamera?=null;private var roomTargets=emptyList<NativeOrbitTarget>()
    private val roomWorker=java.util.concurrent.Executors.newSingleThreadExecutor{work->Thread(work,"blockcolc-study-preparation")}
    private val roomCompiler by lazy{NativeInteriorCompiler()}
    private val roomResources=com.blockcolc.preview.resources.NativeWorldResourcePreparation(com.blockcolc.preview.resources.NativeResourceController.get(context.applicationContext),com.blockcolc.world.NativeInteriorBlocks.blockIds)
    private var roomTask:java.util.concurrent.Future<*>?=null;private var roomEpoch=0L;private var roomScene:NativeInteriorScene?=null
    var roomLoading by mutableStateOf(false);private set
    var roomError by mutableStateOf(false);private set
    fun interior(value:Boolean,items:List<NativeInteriorItem>){
        if(closed||indoors==value&&furniture==items)return
        indoors=value;furniture=items.toList();prepareRoom()
    }
    private fun prepareRoom(){
        val ticket=++roomEpoch;roomTask?.cancel(true);roomTask=null
        roomError=false
        if(!indoors){
            val previous=roomScene;roomScene=null;val current=view
            if(previous!=null&&current!=null){roomLoading=true;current.interior(null,onPresented={if(!closed&&roomEpoch==ticket&&view===current)roomLoading=false})}else roomLoading=false
            return
        }
        val camera=roomCamera?:return;val targets=roomTargets.toList();val items=furniture.toList();roomLoading=true
        val roomAspect=if(width>0&&projectionHeight>0)width.toDouble()/projectionHeight else camera.aspect
        val selection=resourceSelection
        roomTask=roomWorker.submit{runCatching{
            val cancelled={Thread.currentThread().isInterrupted}
            roomCompiler.prepare(camera,targets,items,roomResources.prepare(selection,cancelled),cancelled,aspect=roomAspect)
        }.onSuccess{candidate->main.post{
            if(!closed&&indoors&&roomEpoch==ticket){roomScene=candidate;val current=view
                if(current!=null)current.interior(candidate,onPresented={if(!closed&&roomEpoch==ticket&&view===current)roomLoading=false})
            }
        }}.onFailure{failure->main.post{if(!closed&&roomEpoch==ticket){roomLoading=false;roomError=true;android.util.Log.w("BlockcolcWorld","Study preparation failed",failure)}}}}
    }
    fun retryRoom(){if(!closed)prepareRoom()}
    var targetIds by mutableStateOf<List<String>>(emptyList());private set
    private data class PreparationKey(val request:WorldRequestIdentity,val quality:String,val buildingCondition:Int?,val outlines:String,val resources:ResourceWorldSelection)
    private var buildingCondition:Int?=null
    private var outlineVisibility="current"
    private var resourceSelection:ResourceWorldSelection?=ResourceWorldSelection()
    private var queued by mutableStateOf<PreparationKey?>(null)
    private var pendingKey:PreparationKey?=null
    private var residentKey by mutableStateOf<PreparationKey?>(null)
    // An interactive retained scene can still belong to the previous commit.
    // Only its own GPU acknowledgement makes the requested scene current.
    fun currentScene(input:CommittedWorldInput?,quality:String,condition:Int?,outlines:String,resources:ResourceWorldSelection?):Boolean =
        input!=null&&resources!=null&&hasScene&&!loading&&!error&&!roomLoading&&!roomError&&residentKey==queued&&
            residentKey==PreparationKey(input.sceneIdentity,quality,condition,outlines,resources)
    private var pendingPresentation=-1L
    private var pendingView:NativeGeneratedScene?=null
    private var epoch=0L;private var recreateNeeded=false;private var width=0;private var height=0
    private val environmentWorker=ScheduledThreadPoolExecutor(1){work->Thread(work,"blockcolc-native-environment")}.apply{removeOnCancelPolicy=true}
    private var environmentTask:ScheduledFuture<*>?=null
    private var environmentContext:NativeEnvironmentContext?=null
    private var atmosphere:NativeAtmosphereFacts?=null
    private var cloudContext:NativeCloudContext?=null;private var cloudKey:NativeCloudKey?=null
    private val environmentClouds=NativeCloudCompiler()
    private var precipitationContext:NativePrecipitationContext?=null;private var precipitationKey:NativePrecipitationKey?=null
    private var cloudRandomTail=0L
    private val environmentPrecipitation=NativePrecipitationCompiler()
    private data class SampledEnvironment(val uniforms:NativeSceneEnvironment,val clouds:com.blockcolc.world.NativeCloudPrepared?,
        val precipitation:NativePrecipitationPrepared?,val randomTail:Long)
    private var environmentEpoch=0L;private var environmentSequence=0L
    var viewKey by mutableStateOf<Long?>(null);private set
    var loading by mutableStateOf(false);private set
    var error by mutableStateOf(false);private set
    var hasScene by mutableStateOf(false);private set
    private var projectionHeight=0;private var projectionTop=0;private var projectionEpoch=0L
    private var backdrop:NativeBackdrop?=null
    fun projectionWindow(height:Int,top:Int,target:NativeBackdrop?){
        backdrop=target;if(projectionHeight==height&&projectionTop==top)return
        val first=projectionHeight<=0;projectionHeight=height;projectionTop=top
        target?.presentedWindow=null;val ticket=++projectionEpoch;val current=view
        current?.projectionWindow(height,top){if(!closed&&ticket==projectionEpoch&&view===current)target?.presentedWindow=height to top}
        if(first&&height>0&&active&&queued==null)main.post{if(!closed)request(this.target,active,quality)}
        if(!first&&indoors)prepareRoom()
    }
    private var clipBottom:Int?=null
    fun clip(value:Int?){clipBottom=value;view?.visibleRegion(value)}
    // `visible` already includes the route and Activity lifecycle. `active` is
    // updated by the later request effect; gating here on its previous value
    // left a retained world without glass after returning from Settings.
    fun backdrop(target:NativeBackdrop?,visible:Boolean,bounds:Rect){target?.configure(view,visible&&!error,bounds)}
    fun resize(width:Int,height:Int){
        val firstSize=this.width<=0||this.height<=0
        val widthChanged=this.width!=width
        this.width=width;this.height=height
        if(firstSize&&width>0&&height>0)main.post{if(!closed&&active&&queued==null)request(target,true,quality)}
        if(!firstSize&&widthChanged&&indoors)prepareRoom()
    }
    fun createView(context:Context,key:Long):NativeWorldView {
        return com.blockcolc.preview.NativeStartupTrace.measure("world-view-create",benchmark=true){createViewNow(context,key)}
    }
    private fun createViewNow(context:Context,key:Long):NativeWorldView {
        check(!closed&&key==viewKey&&view==null)
        val input=checkNotNull(pendingView)
        val next=NativeWorldView.generated(context,input,{generation,revision,presentation->
            if(!closed&&key==viewKey&&active&&presentation==pendingPresentation&&queued==pendingKey&&target?.sceneIdentity?.let{
                    it.replacementGeneration==generation&&it.revision==revision}==true){residentKey=pendingKey;loading=false;hasScene=true
                pendingKey?.request?.let{interaction.scene(it.database,it.replacementGeneration,targetIds)}
                if(!openingConsumed){
                    openingConsumed=true;selected=openingTarget?.takeIf{it in targetIds};interaction.focusWithoutMemory(selected)
                    view?.playOpening(selected){if(!closed&&key==viewKey)opening=false}
                }
                com.blockcolc.preview.NativeStartupTrace.point("world-presented");startEnvironment(presentation)}
        },{status->
            if(!closed&&key==viewKey&&status=="NATIVE_PREPARED")com.blockcolc.preview.NativeStartupTrace.point("world-renderer-prepared")
            if(!closed&&key==viewKey&&status=="NATIVE_INTERIOR_ERROR"){roomLoading=false;roomError=true}
            // A callback from a retired engine must not mark its successor as
            // broken. A fatal renderer cannot be repaired by updateGenerated.
            if(!closed&&key==viewKey&&(status.startsWith("ERROR:")||status=="NATIVE_UPDATE_ERROR")){
                stopEnvironment();opening=false;recreateNeeded=true;residentKey=null;pendingKey=null;queued=null;loading=false;error=true
            }
        },{generation,revision,presentation,id->
            val resident=residentKey?.request
            if(!closed&&key==viewKey&&active&&hasScene&&!loading&&!error&&!interaction.indoors&&interaction.resetVersion==resetVersion&&interaction.selected==selected&&presentation==pendingPresentation&&resident==target?.sceneIdentity&&resident?.replacementGeneration==generation&&resident.revision==revision&&id in targetIds)interaction.pick(id)
        })
        view=next;roomScene?.let{candidate->val ticket=roomEpoch;next.interior(candidate,onPresented={if(!closed&&roomEpoch==ticket&&view===next)roomLoading=false})};val windowTicket=projectionEpoch;val window=projectionHeight to projectionTop
        next.projectionWindow(window.first,window.second){if(!closed&&view===next&&projectionEpoch==windowTicket)backdrop?.presentedWindow=window};next.visibleRegion(clipBottom);pendingView=null;next.navigate(selected);if(!openingConsumed)next.prepareOpening(openingTarget);next.worldColor(worldColor);if(active)next.resume();return next
    }
    fun navigate(id:String?,version:Long){if(closed)return;val reset=version!=resetVersion;selected=id;resetVersion=version;view?.navigate(id,reset)}
    fun color(value:SourceWorldColor){if(closed||worldColor==value)return;worldColor=value;view?.worldColor(value)}
    fun atmosphere(value:NativeAtmosphereFacts?){
        if(closed||atmosphere==value)return
        atmosphere=value;stopEnvironment()
        if(active&&hasScene)startEnvironment(pendingPresentation)
    }
    fun request(input:CommittedWorldInput?,visible:Boolean,quality:String,buildingCondition:Int?=this.buildingCondition,outlineVisibility:String=this.outlineVisibility,resourceSelection:ResourceWorldSelection?=this.resourceSelection,allowPreparation:Boolean=this.preparationAllowed){
        check(Looper.myLooper()==Looper.getMainLooper());require(buildingCondition==null||buildingCondition in 0..10000)
        val outlines=com.blockcolc.world.NativeOutlineVisibility.fromWire(outlineVisibility)
        if(closed)return;this.target=input;this.quality=quality;this.buildingCondition=buildingCondition;this.outlineVisibility=outlineVisibility;this.resourceSelection=resourceSelection;preparationAllowed=allowPreparation;active=visible
        if(!visible){session.cancelPending();stopEnvironment();queued=null;if(residentKey==null)pendingPresentation= -1;view?.pause();return}
        view?.resume();if(input==null)return
        if(!allowPreparation&&!hasScene){loading=true;return}
        val selectedResources=resourceSelection?:run{loading=!hasScene;return}
        val facts=atmosphere?.takeIf{it.inputs.ocean==(input.environmentStyle=="ocean-island")}?:run{loading=!hasScene;return}
        // CPU preparation may finish before the first Compose measurement.
        // Do not fit the initial camera to an arbitrary fallback aspect ratio.
        if(width<=0||height<=0||projectionHeight<=0){loading=!hasScene;return}
        val key=PreparationKey(input.sceneIdentity,quality,buildingCondition,outlineVisibility,selectedResources);if(queued==key)return
        if(hasScene&&view!=null&&!recreateNeeded&&!error&&residentKey==key&&pendingKey==key){
            queued=key;loading=false;startEnvironment(pendingPresentation);return
        }
        stopEnvironment();queued=key;loading=!hasScene;error=false
        val tier=when(quality){"performance"->NativeLightingQuality.LOW;"balanced"->NativeLightingQuality.BALANCED;else->NativeLightingQuality.HIGH}
        val aspect=width.toDouble()/projectionHeight
        session.request(input.sceneIdentity,input.document,WorldTerrainOptions(rendering=WorldRenderOptions(facts.time,zone=facts.inputs.zone,quality=tier,aspect=aspect,worldColor=worldColor,
            weather=facts.inputs.weather,coordinates=facts.inputs.coordinates,atmosphere=facts,outlines=outlines),buildingCondition=buildingCondition,resourceSelection=selectedResources),onReady={prepared->
            if(!closed&&active&&queued==key&&target?.sceneIdentity==prepared.identity){
                val frame=checkNotNull(prepared.frame);val changedDatabase=database!=prepared.identity.database;pendingKey=key;pendingPresentation=frame.scene.presentationIdentity
                targetIds=frame.scene.orbitTargets.map{it.id}
                val roomChanged=roomCamera?.target!=frame.scene.camera.target||roomTargets!=frame.scene.orbitTargets
                roomCamera=frame.scene.camera;roomTargets=frame.scene.orbitTargets
                if(indoors&&roomChanged)prepareRoom()
                environmentContext=frame.environmentContext
                cloudContext=frame.cloudContext;cloudKey=frame.clouds.key
                cloudRandomTail=frame.clouds.randomTail;precipitationContext=frame.precipitationContext;precipitationKey=frame.precipitation.key
                if(changedDatabase||spatial!=frame.spatialKey)loading=true
                if(view==null||changedDatabase||recreateNeeded){
                    viewKey=null;view?.close();view=null;hasScene=false;loading=true
                    pendingView=frame.scene;database=prepared.identity.database;recreateNeeded=false;viewKey=++epoch
                }else {view!!.updateGenerated(frame.scene,spatial!=frame.spatialKey);view!!.worldColor(worldColor)}
                spatial=frame.spatialKey
            }
        },onFailure={failure->if(!closed&&active&&queued==key&&target?.sceneIdentity==input.sceneIdentity){loading=false;error=true;queued=null;android.util.Log.e("BlockcolcP3","Native world preparation failed",failure)}})
    }
    private fun stopEnvironment(){environmentEpoch++;environmentTask?.cancel(true);environmentTask=null}
    private fun startEnvironment(presentation:Long){
        if(environmentTask!=null||closed||!active||presentation!=pendingPresentation)return
        val before=environmentContext?:return
        val facts=atmosphere?.takeIf{it.inputs.ocean==before.ocean}?:return
        val sampling=before.adopting(facts);environmentContext=sampling
        val cloudSampling=cloudContext?:return;val rainSampling=precipitationContext?:return;val epoch=environmentEpoch
        val beforeCloud=cloudKey;val beforeRain=precipitationKey;val beforeRandom=cloudRandomTail
        environmentTask=environmentWorker.schedule({
                val result=runCatching{
                    val sample=sampling.project(facts);val key=NativeCloudCompiler.key(cloudSampling,sample.weather,sampling.quality.cloudDensity)
                    val cloud=if(key==beforeCloud){environmentClouds.clear();null}else environmentClouds.prepare(cloudSampling,sample.weather,sampling.quality.cloudDensity)
                    val tail=cloud?.randomTail?:beforeRandom
                    val rainKey=NativePrecipitationCompiler.key(rainSampling,sample.weather,sampling.quality.cloudDensity,tail)
                    val rain=if(rainKey==beforeRain){environmentPrecipitation.clear();null}else environmentPrecipitation.prepare(rainSampling,sample.weather,sampling.quality.cloudDensity,tail)
                    SampledEnvironment(sample.uniforms(),cloud,rain,tail)
                }
                main.post{
                    if(closed||!active||epoch!=environmentEpoch||presentation!=pendingPresentation||environmentContext!==sampling)return@post
                    fun finish(){environmentTask=null}
                    result.onSuccess{sample->
                        val world=view
                        if(world==null)finish()else world.updateEnvironment(presentation,++environmentSequence,sample.uniforms,sample.clouds?.source,sample.precipitation?.source){accepted->
                            if(!closed&&active&&epoch==environmentEpoch&&presentation==pendingPresentation&&environmentContext===sampling){
                                if(accepted){sample.clouds?.let{cloudKey=it.key};sample.precipitation?.let{precipitationKey=it.key};cloudRandomTail=sample.randomTail}
                                finish()
                            }
                        }
                    }.onFailure{android.util.Log.w("BlockcolcP3","Native environment sampling deferred",it);finish()}
                }
            },0,TimeUnit.MILLISECONDS)
        // The shared application clock publishes future facts. Hidden worlds
        // stop this GPU projection lane without stopping the audio's weather.
    }
    fun retry(){queued=null;request(target,active,quality)}
    override fun close(){if(closed)return;closed=true;roomEpoch++;roomTask?.cancel(true);roomWorker.execute{roomResources.close()};roomWorker.shutdown();roomScene=null;stopEnvironment();environmentWorker.execute{environmentClouds.clear();environmentPrecipitation.clear()};environmentWorker.shutdown();session.close();viewKey=null;pendingView=null;precipitationContext=null;view?.close();view=null}
}


@Composable private fun FormalWorldAction(title:String,icon:String,onClick:()->Unit){
    var motion by remember{mutableIntStateOf(0)}
    Box(Modifier.size(36.dp).background(androidx.compose.ui.graphics.Color(0xe6141d19)).clickable(role=Role.Button,interactionSource=remember{androidx.compose.foundation.interaction.MutableInteractionSource()},indication=null){motion++;onClick()}.semantics{contentDescription=title},contentAlignment=Alignment.Center){
        NativeMotionGlyph(icon,motion,Modifier.size(18.dp),androidx.compose.ui.graphics.Color.White)
    }
}
