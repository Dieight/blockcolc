package com.blockcolc.preview

import androidx.activity.compose.BackHandler
import androidx.activity.compose.ReportDrawnWhen
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import com.blockcolc.domain.DomainTime
import com.blockcolc.presentation.*
import com.blockcolc.preview.ui.*
import com.blockcolc.preview.world.NativeWorldHost
import com.blockcolc.preview.world.NativeWorldInteractionState
import com.blockcolc.storage.PlanMode
import com.blockcolc.audio.*
import com.blockcolc.preview.environment.NativeEnvironmentSession
import com.blockcolc.preview.environment.NativeRealWeatherController
import com.blockcolc.world.NativeWorldDebug
import com.blockcolc.preview.resources.NativeResourceController
import com.blockcolc.preview.updates.NativeUpdateController
import com.blockcolc.updates.UpdateView
import com.blockcolc.preview.blueprints.NativeBlueprintImport
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.math.roundToInt
import kotlin.coroutines.resume
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// Keep the selected surface through Activity recreation and storage reloads,
// but use preferences for a new process instead of restoring yesterday's tab.
private val NATIVE_UI_PROCESS=java.util.UUID.randomUUID().toString()

/** The default native application. P1/P2 diagnostic routes remain explicit
 * Activity extras; no synthetic 25-building fixture is loaded into a workspace. */
@Composable fun NativeApp(runtime:PreviewRuntime,loadingOverride:NativeLoadingChoice?=null,initialWorldDebug:NativeWorldDebug?=null,coldCacheTag:String?=null){
    var interactive by remember(runtime){mutableStateOf(false)}
    // This is the usable core workspace milestone. The world has its own
    // scene/GPU receipt and must never impersonate this milestone, or block it.
    ReportDrawnWhen{interactive}
    var snapshot by remember{mutableStateOf(runtime.latest.forWorkspace())}
    DisposableEffect(runtime){val unsubscribe=runtime.subscribe{snapshot=it.forWorkspace()};onDispose{unsubscribe()}}
    val loadingChoice=remember(runtime,loadingOverride){loadingOverride?:NativeLoadingChoice()}
    val resources=snapshot.uiResources
    if(resources==null){
        MaterialTheme{Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),contentAlignment=Alignment.Center){
            Column(horizontalAlignment=Alignment.CenterHorizontally){Text("blockcolc");snapshot.error?.let{Text(it)}}
        }}
        return
    }
    val pageSelection=rememberSaveable(key="native-page-$NATIVE_UI_PROCESS"){mutableStateOf("timer")}
    val minimalSelection=rememberSaveable(key="native-minimal-$NATIVE_UI_PROCESS"){mutableStateOf<Boolean?>(null)}
    val backdrop=remember(runtime){NativeBackdrop().apply{corePresented=false}}
    DisposableEffect(backdrop){onDispose{backdrop.close()}}
    val worldInteraction=remember(runtime){NativeWorldInteractionState()}
    val importer=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri->if(uri!=null)runtime.import(uri)}
    val onImport={importer.launch(arrayOf("application/json","application/octet-stream","text/plain"))}
    NativeTheme(snapshot.preferences,resources){
        CompositionLocalProvider(LocalNativeLoading provides loadingChoice,com.blockcolc.preview.world.LocalColdWorldCacheTag provides coldCacheTag){
            if(!snapshot.ready&&snapshot.error==null&&!snapshot.refreshRequired){
                NativeLoadingScene(LocalNativeUi.current.text("正在读取本机记录"),Modifier.fillMaxSize(),stageKind="storage")
            }else if(snapshot.ready&&snapshot.setupRequired&&snapshot.error==null&&!snapshot.refreshRequired){
                NativeFirstUse(snapshot,runtime,onImport){interactive=true}
            }else NativeReadyApp(snapshot,runtime,backdrop,worldInteraction,pageSelection,minimalSelection,onImport,initialWorldDebug){interactive=it}
        }
    }
}

/** First use is a complete route before a project or restored workspace
 * exists. There is no world, timer or background tab behind its dialogs. */
@Composable private fun NativeFirstUse(s:WorkspaceUiState,runtime:PreviewRuntime,onImport:()->Unit,onInteractive:()->Unit){
    val ui=LocalNativeUi.current
    val cloudContext=LocalContext.current
    val cloud=remember(runtime){NativeCloudController.get(cloudContext,runtime)}
    var cloudView by remember(cloud){mutableStateOf(cloud.snapshot())}
    var accountOpen by remember{mutableStateOf(false)}
    DisposableEffect(cloud){val remove=cloud.subscribe{cloudView=it};onDispose{remove()}}
    LaunchedEffect(cloud){cloud.start()}
    var editor by remember{mutableStateOf<ProjectEditor?>(null)}
    NativeSystemBars(false)
    SideEffect{onInteractive()}
    LaunchedEffect(Unit){NativeStartupTrace.point("workspace-interactive")}
    Surface(Modifier.fillMaxSize().testTag("workspace-ready"),color=MaterialTheme.colorScheme.background){
        if(editor!=null)Box(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()){
            NativeProjectEditor(editor,s,runtime){editor=null}
        }
    }
    NativeTutorial(s.tutorialPending,initiallyExpanded=true,onClose=runtime::finishTutorial)
    val choices=!s.tutorialPending&&editor==null&&s.importSummary==null&&s.backupImportIssue==null&&!accountOpen
    NativeSheet(true.takeIf{choices},{ui.text("开始建造你的世界")},{},dismissible=false,initiallyExpanded=true){
        Text(if(ui.language=="en")"Create a task, or restore local or cloud data."else"创建任务，或恢复本地／云端内容。")
        NativeAction(ui.text("创建大型任务"),{editor=ProjectEditor()},Modifier.fillMaxWidth(),enabled=!s.busy,icon="plus")
        NativeAction(ui.text("创建习惯任务"),{editor=ProjectEditor(initialHabit=true)},Modifier.fillMaxWidth(),enabled=!s.busy,primary=false,icon="repeat")
        NativeAction(ui.text("恢复备份"),onImport,Modifier.fillMaxWidth(),pending=s.busy,primary=false,icon="chest")
        NativeAction(if(ui.language=="en")"Sign in & restore cloud"else"登录账户并恢复云端",{accountOpen=true},Modifier.fillMaxWidth(),primary=false,icon="chest")
        s.message?.let{Text(it,color=MaterialTheme.colorScheme.error)}
    }
    NativeBackupConfirmation(s,runtime::confirmImport,onImport)
    NativeCloudPanels(cloud,cloudView,accountOpen,false,{accountOpen=false},{})
}

@Composable private fun NativeReadyApp(snapshot:WorkspaceUiState,runtime:PreviewRuntime,backdrop:NativeBackdrop,worldInteraction:NativeWorldInteractionState,
    pageSelection:MutableState<String>,minimalSelection:MutableState<Boolean?>,onImport:()->Unit,initialWorldDebug:NativeWorldDebug?,onInteractive:(Boolean)->Unit){
    // Attach observers to the verified workspace. Optional library reads and
    // update checks wait until the workbench has crossed its first draw frame.
    val context=LocalContext.current
    val resources=LocalNativeUi.current.resources
    val audio=remember(context.applicationContext){NativeAudioController.get(context)}
    val realWeather=remember(context.applicationContext){NativeRealWeatherController.get(context)}
    val resourcePacks=remember(context.applicationContext){NativeResourceController.get(context)}
    val updates=remember(context.applicationContext){NativeUpdateController.get(context)}
    var updateView by remember(updates){mutableStateOf(updates.snapshot())}
    DisposableEffect(updates){val unsubscribe=updates.subscribe{updateView=it};onDispose{unsubscribe();updates.closeAbout()}}
    val blueprintImport=remember(context.applicationContext){NativeBlueprintImport.get(context)}
    DisposableEffect(blueprintImport){onDispose{blueprintImport.cancelParsing()}}
    var resourceLibrary by remember(resourcePacks){mutableStateOf(resourcePacks.snapshot())}
    DisposableEffect(resourcePacks){val unsubscribe=resourcePacks.subscribe{resourceLibrary=it};onDispose{unsubscribe()}}
    val weatherLease=remember{Any()}
    var weatherView by remember(realWeather){mutableStateOf(realWeather.snapshot())}
    DisposableEffect(realWeather){realWeather.acquire(weatherLease);val unsubscribe=realWeather.subscribe{weatherView=it}
        onDispose{unsubscribe();realWeather.release(weatherLease)}}
    var worldDebug by remember{mutableStateOf(initialWorldDebug?:NativeWorldDebug())}
    val environment=remember(runtime,audio){NativeEnvironmentSession.get(context,runtime,audio).also{it.debug(worldDebug)}}
    LaunchedEffect(environment,worldDebug){environment.debug(worldDebug)}
    val environmentLease=remember{Any()}
    var atmosphere by remember(environment){mutableStateOf(environment.latest)}
    val initialAtmosphereReady=initialWorldDebug==null||!initialWorldDebug.enabled||
        atmosphere?.inputs?.let{it.timeMinutes==initialWorldDebug.timeMinutes&&it.weather==initialWorldDebug.weather.override}==true
    DisposableEffect(environment){environment.acquire(environmentLease);val unsubscribe=environment.subscribe{atmosphere=it}
        onDispose{unsubscribe();environment.release(environmentLease)}}
    var audioLibrary by remember(audio){mutableStateOf(audio.snapshot())}
    var audioPlayback by remember(audio){mutableStateOf(AmbientAudioHost.snapshot())}
    DisposableEffect(audio){val unsubscribe=audio.subscribe{audioLibrary=it};val stopPlayback=AmbientAudioHost.subscribe{audioPlayback=it}
        onDispose{unsubscribe();stopPlayback()}}
    LaunchedEffect(backdrop,resourcePacks,audio){
        snapshotFlow{backdrop.corePresented}.first{it}
        resourcePacks.refresh()
        audio.refresh()
    }
    val lifecycle=remember(context){generateSequence(context){(it as? android.content.ContextWrapper)?.baseContext}.filterIsInstance<androidx.lifecycle.LifecycleOwner>().firstOrNull()?.lifecycle}
    var foreground by remember(lifecycle){mutableStateOf(lifecycle?.currentState?.isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED)?:true)}
    DisposableEffect(audio,lifecycle,environment,realWeather,updates){
        fun setForeground(value:Boolean){foreground=value;audio.foreground(value);environment.foreground(environmentLease,value);realWeather.foreground(weatherLease,value)
            if(backdrop.corePresented)updates.foreground(value)}
        setForeground(lifecycle?.currentState?.isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED)?:true)
        val observer=androidx.lifecycle.LifecycleEventObserver{_,event->if(event==androidx.lifecycle.Lifecycle.Event.ON_START)setForeground(true)else if(event==androidx.lifecycle.Lifecycle.Event.ON_STOP)setForeground(false)}
        lifecycle?.addObserver(observer);onDispose{lifecycle?.removeObserver(observer);setForeground(false)}
    }
    LaunchedEffect(foreground,snapshot.ready,snapshot.workspace?.settings?.birthday,snapshot.workspace?.settings?.timeZone,snapshot.generation){
        while(foreground&&snapshot.ready){runtime.observeBirthday();delay(30000)}
    }
    LaunchedEffect(snapshot.ready,snapshot.preferences.ambience,snapshot.preferences.language){if(snapshot.ready){val value=snapshot.preferences.ambience
        audio.configure(AudioSelection(value.enabled,value.primary,value.rainEnabled,value.volume,snapshot.preferences.language))}}
    LaunchedEffect(snapshot.ready,snapshot.preferencesReadFailed,snapshot.preferences.realWeatherEnabled,snapshot.preferences.language){
        if(snapshot.ready){if(snapshot.preferencesReadFailed)realWeather.preferencesUnavailable()
            else realWeather.configure(snapshot.preferences.realWeatherEnabled,snapshot.preferences.language)}
    }
    var askWeatherPermission by remember{mutableStateOf(false)}
    val weatherPermission=rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()){realWeather.permissionsChanged()}
    LaunchedEffect(askWeatherPermission,snapshot.preferences.realWeatherEnabled,snapshot.preferencesSaving,weatherView.clearing,weatherView.clearFailed){
        if(askWeatherPermission&&snapshot.preferences.realWeatherEnabled&&!snapshot.preferencesSaving&&!weatherView.clearing&&!weatherView.clearFailed){
            askWeatherPermission=false
            if(!realWeather.permissionGranted())
                weatherPermission.launch(arrayOf(android.Manifest.permission.ACCESS_COARSE_LOCATION,android.Manifest.permission.ACCESS_FINE_LOCATION))
        }
    }
    val audioImporter=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri->if(uri!=null)audio.importAudio(uri){item->
        runtime.updatePreferences{it.copy(ambience=it.ambience.copy(primary=item.id))}}}
    val resourceImporter=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri->if(uri!=null)resourcePacks.import(uri)}
    val blueprintImporter=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri->if(uri!=null)blueprintImport.import(uri)}
    val exporter=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")){uri->if(uri!=null)runtime.export(uri)}
    val countdown=rememberCountdownPreference()
    CompositionLocalProvider(LocalNativeBackdrop provides backdrop,LocalNativeAtmosphere provides atmosphere,LocalDateCountdownPreference provides countdown){
        NativeWorkspace(snapshot,runtime,worldInteraction,updates,updateView,foreground,pageSelection,minimalSelection,onInteractive=onInteractive,
            onImport=onImport,
            onExport={exporter.launch("blockcolc-backup.json")},onConfirmImport=runtime::confirmImport,
            audioSettings={NativeAudioSettings(snapshot.preferences,snapshot.preferencesSaving,audioLibrary,audioPlayback,runtime::updatePreferences,
                onImport={audioImporter.launch(arrayOf("audio/*"))},onDelete={id->audio.remove(id){runtime.savePreferences{prefs->
                    if(prefs.ambience.primary==id)prefs.copy(ambience=prefs.ambience.copy(primary="forest-birds",enabled=false))else prefs}}},
                onPlay=audio::play,onPause=audio::pause,onRetry=audio::retry,onRefresh=audio::refresh,preferenceError=snapshot.message)},
            weatherSettings={NativeWeatherSettings(snapshot.preferences.realWeatherEnabled,snapshot.preferencesSaving,weatherView,
                onEnabled={value->askWeatherPermission=value;runtime.updatePreferences{it.copy(realWeatherEnabled=value)}},
                onRetry={if(weatherView.clearFailed)realWeather.retry()else if(snapshot.preferences.realWeatherEnabled&&!realWeather.permissionGranted())
                    weatherPermission.launch(arrayOf(android.Manifest.permission.ACCESS_COARSE_LOCATION,android.Manifest.permission.ACCESS_FINE_LOCATION))
                    else realWeather.retry()})},
            notificationSettings={if(LocalNativePageActive.current)NativeNotificationSettings(snapshot.preferences.language,runtime::openSystemSettings)},
            debugSettings={NativeWorldDebugSettings(worldDebug,{worldDebug=it},runtime.celebrations::preview)},
            resourceSettings={NativeResourceSettings(resourceLibrary,onImport={resourceImporter.launch(arrayOf("application/zip","application/x-zip-compressed","application/java-archive","application/x-java-archive","application/octet-stream"))},
                onRefresh=resourcePacks::refresh,onRetry=resourcePacks::retry,onOriginal=resourcePacks::original,onSelect=resourcePacks::select,onDelete=resourcePacks::remove)},
            blueprintSettings={NativeBlueprintSettings(snapshot,runtime,blueprintImport){blueprintImporter.launch(arrayOf("application/octet-stream","application/gzip","application/x-gzip","*/*"))}},
            worldHost={visible,retainSurface,quality,modifier,onReady->val c=snapshot.preferences.worldColorAdjustment
                 val details=snapshot.workspace?.takeIf{it.details==WorkspaceDetails.READY}
                 val memories=details?.memories
                val labels=remember(memories,snapshot.preferences.language){memories?.buildings?.associate{it.id to if(it.cycleNumber==null)it.title else resources.text(snapshot.preferences.language,"{0} · 第 {1} 座",it.title,it.cycleNumber)}.orEmpty()+memories?.rewards?.associate{
                    it.id to (it.title?:resources.text(snapshot.preferences.language,when(it.kind){WorldAssetKind.BIRTHDAY->"生日蛋糕";WorldAssetKind.HOLIDAY->"节日奖励";else->"每日奖励"}))}.orEmpty()}
                 val room=remember(details?.achievements){details?.achievements?.let{RoomPresentationProjection.from(it)}}
                 NativeWorldHost(runtime,visible&&initialAtmosphereReady,quality,modifier,com.blockcolc.world.SourceWorldColor(c.saturation,c.brightness,c.contrast),atmosphere,worldDebug.buildingCondition,snapshot.preferences.constructionOutlineVisibility,worldInteraction,
                     if(memories==null)snapshot.projects.associate{it.id to it.title}else labels,resourceLibrary.selection,onReady,room,retainSurface)})
    }
}

@Composable private fun NativeWorkspace(s:WorkspaceUiState,runtime:PreviewRuntime,worldInteraction:NativeWorldInteractionState,updates:NativeUpdateController,updateView:UpdateView,foreground:Boolean,pageSelection:MutableState<String>,minimalSelection:MutableState<Boolean?>,onInteractive:(Boolean)->Unit,onImport:()->Unit,onExport:()->Unit,onConfirmImport:(Boolean)->Unit,
    worldHost:@Composable (Boolean,Boolean,String,Modifier,(Boolean)->Unit)->Unit,audioSettings:@Composable ()->Unit,weatherSettings:@Composable ()->Unit,debugSettings:@Composable ()->Unit,resourceSettings:@Composable ()->Unit,notificationSettings:@Composable ()->Unit,blueprintSettings:@Composable ()->Unit){
    val ui=LocalNativeUi.current
    val cloudContext=LocalContext.current
    val cloud=remember(runtime){NativeCloudController.get(cloudContext,runtime)}
    var cloudView by remember(cloud){mutableStateOf(cloud.snapshot())}
    var accountOpen by rememberSaveable{mutableStateOf(false)}
    var friendsOpen by rememberSaveable{mutableStateOf(false)}
    DisposableEffect(cloud){val remove=cloud.subscribe{cloudView=it};onDispose{remove()}}
    LaunchedEffect(s.ready){if(s.ready)cloud.start()}
    NativeCloudPanels(cloud,cloudView,accountOpen,friendsOpen,{accountOpen=false},{friendsOpen=false})
    val backdrop=LocalNativeBackdrop.current
    var everReady by remember{mutableStateOf(false)}
    var workspaceShown by remember{mutableStateOf(false)}
    val worldReady=backdrop?.ready==true
    val worldOpening=backdrop?.opening==true
    LaunchedEffect(worldReady){if(worldReady)everReady=true}
    var pagesPrepared by remember{mutableStateOf(setOf("timer",pageSelection.value))}
    var page by pageSelection
    val protectionNotice=s.timer?.integrityNotice
    val interruption=protectionNotice?.takeIf{it.stopped}
    var handledInterruption by rememberSaveable{mutableStateOf<String?>(null)}
    val returning=interruption?.takeUnless{it.sessionId==handledInterruption}
    val minimal=returning?.returnsToMinimal?:minimalSelection.value?:s.preferences.minimalMode
    SideEffect{
        if(returning!=null){
            minimalSelection.value=minimal
            handledInterruption=returning.sessionId
            page="timer"
        }else if(minimalSelection.value==null)minimalSelection.value=s.preferences.minimalMode
    }
    var settledPage by rememberSaveable{mutableStateOf(page)}
    var motionPage by remember{mutableStateOf("timer")}
    val pageTravel=remember{Animatable(1f)}
    var swipeTarget by remember{mutableStateOf<String?>(null)}
    val swipeOffset=remember{mutableFloatStateOf(0f)}
    var swipeSettling by remember{mutableStateOf(false)}
    val routeScope=rememberCoroutineScope()
    var swipeJob by remember{mutableStateOf<kotlinx.coroutines.Job?>(null)}
    val pageMoving=page!=settledPage||swipeTarget!=null
    fun clearSwipe(){swipeJob?.cancel();swipeJob=null;swipeSettling=false;swipeTarget=null;swipeOffset.floatValue=0f}
    val pageOrder=listOf("timer","tasks","statistics","settings")
    val pageDirection=if(pageOrder.indexOf(page)>=pageOrder.indexOf(settledPage))1f else -1f
    val pageFocus=androidx.compose.ui.platform.LocalFocusManager.current
    val pageKeyboard=androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
    LaunchedEffect(page){pageFocus.clearFocus();pageKeyboard?.hide()}
    LaunchedEffect(page,ui.reduceMotion){
        if(page!=settledPage){clearSwipe();pageTravel.snapTo(0f);motionPage=page;pageTravel.animateTo(1f,tween(if(ui.reduceMotion)0 else 280,easing=FastOutSlowInEasing));settledPage=page}
    }

    var selectedTask by rememberSaveable(s.activeProject){mutableStateOf<String?>(null)}
    var editor by remember{mutableStateOf<PlanEditorModel?>(null)}
    var projectEditor by remember{mutableStateOf<ProjectEditor?>(null)}
    var titleEditor by remember{mutableStateOf<TitleEditor?>(null)}
    var goal by rememberSaveable{mutableStateOf(false)};var manual by rememberSaveable{mutableStateOf(false)}
    var tutorial by rememberSaveable{mutableStateOf(false)};var about by rememberSaveable{mutableStateOf(false)}
    var heldReport by remember(s.generation){mutableStateOf<ReportPool?>(null)}
    var delivered by remember(s.generation){mutableStateOf(false)}
    val submit=rememberNativeRequest(s){delivered=true}
    LaunchedEffect(s.generation){editor=null;projectEditor=null;titleEditor=null;goal=false;manual=false}
    LaunchedEffect(interruption?.sessionId){if(interruption!=null)manual=false}
    LaunchedEffect(delivered){if(delivered){delay(2000);heldReport=null;delivered=false}}
    val context=LocalContext.current
    val lifecycle=remember(context){generateSequence(context){(it as? android.content.ContextWrapper)?.baseContext}.filterIsInstance<androidx.lifecycle.LifecycleOwner>().firstOrNull()?.lifecycle}
    DisposableEffect(lifecycle){
        val observer=androidx.lifecycle.LifecycleEventObserver{_,event->if(event==androidx.lifecycle.Lifecycle.Event.ON_STOP){heldReport=null;delivered=false}}
        lifecycle?.addObserver(observer)
        onDispose{lifecycle?.removeObserver(observer);heldReport=null;delivered=false}
    }
    val pool=heldReport?:s.reportPool
    val ongoing=s.timer?.surface in setOf(TimerSurface.FOCUS,TimerSurface.REST,TimerSurface.WAITING,TimerSurface.REPORT)||pool!=null
    val immersive=(minimal&&page=="timer")||ongoing
    val worldVisible=s.ready&&s.error==null&&!s.refreshRequired&&projectEditor==null&&(immersive||page=="timer"||swipeTarget=="timer"||pageMoving&&settledPage=="timer")
    // Readiness gates the first workspace only. After showing the workbench,
    // even retrying a failed first scene must not revoke the saved controls.
    // World replacements keep their own bounded loading/error surface.
    // This boundary belongs to the mounted workspace, not each world revision.
    // First-use dialogs must not depend on a world needing its first project.
    val startupOpen=workspaceShown||s.ready||s.error!=null||s.refreshRequired
    val corePresented=backdrop?.corePresented!=false
    LaunchedEffect(startupOpen,foreground){
        if(startupOpen&&foreground&&backdrop?.corePresented==false){
            // The first callback starts the core's layout/draw frame. The
            // next callback follows it; world and history can then use the CPU.
            withFrameNanos{};withFrameNanos{};backdrop.corePresented=true
            NativeStartupTrace.point("workspace-core-frame-crossed")
        }
    }
    LaunchedEffect(corePresented,s.ready,foreground,runtime){
        if(corePresented&&s.ready&&foreground)runtime.onFirstWorkspaceFrame()
    }
    SideEffect{onInteractive(startupOpen)}
    LaunchedEffect(startupOpen){if(startupOpen){workspaceShown=true;NativeStartupTrace.point("workspace-interactive")}}
    val canPresentUpdate=s.ready&&s.error==null&&!s.refreshRequired&&!s.busy&&!s.setupRequired&&!s.tutorialPending&&!ongoing&&projectEditor==null&&editor==null&&s.importSummary==null&&s.backupImportIssue==null
    val automaticUpdates=s.ready&&!s.preferencesReadFailed&&s.preferences.autoCheckUpdates
    LaunchedEffect(corePresented,automaticUpdates,s.preferences.language,canPresentUpdate){
        if(corePresented)updates.configure(automaticUpdates,canPresentUpdate,s.preferences.language)
    }
    LaunchedEffect(corePresented){if(corePresented)updates.foreground(foreground)}
    LaunchedEffect(updateView.notice,canPresentUpdate){if(canPresentUpdate&&updates.claimNotice(updateView.notice))about=true}
    LaunchedEffect(s.preferences.minimalMode){if(!s.preferences.minimalMode)minimalSelection.value=false}
    LaunchedEffect(ongoing){if(ongoing)page="timer"}
    LaunchedEffect(immersive){worldInteraction.closeMemory()}
    val pageIdentity="${s.roomContext}/${s.generation}"
    val timerScroll=key("$pageIdentity/scroll/timer"){rememberScrollState()}
    val tasksScroll=key("$pageIdentity/scroll/tasks"){rememberScrollState()}
    val statisticsScroll=key("$pageIdentity/scroll/statistics"){rememberScrollState()}
    val settingsScroll=key("$pageIdentity/scroll/settings"){rememberScrollState()}
    val timerMemory=key("$pageIdentity/memory/timer"){rememberSaveable(saver=NativePageMemory.Saver){NativePageMemory()}}
    val tasksMemory=key("$pageIdentity/memory/tasks"){rememberSaveable(saver=NativePageMemory.Saver){NativePageMemory()}}
    val statisticsMemory=key("$pageIdentity/memory/statistics"){rememberSaveable(saver=NativePageMemory.Saver){NativePageMemory()}}
    val settingsMemory=key("$pageIdentity/memory/settings"){rememberSaveable(saver=NativePageMemory.Saver){NativePageMemory()}}

    var worldHeight by remember{mutableIntStateOf(0)}
    val density=LocalDensity.current
    val transition=remember{Animatable(if(immersive)1f else 0f)}
    var displayedMinimal by remember{mutableStateOf(minimal)}
    var displayedImmersive by remember{mutableStateOf(immersive)}
    NativeSystemBars(displayedImmersive)
    var projectedImmersive by remember{mutableStateOf(immersive)}
    var modeMotion by remember{mutableStateOf(false)}
    var modeWaiting by remember{mutableStateOf(false)}
    var lastPageInteraction by remember{mutableLongStateOf(0L)}
    var pageTouchActive by remember{mutableStateOf(false)}
    LaunchedEffect(foreground){if(!foreground)pageTouchActive=false}
    LaunchedEffect(corePresented,worldReady,worldOpening,foreground,s.busy,modeMotion,lastPageInteraction,pageTouchActive,page,pageMoving){
        // Start with idle opportunities after the usable core's first frame,
        // while the world is still preparing. A tap mounts its target directly
        // and cancels this optional work; opening/route motion also takes priority.
        if(!corePresented||!foreground||worldReady&&worldOpening||s.busy||modeMotion||pageTouchActive||pageMoving)return@LaunchedEffect
        for(key in listOf("tasks","statistics","settings"))if(key !in pagesPrepared){
            val quiet=250-(android.os.SystemClock.uptimeMillis()-lastPageInteraction)
            if(quiet>0)delay(quiet)
            awaitNativePageIdle()
            pagesPrepared=pagesPrepared+key
            withFrameNanos{}
        }
    }
    var motionForeground by remember{mutableStateOf(true)}
    var viewportHeight by remember{mutableIntStateOf(0)}
    var viewportWidth by remember{mutableIntStateOf(0)}
    var navigationHeight by remember{mutableIntStateOf(0)}
    val currentViewport by rememberUpdatedState(IntSize(viewportWidth,viewportHeight))
    val currentNavigationHeight by rememberUpdatedState(navigationHeight)
    fun routeX(key:String):Float {
        val target=swipeTarget
        if(target!=null&&!immersive){
            val offset=swipeOffset.floatValue
            return when(key){settledPage->offset;target->offset+if(pageOrder.indexOf(target)>pageOrder.indexOf(settledPage))viewportWidth.toFloat()else -viewportWidth.toFloat();else->0f}
        }
        if(!pageMoving||immersive||key!=page&&key!=settledPage)return 0f
        // Read animation state inside graphicsLayer, rather than recomposing
        // the retained pages on every navigation frame.
        val progress=if(motionPage==page)pageTravel.value else 0f
        return if(key==page)pageDirection*viewportWidth*(1-progress)else -pageDirection*viewportWidth*progress
    }

    fun finishSwipe(velocity:Float,cancel:Boolean=false){
        val target=swipeTarget?:return
        val direction=if(pageOrder.indexOf(target)>pageOrder.indexOf(settledPage))-1 else 1
        val commit=!cancel&&(kotlin.math.abs(swipeOffset.floatValue)>viewportWidth*.24f||velocity*direction>700f)
        swipeSettling=true
        swipeJob=routeScope.launch{
            val motion=Animatable(swipeOffset.floatValue)
            motion.animateTo(if(commit)direction*viewportWidth.toFloat()else 0f,tween(if(ui.reduceMotion)0 else 200,easing=FastOutSlowInEasing)){swipeOffset.floatValue=value}
            if(commit){page=target;settledPage=target;motionPage=target;pageTravel.snapTo(1f)}
            swipeTarget=null;swipeOffset.floatValue=0f;swipeSettling=false;swipeJob=null
        }
    }
    LaunchedEffect(foreground,immersive){if(!foreground||immersive){clearSwipe();settledPage=page;motionPage=page;pageTravel.snapTo(1f)}}

    val wideTimer=viewportWidth>viewportHeight||with(density){viewportWidth.toDp()}>=720.dp
    val normalReferenceHeight=if(navigationHeight>0&&viewportHeight>0)((viewportHeight-navigationHeight)*(if(wideTimer)1f else NORMAL_WORLD_FRACTION)).toInt().coerceAtLeast(1) else worldHeight
    var lastModeSize by remember{mutableStateOf(IntSize.Zero)}
    val uiLayer=rememberGraphicsLayer()
    var uiCaptureSerial by remember{mutableIntStateOf(0)}
    val uiRecordedSerial=remember{java.util.concurrent.atomic.AtomicInteger(0)}
    var modeFrames by remember{mutableStateOf<NativeModeFrames?>(null)}
    var timerPanelTop by remember{mutableIntStateOf(0)}
    val panelAlpha=remember{Animatable(1f)}
    val glassConsumers=backdrop?.glassConsumers?:0
    SideEffect{backdrop?.requested=(immersive&&!ui.reduceTransparency&&android.os.Build.VERSION.SDK_INT>=31)||modeMotion||glassConsumers>0}
    DisposableEffect(lifecycle){val observer=androidx.lifecycle.LifecycleEventObserver{_,event->if(event==androidx.lifecycle.Lifecycle.Event.ON_STOP)motionForeground=false else if(event==androidx.lifecycle.Lifecycle.Event.ON_START)motionForeground=true};lifecycle?.addObserver(observer);onDispose{lifecycle?.removeObserver(observer)}}
    LaunchedEffect(minimal,immersive,worldVisible,worldReady,motionForeground,ui.reduceMotion,viewportWidth){
        val size=IntSize(viewportWidth,viewportHeight)
        val resized=lastModeSize!=IntSize.Zero&&lastModeSize.width!=size.width;lastModeSize=size
        suspend fun settle(){projectedImmersive=immersive;displayedMinimal=minimal;displayedImmersive=immersive;transition.snapTo(if(immersive)1f else 0f);modeFrames=null;modeMotion=false;modeWaiting=false}
        // A still-loading world has no coherent frame to photograph or wait
        // for. Focus must adopt its layout without waiting for GPU snapshots.
        if(!worldVisible||!worldReady||!motionForeground||ui.reduceMotion||resized||android.os.Build.VERSION.SDK_INT<24){
            if(BuildConfig.NATIVE_DIAGNOSTICS&&(displayedMinimal!=minimal||displayedImmersive!=immersive))android.util.Log.i("BlockcolcMode","phase=skipped visible=$worldVisible foreground=$motionForeground reduce=${ui.reduceMotion} resized=$resized size=$size")
            settle()
        }
        else if(displayedMinimal!=minimal||displayedImmersive!=immersive){
            modeMotion=true
            val modeStarted=android.os.SystemClock.uptimeMillis()
            fun modeTrace(phase:String){if(BuildConfig.NATIVE_DIAGNOSTICS)android.util.Log.i("BlockcolcMode","phase=$phase entering=$immersive elapsedMs=${android.os.SystemClock.uptimeMillis()-modeStarted}")}
            try{
                // Record the real outgoing UI before adopting the other layout.
                // Only these two transient layers are read back, never a feed.
                suspend fun captureUi():androidx.compose.ui.graphics.ImageBitmap{
                    val ticket=++uiCaptureSerial
                    val deadline=android.os.SystemClock.uptimeMillis()+700
                    while(uiRecordedSerial.get()<ticket){
                        if(android.os.SystemClock.uptimeMillis()>deadline)throw IllegalStateException("UI drawing did not complete")
                        delay(8)
                    }
                    return uiLayer.toImageBitmap()
                }
                val sourceUi=captureUi()
                val sourceWorld=kotlinx.coroutines.withTimeoutOrNull(350){backdrop?.snapshot()}?:run{settle();return@LaunchedEffect}
                val oldBottom=if(displayedImmersive)viewportHeight else normalReferenceHeight
                val source=NativeModeFrame(sourceWorld.asImageBitmap(),sourceUi,viewportWidth,viewportHeight,oldBottom,timerPanelTop.coerceIn(0,viewportHeight),if(displayedImmersive)viewportHeight else viewportHeight-navigationHeight,if(wideTimer&&!displayedImmersive)(viewportWidth*WIDE_WORLD_FRACTION).roundToInt()else viewportWidth)
                modeTrace("source-captured")
                modeFrames=NativeModeFrames(source,entering=immersive)
                projectedImmersive=immersive;displayedMinimal=minimal;displayedImmersive=immersive
                // OEMs may resize the edge-to-edge content when system bars
                // hide. Keep the outgoing frame and adopt the actual stable
                // target window, rather than cancelling on a height change.
                var targetSize=currentViewport
                var stableSince=android.os.SystemClock.uptimeMillis()
                val deadline=stableSince+1200
                var targetWindow=0 to 0
                while(android.os.SystemClock.uptimeMillis()<deadline){
                    if(currentViewport!=targetSize){targetSize=currentViewport;stableSince=android.os.SystemClock.uptimeMillis()}
                    targetWindow=(if(immersive)targetSize.height else ((targetSize.height-currentNavigationHeight)*(if(wideTimer)1f else NORMAL_WORLD_FRACTION)).toInt().coerceAtLeast(1)) to 0
                    if(android.os.SystemClock.uptimeMillis()-stableSince>=64&&backdrop?.presentedWindow==targetWindow)break
                    delay(8)
                }
                if(backdrop?.presentedWindow!=targetWindow){settle();return@LaunchedEffect}
                withFrameNanos{};withFrameNanos{}
                val targetUi=captureUi()
                val targetWorld=kotlinx.coroutines.withTimeoutOrNull(350){backdrop?.snapshot()}?:run{settle();return@LaunchedEffect}
                modeFrames=NativeModeFrames(source,NativeModeFrame(targetWorld.asImageBitmap(),targetUi,targetSize.width,targetSize.height,targetWindow.first,timerPanelTop.coerceIn(0,targetSize.height),if(immersive)targetSize.height else targetSize.height-currentNavigationHeight,if(wideTimer&&!immersive)(targetSize.width*WIDE_WORLD_FRACTION).roundToInt()else targetSize.width),immersive)
                modeTrace("target-captured")
                transition.animateTo(if(immersive)1f else 0f,tween(720,easing=FastOutSlowInEasing))
                modeTrace("motion-complete")
            }catch(error:kotlinx.coroutines.CancellationException){throw error}
            catch(error:Exception){modeTrace("fallback-${error.javaClass.simpleName}");if(BuildConfig.NATIVE_DIAGNOSTICS)android.util.Log.w("BlockcolcMode","Frame capture failed",error);settle()}
            finally{modeMotion=false;modeWaiting=false;modeFrames=null}
        }else{settle()}
    }
    val normalBottom=normalReferenceHeight.coerceAtLeast(1)
    val clipBottom=if(transition.value>=.999f)null else (normalBottom+(viewportHeight-normalBottom)*transition.value).toInt()
    SideEffect{backdrop?.clipBottom=clipBottom;backdrop?.immersive=displayedImmersive
        // Projection changes once with the target layout. The 720ms cover
        // expands its crop; it never animates a non-uniform world transform.
        backdrop?.projectionHeight=if(projectedImmersive)viewportHeight else normalReferenceHeight
        backdrop?.projectionTop=0
    }
    BackHandler(enabled=immersive&&!ongoing){minimalSelection.value=false}
    BackHandler(enabled=!immersive&&page=="timer"&&worldInteraction.memory!=null){worldInteraction.closeMemory()}
    Box(Modifier.fillMaxSize().testTag(if(startupOpen)"workspace-ready"else"workspace-preparing")){
    Surface(Modifier.fillMaxSize(),color=MaterialTheme.colorScheme.background){
      Box(Modifier.fillMaxSize().onPreviewKeyEvent{if(pagesPrepared.size<4)lastPageInteraction=android.os.SystemClock.uptimeMillis();false}.pointerInput(Unit){
          awaitPointerEventScope{while(true){val event=awaitPointerEvent(androidx.compose.ui.input.pointer.PointerEventPass.Initial)
              if(pagesPrepared.size<4){pageTouchActive=event.changes.any{it.pressed};lastPageInteraction=android.os.SystemClock.uptimeMillis()}
          }}
      }.nativePageSwipe(enabled=foreground&&startupOpen&&!immersive&&!modeMotion&&!s.busy&&projectEditor==null&&editor==null&&!goal&&!manual&&!tutorial&&!about&&!accountOpen&&!friendsOpen&&s.importSummary==null&&s.backupImportIssue==null&&page==settledPage&&!swipeSettling,
          excluded={point->point.x<with(density){24.dp.toPx()}||point.x>viewportWidth-with(density){24.dp.toPx()}||point.y>=viewportHeight-navigationHeight||page=="timer"&&(if(wideTimer)point.x<viewportWidth*WIDE_WORLD_FRACTION else point.y<normalReferenceHeight)},
          onStart={dx->
              val target=pageOrder.getOrNull(pageOrder.indexOf(settledPage)+if(dx<0)1 else -1)
              if(target==null)false else{swipeTarget=target;pagesPrepared=pagesPrepared+target;true}
          },onDrag={dx->swipeTarget?.let{target->swipeOffset.floatValue=if(pageOrder.indexOf(target)>pageOrder.indexOf(settledPage))dx.coerceIn(-viewportWidth.toFloat(),0f)else dx.coerceIn(0f,viewportWidth.toFloat())}},
          onEnd={finishSwipe(it)},onCancel={if(!swipeSettling)finishSwipe(0f,true)})
        .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal)).onSizeChanged{viewportHeight=it.height;viewportWidth=it.width}){
                 if(corePresented)worldHost(worldVisible&&!pageMoving,s.ready&&s.error==null&&!s.refreshRequired&&projectEditor==null&&!immersive&&(page!="timer"||pageMoving),s.preferences.lightingQuality,
                    // Keep the separately composited SurfaceView stationary.
                    // Sliding the ordinary pages over it avoids native surface
                    // placement transactions on every navigation frame, and
                    // keeps its touch coordinates at the real screen origin.
                     Modifier.fillMaxHeight().fillMaxWidth(if(wideTimer&&!projectedImmersive)WIDE_WORLD_FRACTION else 1f).clipToBounds().drawWithContent{clipRect(bottom=if(immersive&&transition.value>=1f)size.height else normalReferenceHeight.toFloat().coerceAtLeast(1f)+(size.height-normalReferenceHeight.toFloat().coerceAtLeast(1f))*transition.value){this@drawWithContent.drawContent()}}){}
                 else if(worldVisible){
                     val worldSize=when{
                         immersive->Modifier.fillMaxHeight()
                         normalReferenceHeight>0->Modifier.height(with(density){normalReferenceHeight.toDp()})
                         else->Modifier.fillMaxHeight(NORMAL_WORLD_FRACTION)
                     }
                     val loading=ui.text("正在建造世界")
                     NativeLoadingScene(loading,Modifier.fillMaxWidth(if(wideTimer&&!immersive)WIDE_WORLD_FRACTION else 1f).then(worldSize).semantics{
                         contentDescription=ui.text("聚落世界");stateDescription=loading
                     },embedded=true)
                 }
        // The transition cover consumes touch. Hide covered controls from
        // accessibility too, rather than advertising actions that cannot fire.
        // Measure/preload the real pages while the opaque loader is visible,
        // without painting their glass, weather and text beneath that loader.
        // The separate SurfaceView above continues building and presenting.
        Column(Modifier.fillMaxSize().imePadding().drawWithContent{if(modeMotion){uiLayer.record{this@drawWithContent.drawContent()};uiRecordedSerial.set(uiCaptureSerial);drawLayer(uiLayer)}else if(startupOpen)drawContent()}.then(if(startupOpen&&!modeMotion)Modifier else Modifier.clearAndSetSemantics{})){
            Box(Modifier.weight(1f)){
                if(s.refreshRequired)NativePageScroll{
                    val refresh=rememberNativeRequest(s)
                    Text(ui.text("记录已保存，页面暂未更新。"),style=MaterialTheme.typography.titleMedium)
                    NativeAction(ui.text("重试显示"),{refresh.submit{runtime.refreshWorkspace(it)}},pending=refresh.busy,enabled=!s.busy)
                    NativeRequestError(refresh)
                }else if(s.error!=null)NativePageScroll{
                    NativeHeading(ui.text("本地记录需要恢复"),ui.text("原文件已保留，请选择备份恢复。"))
                    NativeAction(ui.text("重试"),{runtime.start()},pending=s.busy,primary=false)
                    NativeAction(ui.text("恢复备份"),onImport,pending=s.busy)
                    s.message?.let{Text(it,color=MaterialTheme.colorScheme.error)}
                }else if(s.ready){
                    val timerVisible=projectEditor==null&&(immersive||page=="timer"||swipeTarget=="timer"||pageMoving&&settledPage=="timer")
                    val timerActive=timerVisible&&(page=="timer"||immersive)&&startupOpen&&foreground&&!pageMoving
                    Box(Modifier.fillMaxSize().graphicsLayer{alpha=if(timerVisible)1f else 0f;translationX=routeX("timer")}.then(if(timerActive)Modifier else Modifier.clearAndSetSemantics{}).layout{measurable,constraints->val measured=measurable.measure(constraints);layout(measured.width,measured.height){if(timerVisible)measured.place(0,0)}}){key("$pageIdentity/timer"){NativePageActivation(timerActive){NativePageState("$pageIdentity/timer",timerScroll,timerMemory){NativeTimerPage(s,runtime,displayedMinimal,displayedImmersive,pool,submit.busy,delivered,submit.error,selectedTask,
                        onMinimal={minimalSelection.value=it},onAdjust={editor=it},onManual={manual=true},onCreate={projectEditor=ProjectEditor()},
                        onSubmit={draft->if(!submit.busy&&!delivered){heldReport=pool;submit.submit{runtime.submitReport(draft,it)}}},onWorldHeight={if(!displayedImmersive&&!immersive)worldHeight=it},memory=worldInteraction.memory,onCloseMemory=worldInteraction::closeMemory,panelOpacity=panelAlpha.value,active=timerActive,onPanelTop={timerPanelTop=it},wide=wideTimer,
                        minimalFriends=if(cloudView.account?.optBoolean("friendsEnabled")==true)({shown->NativeMinimalFriends(cloudView,shown&&foreground&&!friendsOpen,cloud::refreshFriends){friendsOpen=true}}) else null)}}}}
                    for(preparedPage in pagesPrepared.filter{it!="timer"})key(preparedPage){
                        val activePage=projectEditor==null&&!immersive&&page==preparedPage&&startupOpen&&foreground&&!pageMoving
                        var held by remember{mutableStateOf(s)}
                        if(activePage&&held!==s)held=s
                        val placedPage=projectEditor==null&&!immersive&&(page==preparedPage||swipeTarget==preparedPage||pageMoving&&settledPage==preparedPage)
                        Box(Modifier.fillMaxSize().graphicsLayer{alpha=if(placedPage)1f else 0f;translationX=routeX(preparedPage)}.background(MaterialTheme.colorScheme.background).statusBarsPadding().then(if(activePage)Modifier else Modifier.clearAndSetSemantics{}).layout{measurable,constraints->val measured=measurable.measure(constraints);layout(measured.width,measured.height){if(placedPage)measured.place(0,0)}}){
                            key("$pageIdentity/$preparedPage"){NativePageActivation(activePage){NativePageState("$pageIdentity/$preparedPage",when(preparedPage){"tasks"->tasksScroll;"statistics"->statisticsScroll;else->settingsScroll},when(preparedPage){"tasks"->tasksMemory;"statistics"->statisticsMemory;else->settingsMemory}){when(preparedPage){
                                "tasks"->NativeTasksPage(held,runtime,{projectEditor=ProjectEditor()},{goal=true},{titleEditor=it},{_,task->selectedTask=task;page="timer"},{projectEditor=ProjectEditor(nextHabit=true)},onView={worldInteraction.pick(it);page="timer"},onFriends={friendsOpen=true},friendsEnabled=cloudView.account?.optBoolean("friendsEnabled")==true)
                                "statistics"->NativeStatisticsPage(held,runtime)
                                "settings"->NativeSettingsPage(held,runtime,{tutorial=true},{about=true},onImport,onExport,audioSettings,weatherSettings,debugSettings,resourceSettings,notificationSettings,blueprintSettings,cloudSettings={NativeCloudSettings(cloudView){accountOpen=true}},updateSettings={
                                    var beta by remember(updates){mutableStateOf(updates.betaEnabled())}
                                    NativeToggle(ui.text("加入 Beta 测试"),value=beta,trailing={
                                        NativeInfoAction(ui.text("加入 Beta 测试"),ui.text("检查更新时包含测试版。退出后只检查正式版，已安装的版本会保留。"))
                                    }){beta=it;updates.selectBeta(it)}
                                })
                            }}}}
                        }
                    }
                    if(projectEditor!=null)Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).statusBarsPadding()){
                        NativeProjectEditor(projectEditor,s,runtime){projectEditor=null}
                    }
                }
            }
            if(!displayedImmersive)Row(Modifier.fillMaxWidth().onSizeChanged{navigationHeight=it.height}.background(MaterialTheme.colorScheme.surface).navigationBarsPadding(),horizontalArrangement=Arrangement.SpaceEvenly){
                for((key,label,icon)in listOf(Triple("timer","计时","clock"),Triple("tasks","任务","tasks"),Triple("statistics","统计","chart"),Triple("settings","设置","gear"))){
                    var motion by remember{mutableIntStateOf(0)}
                    val tint=if(page==key)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                    Column(Modifier.weight(1f).height(68.dp).semantics{contentDescription=ui.text(label);selected=page==key;role=Role.Tab}.clickable(enabled=!s.busy,interactionSource=remember{androidx.compose.foundation.interaction.MutableInteractionSource()},indication=null){motion++;clearSwipe();projectEditor=null;pagesPrepared=pagesPrepared+key;page=key}.drawWithContent{
                        drawContent();if(page==key)drawRect(tint,androidx.compose.ui.geometry.Offset(size.width/2-1.5.dp.toPx(),size.height-9.dp.toPx()),androidx.compose.ui.geometry.Size(3.dp.toPx(),3.dp.toPx()))
                    }.padding(vertical=8.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(5.dp,Alignment.CenterVertically)){
                        NativeMotionGlyph(icon,motion,color=tint)
                        val visibleLabel=if(key=="statistics"&&ui.language=="en"&&LocalDensity.current.fontScale>1.3f)"Stats"else ui.text(label)
                        Text(visibleLabel,Modifier.fillMaxWidth().padding(horizontal=4.dp).testTag("navigation-label-$key"),color=tint,style=MaterialTheme.typography.labelSmall,
                            maxLines=1,overflow=androidx.compose.ui.text.style.TextOverflow.Ellipsis,textAlign=androidx.compose.ui.text.style.TextAlign.Center)
                    }
                }
            }
        }
        if(modeMotion)Box(Modifier.fillMaxSize().testTag("mode-transition").clickable(interactionSource=remember{androidx.compose.foundation.interaction.MutableInteractionSource()},indication=null){}){
            modeFrames?.let{NativeModeCover(it,if(it.entering)transition.value else 1f-transition.value,MaterialTheme.colorScheme.background,Modifier.fillMaxSize())}
        }
        if(!startupOpen)NativeLoadingScene(ui.text("正在建造世界"),Modifier.fillMaxSize().pointerInput(Unit){
            awaitPointerEventScope{while(true)awaitPointerEvent().changes.forEach{it.consume()}}
        })
        if(!immersive)Box(Modifier.fillMaxWidth().windowInsetsTopHeight(WindowInsets.statusBars).background(MaterialTheme.colorScheme.surface.copy(alpha=.88f)))
      }
    }
    NativeCelebrationOverlay(runtime.celebrations,foreground,worldReady&&(immersive||page=="timer")&&startupOpen)
    val bannerGap=with(density){12.dp.roundToPx()}
    val bannerInset=WindowInsets.safeDrawing.getTop(density)+bannerGap
    val bannerAnchor=if(timerPanelTop>0&&!wideTimer)timerPanelTop else viewportHeight-navigationHeight
    var bannerHeight by remember{mutableIntStateOf(0)}
    val bannerVisible=foreground&&startupOpen&&page=="timer"&&!modeMotion&&displayedImmersive==immersive
    NativeFocusIntegrityBanner(protectionNotice,bannerVisible,Modifier.align(Alignment.TopCenter)
        .offset{IntOffset(0,(bannerAnchor-bannerHeight-bannerGap).coerceAtLeast(bannerInset))}
        .padding(horizontal=20.dp).onSizeChanged{bannerHeight=it.height})
    }
    if(!startupOpen)return
    NativePlanEditor(editor,s,runtime){editor=null}
    NativeTitleEditor(titleEditor,s,runtime){titleEditor=null}
    NativeGoalEditor(goal,s,runtime){goal=false}
    NativeManualEditor(manual,s,runtime){manual=false}
    val achievementSafe=foreground&&startupOpen&&!s.busy&&!s.refreshRequired&&s.error==null&&!s.setupRequired&&!s.tutorialPending&&!ongoing&&!modeMotion&&
        !manual&&!goal&&!tutorial&&!about&&editor==null&&projectEditor==null&&titleEditor==null&&s.importSummary==null&&s.backupImportIssue==null
    val completion=runtime.celebrations.completion()
    var completionClosing by remember{mutableStateOf(false)}
    fun closeCompletion(){if(!completionClosing){completionClosing=true;runtime.celebrations.closeCompletion()}}
    NativeSheet(completion?.takeIf{achievementSafe&&worldReady&&page=="timer"},{ui.text("主体建筑完成")},::closeCompletion,onHidden={completionClosing=false}){notice->
        PixelGlyph("cube",Modifier.size(40.dp))
        Text(notice.title,style=MaterialTheme.typography.headlineMedium)
        Text(ui.text("这项长期工作已经在聚落中留下完整建筑。"))
        NativeAction(ui.text(if(minimal)"留在此刻"else"回到聚落"),::closeCompletion,Modifier.fillMaxWidth())
    }
    key(s.generation,runtime.committedWorld?.identity?.database){
        NativeAchievementUnlock(s.workspace?.achievements.orEmpty(),runtime,achievementSafe&&completion==null&&!completionClosing,page=="statistics",s.achievementAttention)
    }
    NativeTutorial(tutorial||s.tutorialPending){tutorial=false;if(s.tutorialPending)runtime.finishTutorial()}
    NativeBackupConfirmation(s,onConfirmImport,onImport)
    NativeAboutSheet(about,updateView,updates){about=false}
}

private data class BackupSheetContent(val summary:String?,val issue:BackupImportIssue?)
@Composable private fun NativeBackupConfirmation(s:WorkspaceUiState,onConfirmImport:(Boolean)->Unit,onImport:()->Unit){
    val ui=LocalNativeUi.current
    fun tr(zh:String,en:String)=if(ui.language=="en")en else zh
    val model=if(s.importSummary==null&&s.backupImportIssue==null)null else BackupSheetContent(s.importSummary,s.backupImportIssue)
    NativeSheet(model,{if(it.issue==null)ui.text("恢复备份")else tr("导入未完成","Import not completed")},{onConfirmImport(false)},!s.busy){state->
        if(state.issue==null){
            Text(checkNotNull(state.summary))
            NativeAction(ui.text("确认恢复"),{onConfirmImport(true)},Modifier.fillMaxWidth(),pending=s.busy,danger=true)
        }else{
            val reason=when(state.issue){
                BackupImportIssue.MEMORY->tr("可用内存不足，请稍后重试。","Not enough memory. Please try again.")
                BackupImportIssue.READ->tr("无法读取文件，请重新选择。","The file could not be read. Select it again.")
                BackupImportIssue.CHECKSUM->tr("备份校验不一致，文件可能不完整。","The backup checksum does not match; the file may be incomplete.")
                BackupImportIssue.VERSION->tr("暂不支持这个备份版本。","This backup version is not supported yet.")
                BackupImportIssue.LIMIT->tr("备份超过 100 MiB 上限。","The backup exceeds the 100 MiB limit.")
                BackupImportIssue.BUSY->tr("上一项操作仍在完成，请稍后重试。","Another operation is finishing. Please try again.")
                else->tr("备份内容未通过校验。","The backup contents did not pass validation.")
            }
            Text(reason,color=MaterialTheme.colorScheme.error)
            Text(tr("本次导入未替换当前记录。","This import has not replaced your records."))
            if(state.summary!=null)NativeAction(tr("重试恢复","Retry restore"),{onConfirmImport(true)},Modifier.fillMaxWidth(),pending=s.busy,primary=false)
            NativeAction(tr("重新选择文件","Choose another file"),{onConfirmImport(false);onImport()},Modifier.fillMaxWidth(),enabled=!s.busy,icon="plus")
        }
    }
}

@Composable private fun NativeTutorial(open:Boolean,initiallyExpanded:Boolean=false,onClose:()->Unit){
    val ui=LocalNativeUi.current
    NativeSheet(if(open)true else null,{ui.text("新手教程")},onClose,initiallyExpanded=initiallyExpanded){
        var index by rememberSaveable{mutableIntStateOf(0)}
        val pages=listOf("从一轮专注开始" to "选择小任务，确认计划后开始。计时按实际结束时间恢复。",
            "把任务建成世界" to "大任务对应建筑，小任务的推进决定施工；习惯任务按轮次积累。",
            "专注、休息与汇报" to "专注时双击面板下方空白显示结束按钮，再双击可收起。休息后双击时间继续。提前完成或中止后，由你确认再开始。",
            "极简与便签" to "开启极简后左右滑动面板查看统计和便签；双击时间确认结束计划。",
            "世界的两种复位" to "复位视角仍围绕所选建筑；地图按钮返回整个聚落的总览。",
            "窗前的小书房" to "切换室内视角，从窗前看同一个聚落。成就解锁的摆设会自动放进书房。",
            "回看每一天" to "点选或拖选热力图查看投入，展开纪念建筑和成就。",
            "让记录留在本机" to "设置可搜索并定位，恢复和导出备份，调整世界、字体、天气与声音。",
            "账户、同步与好友" to "账户可选，离线照常专注。登录后同步记录与设备偏好；导入的材质和音频留在本机。好友能看见什么，由你单独决定；其他设备可查看或接管计划。")
        Text("${index+1} / ${pages.size}",style=MaterialTheme.typography.bodySmall)
        Text(ui.text(pages[index].first),style=MaterialTheme.typography.titleLarge)
        Text(ui.text(pages[index].second),style=MaterialTheme.typography.bodyLarge)
        if(index==2){
            var practiced by rememberSaveable{mutableStateOf(false)}
            Text(ui.text("在下方试一试。这里只是演示，不会开始或结束真实专注。"),style=MaterialTheme.typography.bodySmall)
            Box(Modifier.fillMaxWidth().heightIn(min=96.dp).background(MaterialTheme.colorScheme.surfaceVariant).padding(12.dp),contentAlignment=Alignment.Center){
                if(practiced)Text(ui.text("已学会唤出结束入口"))
                else NativeFocusExitControl(true,{practiced=true})
            }
        }
        if(index==4){
            var result by rememberSaveable{mutableStateOf<String?>(null)}
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(12.dp)){
                NativeIconAction(ui.text("重置视角"),"reset",{result="视角已复位，仍围绕所选建筑"})
                NativeIconAction(ui.text("重置地图"),"map",{result="已返回整个聚落的总览"})
            }
            result?.let{Text(ui.text(it),style=MaterialTheme.typography.bodySmall)}
        }
        if(index>0)NativeAction(ui.text("上一页"),{index--},primary=false,icon="chevron")
        NativeAction(ui.text(if(index==pages.lastIndex)"开始使用" else "下一页"),{if(index==pages.lastIndex)onClose()else index++},Modifier.fillMaxWidth())
    }
}

/** Idle is a scheduling opportunity, not a timer bypass. The active launch
 * effect cancels/removes this handler on background, loading or interaction. */
private suspend fun awaitNativePageIdle()=kotlinx.coroutines.suspendCancellableCoroutine<Unit>{continuation->
    val queue=android.os.Looper.myQueue()
    val idle=android.os.MessageQueue.IdleHandler{if(continuation.isActive)continuation.resume(Unit);false}
    queue.addIdleHandler(idle)
    continuation.invokeOnCancellation{queue.removeIdleHandler(idle)}
}
