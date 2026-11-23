package com.blockcolc.preview

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import com.blockcolc.domain.*
import com.blockcolc.focus.*
import com.blockcolc.storage.*
import com.blockcolc.storage.android.AndroidStateDatabase
import com.blockcolc.presentation.*
import com.blockcolc.preview.world.WorldRequestIdentity
import com.blockcolc.preview.blueprints.NativeBlueprintLibrary
import com.blockcolc.world.generation.BuiltinBlueprintCatalog
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.FutureTask
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/** API-23-compatible completion receipt. Only the local preference writer can
 * acknowledge success; audio waits on the Future interface from its IO lane. */
private class PreferenceSaveReceipt:java.util.concurrent.FutureTask<Unit>({Unit}){
    fun saved(){set(Unit)}
    fun failed(cause:Throwable){setException(cause)}
}

data class AllocationRow(val title: String, val duration: Long)
/** Composition-root-only immutable facts. Feature pages never receive the
 * domain document, database handle or a second writable timer state. */
data class CommittedWorldInput(val identity:WorldRequestIdentity,val document:DomainDocument,val environmentStyle:String,
    val sceneIdentity:WorldRequestIdentity=identity)
data class PreviewSnapshot(val ready: Boolean = false, val error: String? = null, val projects: List<ProjectRow> = emptyList(), val activeProject: String? = null,
    val notes: List<NoteRow> = emptyList(), val phase: String = "IDLE", val round: Int = 0, val rounds: Int = 0, val heading: String = "方块钟", val detail: String = "",
    val ticket: DeadlineTicket? = null, val millis: Long = 0, val completed: Int = 0, val allocations: List<AllocationRow> = emptyList(), val roots: List<BackupRoot> = emptyList(),
    val revision: Long = 0, val message: String? = null, val busy: Boolean = false, val progress: Int? = null, val planMode:PlanMode?=null, val importSummary:String?=null,val backupOperation:BackupOperation?=null,
    val preferences:ClientPreferences=ClientPreferences(),val preferencesReadFailed:Boolean=false,val preferencesSaving:Boolean=false,
    val choices:List<ProjectChoice> = emptyList(),val reportPool:ReportPool?=null,val planId:String?=null,val plannedFocusMs:Long?=null,
    val timer:TimerPresentation?=null,val uiResources:UiResources?=null,val workspace:WorkspaceProjection?=null,val blueprintNames:Map<String,String> = emptyMap(),
    val receipts:List<UiReceipt> = emptyList(),val setupRequired:Boolean=false,val tutorialPending:Boolean=false,val generation:Long=0,val refreshRequired:Boolean=false,val dailyBackupFailed:Boolean=false,val automaticAuthorized:Boolean=false,
    val blueprints:NativeBlueprintLibrary=NativeBlueprintLibrary(),val returnReminderKey:String?=null,val achievementAttention:Set<String> = emptySet(),val achievementAttentionFailed:Boolean=false,val roomContext:String?=null,val backupListingReady:Boolean=false,val backupImportIssue:BackupImportIssue?=null,
    val extensionStartedAt:String?=null)

/** One process-wide writer, including receiver/service entry. No renderer or main-thread storage. */
class PreviewRuntime private constructor(private val context: Context):WorkspaceActions,AchievementReceiptActions {
    private val deviceCloudGate=CloudExecutionGate(context)
    internal var cloudGate=deviceCloudGate;private set
    @Volatile private var cloudTesting=false
    val platform = FocusPlatform(context)
    private val actor = ScheduledThreadPoolExecutor(1) { r -> Thread(r, "blockcolc-p2-actor") }.apply { removeOnCancelPolicy = true }
    private val domainReadCache by lazy{
        val cache=com.blockcolc.storage.android.AndroidDomainReadCache(context.applicationContext)
        if(BuildConfig.NATIVE_DIAGNOSTICS||BuildConfig.BUILD_TYPE=="benchmark")object:DomainReadCache by cache{
            override fun read(contentDigest:String,domainSha:String,parts:()->List<String>)=cache.read(contentDigest,domainSha,parts).also{domain->
                NativeStartupTrace.point(if(domain==null)"domain-checkpoint-miss" else "domain-checkpoint-hit")
            }
            override fun readBlueprints(assetDigest:String)=cache.readBlueprints(assetDigest).also{proofs->
                NativeStartupTrace.point(if(proofs==null)"blueprint-checkpoint-miss" else "blueprint-checkpoint-hit")
            }
        }else cache
    }
    private val main = Handler(Looper.getMainLooper())
    private val prefs = context.getSharedPreferences("p2-storage", Context.MODE_PRIVATE)
    @Volatile private var uiPrefs=context.getSharedPreferences("native-ui",Context.MODE_PRIVATE)
    private var clientPreferences=PreferencesController(AndroidPreferencesStorage(context))
    private var testPreferences:Pair<PreferencesController,java.io.File>?=null
    private var setupFinishedInProcess=false
    private val pendingPreferences=java.util.concurrent.atomic.AtomicInteger()
    private var uiResources:UiResources?=null
    private var blueprintNames:Map<String,String>?=null
    private var blueprintCatalog:BuiltinBlueprintCatalog?=null
    private var blueprintLibrary:Pair<String,NativeBlueprintLibrary>?=null
    private var rewardsPreparedFor:Pair<String,Long>?=null
    private val receipts=java.util.ArrayDeque<UiReceipt>()
    private data class WorkspaceKey(val room:String,val sha:String,val date:String)
    private class WorkspaceJob(var key:WorkspaceKey,val preparation:WorkspacePreparation,var observe:Boolean){
        var future:Future<*>?=null
    }
    private var workspaceCache:Pair<WorkspaceKey,WorkspaceProjection>?=null
    private var pendingWorkspace:WorkspaceJob?=null
    private var historyMayStart=false
    private val workspaceWorker by lazy{Executors.newSingleThreadExecutor{work->
        Thread({android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND);work.run()},"blockcolc-history")
    }}
    private var db: AndroidStateDatabase? = null
    private var store: NativeStateStore? = null
    private var coordinator: FocusCoordinator? = null
    private var future: ScheduledFuture<*>? = null
    private var dailyFuture:ScheduledFuture<*>?=null
    private var firstBackupEligibleAt=0L
    private val dailyBackups=DailyBackupCoordinator(System::currentTimeMillis,SystemClock::elapsedRealtime,{date,at->
        val storage=checkNotNull(store)
        // captureDaily reads/validates the actual state and checks this token.
        // A preceding full load would read all blueprint bodies twice.
        val capture=storage.captureDaily(StateToken(latest.revision,latest.generation),DomainTime.format(at),targetDate=date)
        check(!capture.overBudget){"DAILY_BACKUP_LIMIT"}
        // Refresh an already requested list, not a hidden settings panel on
        // the first usable frame. Capture itself has verified its transaction.
        if(capture.changed&&latest.backupListingReady)publish(latest.copy(roots=storage.backupRoots(),backupListingReady=true))
    },{failed->publish(latest.copy(dailyBackupFailed=failed))})
    private fun scheduleDaily(){
        dailyFuture?.cancel(false);dailyFuture=null
        if(recordingTest||!latest.ready||latest.refreshRequired||latest.error!=null)return
        val afterPendingAction=if(uiPending.get())SystemClock.elapsedRealtime()+100 else 0L
        dailyBackups.check(maxOf(firstBackupEligibleAt,afterPendingAction))?.let{delay->
            dailyFuture=actor.schedule({scheduleDaily()},delay,TimeUnit.MILLISECONDS)
        }
    }
    private val listeners = java.util.concurrent.CopyOnWriteArraySet<(PreviewSnapshot) -> Unit>()
    private val worldListeners=java.util.concurrent.CopyOnWriteArraySet<(CommittedWorldInput)->Unit>()
    private val cloudFocusListeners=java.util.concurrent.CopyOnWriteArraySet<()->Unit>()
    private val celebrationState=androidx.compose.runtime.mutableStateOf(NativeCelebrations())
    var celebrations:NativeCelebrations
        get()=celebrationState.value
        private set(value){celebrationState.value=value}
    private data class PresentationContext(val celebrations:NativeCelebrations,val receipts:AchievementReceipts,val attention:AchievementAttention,
        val firstUse:android.content.SharedPreferences,val setupFinished:Boolean)
    private var realPresentation:PresentationContext?=null
    private val navigation=SystemNavigation(SystemClock::elapsedRealtime)
    private var achievementReceipts=AchievementReceipts(AndroidAchievementReceiptStorage(context))
    private var achievementAttention=AchievementAttention(AndroidAchievementReceiptStorage.attention(context.filesDir))
    private val observingBirthday=java.util.concurrent.atomic.AtomicBoolean(false)
    @Volatile var committedWorld:CommittedWorldInput?=null;private set
    @Volatile var latest = PreviewSnapshot(); private set
    private var initialized = false
    private var lastCloudFocus:CloudFocusMoment?=null
    private data class CloudFocusMoment(val database:String,val databaseGeneration:Long,val activeId:String?,val phase:PlanPhase?,val deadline:String?)
    private data class PendingBackup(val backup:ParsedBackup,val original:NativeBackupImportFile,val summary:String)
    private var pendingImport:PendingBackup?=null
    private var importIssue:BackupImportIssue?=null
    private fun discardPendingImport(){val prior=pendingImport;pendingImport=null;importIssue=null;discardImportFile(prior?.original)}
    private fun rejectedImport(error:Throwable){
        val causes=generateSequence(error){it.cause}.take(8).toList()
        importIssue=when{
            causes.any{it is OutOfMemoryError}->BackupImportIssue.MEMORY
            causes.any{it is SecurityException||it is java.io.IOException}->BackupImportIssue.READ
            causes.any{it is StateInputException&&it.code=="LIMIT_EXCEEDED"||it.message?.contains("100 MiB")==true}->BackupImportIssue.LIMIT
            causes.any{it is BackupRejected&&it.message?.contains("checksum",ignoreCase=true)==true}->BackupImportIssue.CHECKSUM
            causes.any{it is BackupRejected&&(it.message?.contains("version",ignoreCase=true)==true||it.message?.contains("format",ignoreCase=true)==true)}->BackupImportIssue.VERSION
            else->BackupImportIssue.INVALID
        }
        if(BuildConfig.NATIVE_DIAGNOSTICS)android.util.Log.w("BlockcolcBackup","Import rejected: ${importIssue?.name}, ${error.javaClass.simpleName}")
    }
    private fun discardImportFile(file:NativeBackupImportFile?){try{file?.discard()}catch(error:Exception){android.util.Log.w("BlockcolcStorage","Import staging cleanup deferred",error)}}
    private val uiPending=java.util.concurrent.atomic.AtomicBoolean(false)
    @Volatile private var recordingTest=false
    internal fun cloudIoAllowed(isolated:Boolean)=if(isolated)BuildConfig.NATIVE_DIAGNOSTICS&&recordingTest&&cloudTesting else !recordingTest
    private val testJournal=JSONArray()
    private fun record(result:Operation){if(recordingTest){
        require(testJournal.length()<1000)
        testJournal.put(JSONObject().put("commands",JSONArray(result.journal.map{JSONObject().put("command",JSONObject(it.command)).put("now",it.now)}))
            .put("events",JSONArray(result.events.map{JSONObject(it)})).put("after",result.state.domain.canonical).put("replayed",result.replayed))
    }}
    private fun id() = UUID.randomUUID().toString()
    fun subscribe(listener: (PreviewSnapshot) -> Unit): () -> Unit { listeners.add(listener); listener(latest); return { listeners.remove(listener) } }
    fun subscribeWorld(listener:(CommittedWorldInput)->Unit):()->Unit {
        check(Looper.myLooper()==Looper.getMainLooper());worldListeners.add(listener);committedWorld?.let(listener)
        return {worldListeners.remove(listener)}
    }
    internal fun subscribeCloudFocus(listener:()->Unit):()->Unit{
        cloudFocusListeners.add(listener)
        return {cloudFocusListeners.remove(listener)}
    }
    fun start() = enqueue("startup") { c ->
        // The Activity can resume while the actor is still opening the DB.
        // Reconcile deadlines and the saved foreground observation together.
        c.observeLifecycle(true,"app-switch",System.currentTimeMillis()){ "resume:${id()}" }
    }
    private fun observeCloudFocus(state:StoredState){
        if((recordingTest&&!cloudTesting)||!cloudGate.ownsAccountExecution())return
        val active=state.domain.activeFocusSession()
        val plan=state.recovery.plan
        val moment=CloudFocusMoment(databaseName(),state.token.replacementGeneration,active?.getString("id"),plan?.phase,
            active?.getString("endsAt")?:plan?.phaseEndsAt)
        if(moment==lastCloudFocus)return
        lastCloudFocus=moment
        if(!recordingTest)NativeCloudController.get(context,this).start()
        cloudFocusListeners.forEach{it()}
    }
    private fun committedEvents(result:Operation){
        if(!result.replayed)observeCloudFocus(result.state)
        val target=celebrations
        if(!result.replayed&&result.events.isNotEmpty()){
            val completion=ProjectCompletion.from(result.state.domain,result.events)
            main.post{target.accept(result.events,false,completion)}
        }
    }
    /** Called on visible startup, resume, settings change and at a bounded
     * interval. Ineligible checks do not write or create a command receipt. */
    fun observeBirthday(){
        val display=latest;val known=committedWorld?.takeIf{it.identity.revision==display.revision&&it.identity.replacementGeneration==display.generation}?.document
        val workspace=display.workspace
        // This is an eligibility check over already committed display facts,
        // not a periodic full-database refresh. A due reward still reloads and
        // validates actual storage below before issuing any command.
        if(known!=null&&workspace!=null){
            val now=System.currentTimeMillis()
            val today=DomainTime.localDate(DomainTime.format(now),workspace.settings.timeZone)
            if(today==workspace.today&&!BirthdayObservation.due(known,now))return
        }
        if(!observingBirthday.compareAndSet(false,true))return
        actor.execute {
            var committed=false
            try{
                val c=open();val before=c.load();val now=System.currentTimeMillis()
                if(BirthdayObservation.due(before.domain,now)){
                    val result=WorkspaceCommands.commit(c,id(),WorkspaceMutation.ObserveBirthday,now)
                    committed=true
                    committedEvents(result);adopt(result.state,events=result.events+result.signals);record(result)
                }else{
                    val date=DomainTime.localDate(DomainTime.format(now),before.domain.focusControlJson().getJSONObject("calendar").getString("timeZone"))
                    if(latest.workspace?.today!=date||latest.revision!=before.token.revision||latest.generation!=before.token.replacementGeneration)adopt(before)
                }
            }catch(error:Exception){
                if(committed||error is CommittedStateUnavailable)publish(latest.copy(refreshRequired=true,message=null))
                android.util.Log.w("BlockcolcP3","Birthday observation needs a later visible check or display recovery",error)
            }
            finally{observingBirthday.set(false)}
        }
    }
    override fun readAchievementReceipts(done:(Set<String>?,Boolean)->Unit){actor.execute{
        val result=runCatching{achievementReceipts.read()}
        main.post{done(result.getOrNull(),result.isFailure)}
    }}
    override fun acknowledgeAchievements(ids:List<String>,done:(Set<String>?,Boolean)->Unit){
        val frozen=ids.toList()
        actor.execute{val result=runCatching{achievementReceipts.acknowledge(frozen)};main.post{done(result.getOrNull(),result.isFailure)}}
    }
    private fun open(prepareAssets:Boolean=true,forceDailyPool:Boolean=false): FocusCoordinator {
        // Packaged UI assets are immutable and have no dependency on the
        // current database. The actor stays the sole reader/writer of facts.
        val assets=if(uiResources==null)FutureTask{
            val ui=NativeStartupTrace.measure("ui-resources",benchmark=true){UiResources.load()}
            val catalog=NativeStartupTrace.measure("blueprint-catalog",benchmark=true){BuiltinBlueprintCatalog.load()}
            ui to catalog
        }.also{task->Thread(task,"blockcolc-startup-assets").apply{isDaemon=true;start()}}else null
        val preferences=clientPreferences.load()
        if(!latest.ready&&latest.uiResources==null)publish(latest.copy(uiResources=uiResources?:UiResources.storageLoading,
            preferences=preferences.value,preferencesReadFailed=preferences.readFailed))
        val opened=try{
            coordinator?:openDatabase()
        }finally{
            // Recovery screens also need the complete translations and
            // glyphs. Install the assets even if the database read failed.
            if(assets!=null){
                val (ui,catalog)=assets.get()
                blueprintNames=java.util.Collections.unmodifiableMap(catalog.entries.associate{it.id to it.displayName})
                blueprintCatalog=catalog
                uiResources=ui
            }
        }
        return if(prepareAssets)prepareRewards(opened,forceDailyPool)else opened
    }
    private fun databaseName():String = checkNotNull(prefs.getString("database","p2-state.db")).also{
        require(it.matches(Regex("p2-[a-zA-Z0-9-]+\\.db")))
    }
    private fun openDatabase():FocusCoordinator{
        val name=databaseName()
        db?.close();val database = AndroidStateDatabase(context, name); db = database
        recordingTest=BuildConfig.NATIVE_DIAGNOSTICS&&prefs.getString("beforeTest",null)!=null
        val measured=P2MeasuredDatabase(database)
        val store = (if(recordingTest)NativeStateStore(measured)else NativeStateStore(measured,domainReadCache)).also{this.store=it}
        if(recordingTest)isolatePresentation(name)
        P2Trace.event("database-open-start")
        NativeStartupTrace.measure("database-first-read",benchmark=true) {
            if (NativeStartupTrace.measureInitialRead{store.load()} == null) {
                if(!recordingTest)check(uiPrefs.edit().putBoolean("setupRequired",true).putBoolean("tutorialPending",true).commit()){"First-use marker was not saved"}
                store.initialize(DomainEngine.initial(java.util.TimeZone.getDefault().id))
            }
        }
        P2Trace.event("database-validated")
        return FocusCoordinator(store,name).also{coordinator=it}
    }
    private fun prepareRewards(c:FocusCoordinator,force:Boolean=false):FocusCoordinator{
        if(rewardsPreparedFor==(c.databaseIdentity to latest.generation))return c
        val current=c.load()
        // Creating a task, setting its first goal and starting the first
        // round cannot award a daily decoration without any focus facts.
        // A saved active session or history reopens the gate before commands
        // and reconciliation, including the first deadline in a new process.
        if(!force&&!current.domain.hasFocusFacts())return c
        val key=c.databaseIdentity to current.token.replacementGeneration
        if(rewardsPreparedFor!=key){
            val catalog=checkNotNull(blueprintCatalog)
            NativeStartupTrace.measure("daily-reward-registration",benchmark=true) {
                DailyRewardRegistration.prepare(c,catalog.entries.filter{it.category=="daily"}.map{it.id},
                    blueprint={catalog.content(it).json()},requestId={"daily-register:${id()}"},now=System.currentTimeMillis(),onCommitted=::record)
            }
            rewardsPreparedFor=key
        }
        return c
    }
    private fun publish(value: PreviewSnapshot) {
        if(BuildConfig.BUILD_TYPE=="benchmark"&&value.phase=="FOCUS"&&!value.busy&&latest.phase!="FOCUS")
            NativeStartupTrace.point("focus-state-published")
        // Pending user confirmation belongs to the import operation, not a
        // particular domain projection. Foreground/cloud/timer reconciliation
        // may replace that projection without dismissing the candidate file.
        val current=value.copy(importSummary=pendingImport?.summary,backupImportIssue=importIssue)
        latest=current
        main.post{listeners.forEach{it(current)}}
    }
    private fun receipt(id:String?,saved:Boolean,reason:String?=null):List<UiReceipt>{
        if(id!=null){receipts.addLast(UiReceipt(id,saved,reason));while(receipts.size>256)receipts.removeFirst()}
        return receipts.toList()
    }
    private fun enqueue(name:String,uiRequest:String?=null,lockUi:Boolean=true,prepareRewardsBefore:Boolean=true,work:(FocusCoordinator)->Operation) {
        if(uiRequest!=null&&latest.refreshRequired&&name!="refresh-workspace"){
            actor.execute{publish(latest.copy(receipts=receipt(uiRequest,false,"VIEW_NOT_READY")))}
            return
        }
        val lifecycle=name in setOf("startup","RecordFocusBackgrounded","RecordFocusForegrounded")
        val gated=!lifecycle&&lockUi
        if(gated&&!uiPending.compareAndSet(false,true)){
            if(uiRequest!=null)actor.execute{publish(latest.copy(receipts=receipt(uiRequest,false,"BUSY")))}
            return
        }
        actor.execute {
            if(lifecycle&&name!="startup"&&!initialized)return@execute
            if(gated)publish(latest.copy(busy=true,message=null))
            val begin = SystemClock.elapsedRealtimeNanos()
            var acknowledged:Operation?=null
            try {
                val c = NativeStartupTrace.measure("runtime-open",benchmark=true){open(prepareAssets=prepareRewardsBefore)}
                val result = NativeStartupTrace.measure("runtime-command",benchmark=true){
                    val viewOnly=(!recordingTest||cloudTesting)&&!cloudGate.canExecute()
                    val protected=name in setOf("confirm-plan","start-plan","begin-focus","amend-plan","start-focus","manual","focus-decision","report-draft","report")
                    if(viewOnly&&protected)throw FocusFailure("CLOUD_VIEW_ONLY")
                    if(viewOnly&&lifecycle)Operation(c.load()) else
                    if(BuildConfig.BUILD_TYPE=="benchmark"&&(name=="begin-focus"||name=="start-plan"))
                        NativeStartupTrace.measureFocusWrite{work(c)}
                    else work(c)
                }; acknowledged=result; initialized = true
                if(gated)uiPending.set(false)
                committedEvents(result);NativeStartupTrace.measure("presentation",benchmark=true){adopt(result.state,uiRequest,result.events+result.signals)}; record(result);trace(name, begin, result.state, result.replayed)
            } catch (error: Exception) {
                if(acknowledged!=null||error is CommittedStateUnavailable){
                    initialized=true
                    if(gated)uiPending.set(false)
                    publish(latest.copy(busy=uiPending.get(),refreshRequired=true,receipts=receipt(uiRequest,true,"DISPLAY_UNAVAILABLE"),message=null))
                    android.util.Log.e("BlockcolcP3","Committed operation $name needs display recovery",error)
                    return@execute
                }
                val broken = error is StorageCorruption || !initialized && !latest.ready
                if(gated)uiPending.set(false)
                publish(latest.copy(ready = if (broken) false else latest.ready, refreshRequired=if(broken)false else latest.refreshRequired,error = if (broken) "本地记录需要恢复，原文件已保留。${error.message}" else latest.error, busy = uiPending.get(), message = error.message ?: error.javaClass.simpleName,
                    receipts=receipt(uiRequest,false,(error as? FocusFailure)?.reason?:error.javaClass.simpleName),uiResources=uiResources))
                android.util.Log.e("BlockcolcP2", name, error)
            }finally{if(gated)uiPending.set(false)}
        }
    }
    private fun projectWorkspace(s:JSONObject,now:Long,key:WorkspaceKey,focusBase:WorkspaceKey?,observe:Boolean):WorkspaceProjection{
        fun reusable(candidate:WorkspaceKey)=candidate==key||candidate==focusBase
        workspaceCache?.takeIf{reusable(it.first)}?.second?.let{workspace->
            workspaceCache=key to workspace
            return workspace
        }
        pendingWorkspace?.takeIf{reusable(it.key)}?.let{job->
            job.key=key
            job.observe=job.observe||observe
            return job.preparation.summary
        }
        pendingWorkspace?.future?.cancel(false)
        pendingWorkspace=null
        if(!latest.ready&&!recordingTest&&s.getJSONArray("focusHistory").length()>0){
            val preparation=NativeStartupTrace.measure("workspace-summary-projection",benchmark=true){WorkspaceProjection.prepare(s,now)}
            pendingWorkspace=WorkspaceJob(key,preparation,observe)
            return preparation.summary
        }
        return NativeStartupTrace.measure("workspace-history-projection",benchmark=true){WorkspaceProjection.from(s,now)}.also{workspaceCache=key to it}
    }

    private fun workspaceAttention(room:String,workspace:WorkspaceProjection,observe:Boolean):Result<Set<String>> =
        if(observe&&workspace.details==WorkspaceDetails.READY)
            runCatching{achievementAttention.observe(room,workspace.achievements.filter{it.unlocked}.map{it.definition.id}.toSet())}
        else Result.success(emptySet())

    private fun workspaceAllocations(workspace:WorkspaceProjection):List<AllocationRow> =
        if(BuildConfig.NATIVE_DIAGNOSTICS)workspace.days.flatMap{it.targets}.groupBy{it.projectTitle}.map{(title,items)->AllocationRow(title,items.sumOf{it.durationMs})}
        else emptyList()

    internal fun onFirstWorkspaceFrame(){
        actor.execute{
            if(!historyMayStart){
                historyMayStart=true
                startWorkspaceDetails()
            }
        }
    }

    private fun startWorkspaceDetails(){
        if(!historyMayStart)return
        val job=pendingWorkspace?:return
        if(job.future!=null)return
        job.future=workspaceWorker.submit{
            val result=runCatching{NativeStartupTrace.measure("workspace-history-projection",benchmark=true){job.preparation.complete()}}
            actor.execute{finishWorkspaceDetails(job,result)}
        }
    }

    private fun finishWorkspaceDetails(job:WorkspaceJob,result:Result<WorkspaceProjection>){
        if(pendingWorkspace!==job)return
        pendingWorkspace=null
        val world=committedWorld?:return
        val current=latest
        if(!current.ready||current.error!=null||current.refreshRequired||current.roomContext!=job.key.room||
            current.workspace!==job.preparation.summary||world.document.sha256!=job.key.sha||
            world.identity.revision!=current.revision||world.identity.replacementGeneration!=current.generation)return
        val workspace=result.getOrElse{error->
            android.util.Log.w("BlockcolcP3","History projection unavailable",error)
            publish(current.copy(workspace=job.preparation.summary.copy(details=WorkspaceDetails.FAILED)))
            return
        }
        workspaceCache=job.key to workspace
        val attention=workspaceAttention(job.key.room,workspace,job.observe)
        publish(current.copy(workspace=workspace,allocations=workspaceAllocations(workspace),
            achievementAttention=attention.getOrDefault(emptySet()),achievementAttentionFailed=attention.isFailure))
        NativeStartupTrace.point("workspace-details-published")
    }

    private data class FocusSurface(val phase:String,val round:Int,val count:Int,val heading:String,val detail:String)
    private fun focusSurface(state:StoredState,active:JSONObject?,subtaskTitle:(String)->String?):FocusSurface{
        val plan=state.recovery.plan
        val phase=plan?.phase?.name?:if(active!=null)"FOCUS" else "IDLE"
        val round=plan?.completedSessionIds?.size?:0;val count=plan?.totalRounds?:0
        val heading=when(phase){"FOCUS"->if(plan?.extensionStartedAt!=null)"加时专注"else"专注中 第 ${round+1}/${maxOf(1,count)}轮";"REST"->"休息中";"REPORT"->"汇报本次推进";"READY"->"准备下一轮";else->"把专注慢慢建成世界"}
        val detail=active?.takeUnless{it.isNull("subtaskId")}?.getString("subtaskId")?.let(subtaskTitle)?:if(phase=="READY")"剩余专注总时间" else ""
        return FocusSurface(phase,round,count,heading,detail)
    }
    private fun RecoveryContext.keepDeadlineService()=automatic!=null||plan?.let{it.extendAfterPlan&&it.phase in setOf(PlanPhase.FOCUS,PlanPhase.REST)}==true

    /** A system-only wake still reconciles and schedules the absolute
     * deadline. There is no screen to prepare until the first Activity load. */
    private fun adoptPlatformOnly(c:FocusCoordinator,state:StoredState,events:List<String>){
        val active=state.domain.activeFocusSession()
        val (phase,round,count,heading,detail)=focusSurface(state,active){task->
            val projects=state.domain.focusControlJson().getJSONArray("projects")
            val owner=(0 until projects.length()).asSequence().map(projects::getJSONObject)
                .firstOrNull{it.getString("id")==active?.getString("projectId")}
            owner?.getJSONArray("subtasks")?.let{items->
                (0 until items.length()).asSequence().map(items::getJSONObject).firstOrNull{it.getString("id")==task}?.getString("title")
            }
        }
        val preferences=clientPreferences.load()
        val display=latest.copy(phase=phase,round=round,rounds=count,heading=heading,detail=detail,ticket=c.deadline(state),
            revision=state.token.revision,generation=state.token.replacementGeneration,planMode=state.recovery.plan?.mode,planId=state.recovery.plan?.id,
            preferences=preferences.value,preferencesReadFailed=preferences.readFailed,automaticAuthorized=state.recovery.keepDeadlineService(),
            extensionStartedAt=state.recovery.plan?.extensionStartedAt?.takeIf{phase=="FOCUS"},
            returnReminderKey=state.recovery.returnReminder?.takeIf{it.database==c.databaseIdentity}?.key)
        publish(display)
        projectFocusPlatform(c,display,events){ack->adoptPlatformOnly(c,ack,emptyList())}
        NativeStartupTrace.point("receiver-platform-only")
    }

    private fun projectFocusPlatform(c:FocusCoordinator,display:PreviewSnapshot,events:List<String>,adoptReminder:(StoredState)->Unit):Boolean{
        future?.cancel(false);future=null
        if((!recordingTest||cloudTesting)&&!cloudGate.canExecute()){platform.update(null,PreviewSnapshot());return false}
        try{
            val delivered=P2OperationCost.section("platform-projection"){platform.update(display.ticket,display,events)}
            if(delivered!=null){
                adoptReminder(c.acknowledgeReturnReminder("notice:$delivered",delivered).state)
                return true
            }
        }catch(error:Exception){android.util.Log.w("BlockcolcP2","Facts saved; platform projection unavailable",error);publish(display.copy(message="记录已保存，系统提醒暂不可用"))}
        display.ticket?.let{ticket->
            val delay=maxOf(0,DomainTime.millis(ticket.end)-System.currentTimeMillis())
            future=actor.schedule({receive(ticket.json().toString()){}},delay,TimeUnit.MILLISECONDS)
        }
        return false
    }

    private fun adopt(state: StoredState,uiRequest:String?=null,events:List<String> = emptyList(),observePresentation:Boolean=true) {
        val c = coordinator!!
        val s = NativeStartupTrace.measure("workspace-wire-projection",benchmark=true){state.domain.projectionJson()}
        val p = state.recovery.plan
        // Archive listing belongs to the backup panel, not every timer/state
        // adoption. Never advertise a retained list as newly verified.
        val room=c.workspaceContext(state.token.replacementGeneration)
        val root=latest.roots.takeIf{latest.roomContext==room}.orEmpty()
        fun rows(name: String) = s.getJSONArray(name).let { a -> List(a.length()) { a.getJSONObject(it) } }
        val projects = rows("projects").map { item ->
            val tasks = item.getJSONArray("subtasks").let { a -> List(a.length()) { a.getJSONObject(it) } }.map { TaskRow(it.getString("id"), it.getString("title"), it.getInt("progressBasisPoints")) }
            ProjectRow(item.getString("id"), item.getString("title"), item.getString("kind"), item.getString("status"), tasks, DomainEngine.progress(item), item.getString("blueprintId"))
        }
        val ticket=c.deadline(state)
        val (phase,round,count,heading,detail)=focusSurface(state,s.optJSONObject("activeFocusSession")){task->
            projects.asSequence().flatMap{it.tasks.asSequence()}.firstOrNull{it.id==task}?.title
        }
        val history = rows("focusHistory")
        val now=System.currentTimeMillis();val date=DomainTime.localDate(DomainTime.format(now),s.getJSONObject("calendar").getString("timeZone"))
        val key=WorkspaceKey(room,state.domain.sha256,date)
        // One detached JSON tree per adoption. These projections only read it
        // and publish immutable models; large blueprint pools are not parsed
        // again for each page. The DomainDocument keeps its ownership boundary.
        // Workspace history and task statistics do not include the live
        // session. Reuse them on a proven focus splice in the same room
        // and civil day. Timer and report controls still read current facts.
        val previous=committedWorld?.takeIf{it.identity.database==c.databaseIdentity&&it.identity.replacementGeneration==state.token.replacementGeneration}
        val focusBase=previous?.takeIf{state.domain.activeFocusWireFrom(it.document)!=null}
            ?.let{key.copy(sha=it.document.sha256)}
        val workspace=projectWorkspace(s,now,key,focusBase,observePresentation)
        val library=blueprintLibrary?.takeIf{it.first==key.sha||it.first==focusBase?.sha}?.second
            ?:NativeBlueprintLibrary.from(s,blueprintCatalog!!,state.domain)
        blueprintLibrary=key.sha to library
        val allocation=workspaceAllocations(workspace)
        val preferences=clientPreferences.load()
        if(observePresentation&&(projects.isNotEmpty()||history.isNotEmpty()))finishSetup()
        val attention=workspaceAttention(room,workspace,observePresentation)
        val display = PreviewSnapshot(true, projects = projects, activeProject = if (s.isNull("activeProjectId")) null else s.getString("activeProjectId"),
            notes = rows("quickNotes").map { NoteRow(it.getString("id"), it.getString("text"), it.getBoolean("completed")) }, phase = phase, round = round, rounds = count, heading = heading, detail = detail,
            ticket = ticket, millis = history.sumOf { it.getLong("actualDurationMs") }, completed = history.count { it.getString("status") != "interrupted" }, allocations = allocation,
            roots = root, revision = state.token.revision, progress = projects.firstOrNull { it.id == "complex-0" }?.progress,planMode=p?.mode,
            preferences=preferences.value,preferencesReadFailed=preferences.readFailed,preferencesSaving=pendingPreferences.get()>0,
            choices=FocusChoices.projects(s),reportPool=ReportPool.from(s,state.recovery),planId=p?.id,plannedFocusMs=p?.focusDurationMs,
            timer=TimerPresentation.from(s,state.recovery,preferences.value,now,events),uiResources=uiResources,workspace=workspace,blueprintNames=blueprintNames.orEmpty(),
            receipts=receipt(uiRequest,true),busy=uiPending.get(),setupRequired=!setupFinishedInProcess&&uiPrefs.getBoolean("setupRequired",false)&&projects.isEmpty()&&history.isEmpty(),tutorialPending=uiPrefs.getBoolean("tutorialPending",false),generation=state.token.replacementGeneration,dailyBackupFailed=latest.dailyBackupFailed,automaticAuthorized=state.recovery.keepDeadlineService(),blueprints=library,returnReminderKey=state.recovery.returnReminder?.takeIf{it.database==c.databaseIdentity}?.key,achievementAttention=attention.getOrDefault(emptySet()),achievementAttentionFailed=attention.isFailure,roomContext=room,
            extensionStartedAt=p?.extensionStartedAt?.takeIf{phase=="FOCUS"})
        val identity=WorldRequestIdentity(c.databaseIdentity,state.token.replacementGeneration,state.token.revision)
        // Plan-only writes and the proven session splice have no world
        // changes. Keep the render request alive, but publish the new
        // document and committed revision for birthday/recovery observers.
        val sceneIdentity=if(previous!=null&&(previous.document.sha256==state.domain.sha256||focusBase!=null))previous.sceneIdentity else identity
        if(previous?.identity!=identity&&sceneIdentity!=identity)NativeStartupTrace.point("world-facts-reused")
        val worldInput=CommittedWorldInput(identity,state.domain,s.getJSONObject("worldSettings").getString("environmentStyle"),sceneIdentity)
        committedWorld=worldInput
        main.post{if(committedWorld===worldInput)worldListeners.forEach{it(worldInput)}}
        // The first display can accept a command immediately. Give it a short
        // window before a due archive starts using the same serialized writer.
        if(!latest.ready)firstBackupEligibleAt=SystemClock.elapsedRealtime()+2_000
        publish(display)
        if(!recordingTest)NativeCloudController.peek()?.changed()
        if(workspace.details==WorkspaceDetails.PREPARING){
            NativeStartupTrace.point("workspace-summary-published")
            startWorkspaceDetails()
        }
        P2Trace.event("state-published")
        if(projectFocusPlatform(c,display,events){adopt(it)})return
        if(recordingTest) P2OperationCost.section("test-live-diagnostic") {
            val now=System.currentTimeMillis()
            val notices=context.getSystemService(android.app.NotificationManager::class.java).activeNotifications.map{item->
                val n=item.notification;val ticking=n.extras.getBoolean(android.app.Notification.EXTRA_SHOW_CHRONOMETER,false)
                JSONObject().put("id",item.id).put("when",n.`when`).put("chronometer",ticking).put("timeoutAfter",if(android.os.Build.VERSION.SDK_INT>=26)n.timeoutAfter else 0)
                    .put("overdueCountdown",ticking&&n.`when`<now-1000).put("foreground",n.flags and android.app.Notification.FLAG_FOREGROUND_SERVICE!=0)
            }
            val value=JSONObject().put("database",c.databaseIdentity).put("at",now).put("pid",android.os.Process.myPid()).put("revision",state.token.revision).put("generation",state.token.replacementGeneration)
                .put("phase",phase).put("round",round).put("rounds",count).put("localRecovery",JSONObject(state.recovery.canonical()))
                .put("notices",JSONArray(notices)).put("canScheduleExact",platform.exactAllowed()).put("canNotify",platform.notificationAllowed())
            // Preserve the full diagnostic domain, using its already validated
            // canonical bytes rather than a second whole-archive JSON tree.
            val payload=value.toString().dropLast(1)+",\"domain\":"+state.domain.canonical+"}"
            val file=android.util.AtomicFile(java.io.File(context.filesDir,"p2-live.json"));val stream=file.startWrite();try{stream.write(payload.toByteArray());file.finishWrite(stream)}catch(e:Exception){file.failWrite(stream);throw e}
        }
        dailyBackups.context("${c.databaseIdentity}:${state.token.replacementGeneration}",s.getJSONObject("calendar").getString("timeZone"))
        // A separate actor job runs after publication, never inside command adoption.
        actor.execute{scheduleDaily()}
    }
    fun receive(raw: String?, done: () -> Unit) {
        actor.execute {
            try {
                val ticket = raw?.let { DeadlineTicket.parse(JSONObject(it)) }
                // A wake with no local database has no plan to reconcile.
                // Let the first visible entry initialize its own workspace.
                if(coordinator==null&&!context.getDatabasePath(databaseName()).exists()){
                    NativeStartupTrace.point("receiver-no-local-state")
                    return@execute
                }
                val c = NativeStartupTrace.measure("receiver-open",benchmark=true){open(prepareAssets=false)}
                if((!recordingTest||cloudTesting)&&!cloudGate.canExecute()){
                    NativeStartupTrace.point("receiver-execution-not-owned")
                    platform.update(null,PreviewSnapshot());return@execute
                }
                val now=System.currentTimeMillis()
                // Reject another database/generation/session and early wakes
                // before packaged-asset preparation can write anything.
                if(ticket!=null){
                    val expected=NativeStartupTrace.measure("receiver-read-ticket",benchmark=true){c.deadline(c.load())}
                    if(ticket!=expected){NativeStartupTrace.point("receiver-stale-ticket");return@execute}
                    if(now<DomainTime.millis(ticket.end)){NativeStartupTrace.point("receiver-early-ticket");return@execute}
                }
                NativeStartupTrace.measure("receiver-reward-preparation",benchmark=true){prepareRewards(c)}
                val begin = SystemClock.elapsedRealtimeNanos()
                val result = if(ticket==null) {
                    // Boot, clock and permission changes only ask us to look at
                    // current facts. There is no external command to acknowledge.
                    NativeStartupTrace.measure("system-observation"){c.resume(now){"system:${id()}"}}
                } else NativeStartupTrace.measure("deadline-delivery",benchmark=true) {
                    if(BuildConfig.BUILD_TYPE=="benchmark")NativeStartupTrace.measureDeadlineWrite{
                        c.reconcile("deadline:${StrictJson.sha(StrictJson.render(ticket.json())).take(64)}",now,ticket)
                    }else c.reconcile("deadline:${StrictJson.sha(StrictJson.render(ticket.json())).take(64)}",now,ticket)
                }
                committedEvents(result)
                val events=result.events+result.signals
                if(!recordingTest&&!latest.ready&&latest.error==null){
                    NativeStartupTrace.measure("receiver-platform-projection",benchmark=true){adoptPlatformOnly(c,result.state,events)}
                }else NativeStartupTrace.measure("receiver-presentation",benchmark=true){adopt(result.state,events=events)}
                record(result);trace("receiver", begin, result.state, result.replayed)
            } catch (error: Exception) { android.util.Log.e("BlockcolcP2", "Deadline not committed; retained for foreground recovery", error) }
            finally { done() }
        }
    }
    fun command(command: JSONObject,uiRequest:String?=null) = enqueue(command.getString("type"),uiRequest,lockUi=command.getString("type") !in setOf("AddQuickNote","RenameQuickNote","SetQuickNoteCompleted","DeleteQuickNote")) {
        it.command(uiRequest?:id(), command, System.currentTimeMillis())
    }
    override fun dispatch(mutation:WorkspaceMutation,uiRequest:String){
        val captured=WorkspaceCommands.freeze(mutation)
        enqueue("workspace:${captured.javaClass.simpleName}",uiRequest,lockUi=captured !is WorkspaceMutation.Note){
            WorkspaceCommands.commit(it,uiRequest,captured,System.currentTimeMillis()){id->
                val resource=latest.blueprints.items.firstOrNull{entry->entry.id==id&&entry.selectable}?:error("Blueprint selection is no longer available")
                when(resource.category){"native"->null;"supplemental"->NativeBlueprintLibrary.importedSnapshot(blueprintCatalog!!.content(id).json());else->JSONObject(checkNotNull(resource.previewCanonical()))}
            }
        }
    }
    override fun decideFocus(decision:FocusDecision,uiRequest:String)=enqueue("focus-decision",uiRequest){
        WorkspaceCommands.decide(it,uiRequest,decision,System.currentTimeMillis())
    }
    override fun updatePreferences(change:(ClientPreferences)->ClientPreferences){
        savePreferences(change)
    }
    /** An asset operation may wait for this local-preference receipt on its
     * own IO lane. Its audio bytes never run on the focus writer. */
    fun savePreferences(change:(ClientPreferences)->ClientPreferences):java.util.concurrent.Future<Unit> = savePreferencesNotifying(change,null)
    private fun savePreferencesNotifying(change:(ClientPreferences)->ClientPreferences,onComplete:((Boolean)->Unit)?):java.util.concurrent.Future<Unit>{
        val receipt=PreferenceSaveReceipt()
        pendingPreferences.incrementAndGet()
        actor.execute{
            publish(latest.copy(preferencesSaving=true,message=null))
            var failure:String?=null
            var cause:Exception?=null
            try{
                val desired=change(clientPreferences.load().value)
                // Revoke the durable grant before acknowledging the off preference.
                // A preference disk failure can safely leave this plan manual.
                if(!desired.autoContinueFocus){val c=open(prepareAssets=false);if(c.load().recovery.automatic!=null){
                    val revoked=c.revokeAutomatic("revoke:${id()}");adopt(revoked.state);record(revoked)
                }}
                clientPreferences.update{desired}
                if(!desired.returnToFocusReminders){val c=open(prepareAssets=false);c.load().recovery.returnReminder?.let{r->
                    val cleared=c.acknowledgeReturnReminder("notice:${r.key}",r.key);adopt(cleared.state)
                }}
            }catch(error:Exception){cause=error;failure="设置未保存，已保留原值：${error.message}"}
            finally{
                val saved=clientPreferences.load();val pending=pendingPreferences.decrementAndGet()>0
                val timer=latest.timer?.let{view->if(view.surface==TimerSurface.IDLE){
                    val habit=latest.projects.find{it.id==latest.activeProject}?.kind=="habit"
                    view.copy(remainingMs=(if(habit)saved.value.habitFocusMinutes else saved.value.focusMinutes)*60000L)
                }else view}
                publish(latest.copy(preferences=saved.value,preferencesReadFailed=saved.readFailed,preferencesSaving=pending,message=failure,timer=timer))
                val notice=if(recordingTest&&!cloudTesting||cloudGate.canExecute())latest else PreviewSnapshot()
                runCatching{platform.update(notice.ticket,notice)}.onFailure{android.util.Log.w("BlockcolcP3","Saved preference; notification refresh unavailable",it)}
                if(!recordingTest)NativeCloudController.peek()?.changed()
            }
            if(cause==null)receipt.saved()else receipt.failed(cause)
            onComplete?.let{callback->val saved=cause==null;main.post{callback(saved)}}
        }
        return receipt
    }
    /** Confirmation is its own committed step; selecting tasks or editing a
     * sheet is only a draft. In particular a marathon stays on the ordinary
     * timer page until the user explicitly starts the confirmed plan. */
    override fun confirmPlan(draft:FocusDraft,uiRequest:String?)=enqueue("confirm-plan",uiRequest){c->
        FocusActions(c,clientPreferences).confirm(uiRequest?:id(),id(),draft,System.currentTimeMillis())
    }
    override fun startPlan(uiRequest:String?){
        NativeStartupTrace.point("focus-action-accepted")
        enqueue("start-plan",uiRequest){c->FocusActions(c,clientPreferences).start(uiRequest?:id(),System.currentTimeMillis())}
    }
    override fun beginFocus(draft:FocusDraft,uiRequest:String){
        NativeStartupTrace.point("focus-action-accepted")
        enqueue("begin-focus",uiRequest){c->FocusActions(c,clientPreferences).begin(uiRequest,id(),draft,System.currentTimeMillis())}
    }
    override fun amendPlan(planId:String,draft:FocusDraft,uiRequest:String)=enqueue("amend-plan",uiRequest){c->FocusActions(c,clientPreferences).amend(uiRequest,planId,id(),draft,System.currentTimeMillis())}
    fun focus(mode: PlanMode, rounds: Int, focusMinutes: Int, restMinutes: Int, automatic: Boolean, selected: String?, endAt: Long? = null) = enqueue("start-focus") { c ->
        val now = System.currentTimeMillis(); val current = c.load()
        if (current.recovery.plan == null) {
            val p = current.domain.json().getJSONArray("projects").let { a -> List(a.length()) { a.getJSONObject(it) } }.first { it.getString("id") == current.domain.json().getString("activeProjectId") }
            val task = if (mode == PlanMode.MINIMAL || p.getString("kind") == "habit") null else selected ?: p.getJSONArray("subtasks").getJSONObject(0).getString("id")
            c.confirm(id(), PlanRequest(id(), p.getString("id"), task, mode, rounds, focusMinutes * 60000L, restMinutes * 60000L, endAt?.let(DomainTime::format)), now)
        }
        c.start(id(), automatic, now)
    }
    fun manual(early: Boolean, whole: Boolean = false,category:String?="other",note:String?=null,uiRequest:String?=null) = enqueue("manual",uiRequest) { it.manual(uiRequest?:id(), early, whole, category, note, System.currentTimeMillis()) }
    override fun submitReport(draft:ReportDraft,uiRequest:String?){
        NativeStartupTrace.point("report-input-accepted")
        enqueue("report-draft",uiRequest){c->
            FocusActions(c,clientPreferences).report(uiRequest?:id(),draft,System.currentTimeMillis(),::id).also {
                NativeStartupTrace.point("report-saved")
            }
        }
    }
    override fun finishTutorial(){val target=uiPrefs;actor.execute{
        val saved=target.edit().putBoolean("tutorialPending",false).commit()
        if(target===uiPrefs)publish(latest.copy(tutorialPending=false,message=if(saved)null else "教程状态未保存，下次可能再次出现"))
    }}
    private fun finishSetup(){
        if(recordingTest&&(realPresentation==null||uiPrefs===realPresentation!!.firstUse))return
        setupFinishedInProcess=true
        if(uiPrefs.getBoolean("setupRequired",false)&&!uiPrefs.edit().putBoolean("setupRequired",false).commit())android.util.Log.w("BlockcolcP3","First-use completion marker could not be saved")
    }
    fun report(progress: Int, projectId: String, taskId: String?, rounds: Int) = enqueue("report") { c ->
        val plan = c.load().recovery.plan ?: throw FocusFailure("PLAN_NOT_FOUND"); val now = System.currentTimeMillis(); val request = id()
        if (plan.mode == PlanMode.ROUNDS) c.command(request, DomainEngine.command("ReportSubtaskProgress", "reportId" to id(), "subtaskId" to plan.subtaskId, "focusSessionIds" to JSONArray().put(plan.completedSessionIds.last()), "progressBasisPoints" to progress), now)
        else {
            val entries = JSONArray(); val habits = JSONArray()
            if (rounds > 0) {
                if (taskId == null) habits.put(JSONObject().put("projectId", projectId).put("rounds", rounds))
                else entries.put(JSONObject().put("reportId", id()).put("projectId", projectId).put("subtaskId", taskId).put("progressBasisPoints", progress).put("rounds", rounds))
            }
            c.report(request, entries, habits, now)
        }
    }
    fun create(title: String, habit: Boolean) = command(if (habit) DomainEngine.command("CreateHabitProject", "projectId" to id(), "title" to title, "blueprintId" to "builtin-small-workshop", "targetRounds" to 10)
        else DomainEngine.command("CreateProject", "projectId" to id(), "title" to title, "blueprintId" to "builtin-small-workshop", "subtasks" to JSONArray().put(JSONObject().put("id", id()).put("title", "第一件小事"))))
    override fun restore(root: String,uiRequest:String?) = enqueue("restore",uiRequest) { it.restore(uiRequest?:id(), root, System.currentTimeMillis()) }
    override fun refreshBackups(uiRequest:String){
        val expected=latest.roomContext
        actor.execute{
            if(expected==null||latest.roomContext!=expected){publish(latest.copy(receipts=receipt(uiRequest,false,"STALE_CONTEXT")));return@execute}
            try{
                open(prepareAssets=false)
                val roots=P2OperationCost.section("backup-roots"){checkNotNull(store).backupRoots()}
                publish(latest.copy(roots=roots,backupListingReady=true,receipts=receipt(uiRequest,true)))
            }catch(error:Exception){
                publish(latest.copy(backupListingReady=false,receipts=receipt(uiRequest,false,error.message?:"BACKUP_UNAVAILABLE")))
                android.util.Log.w("BlockcolcP3","Backup listing unavailable; current facts remain available",error)
            }
        }
    }
    override fun refreshWorkspace(uiRequest:String)=enqueue("refresh-workspace",uiRequest){Operation(it.load())}
    fun example() = enqueue("example-import") { c ->
        check(BuildConfig.NATIVE_DIAGNOSTICS)
        require(c.load().domain.json().getJSONArray("projects").length() == 0) { "示例只能载入空的隔离预览" }
        val doc = DomainDocument.parse(context.assets.open("p2-fixture-domain.json").bufferedReader().use { it.readText() })
        val now = System.currentTimeMillis(); c.importBackup(id(), BackupCodec.read(BackupCodec.write(doc, DomainTime.format(now))), now)
    }
    fun export(uri: Uri) {
        if(!uiPending.compareAndSet(false,true))return
        actor.execute {
            publish(latest.copy(busy=true,message=null,backupOperation=BackupOperation.EXPORT))
            try { open();val text = store!!.exportBackup(DomainTime.format(System.currentTimeMillis())); context.contentResolver.openOutputStream(uri, "wt")!!.bufferedWriter(Charsets.UTF_8).use { it.write(text); it.flush() }; publish(latest.copy(busy = false,backupOperation=null, message = "备份已导出")) }
            catch (error: Exception) { publish(latest.copy(busy = false,backupOperation=null, message = "未导出：${error.message}")) }
            finally{uiPending.set(false)}
        }
    }
    fun import(uri: Uri) {
        if(!uiPending.compareAndSet(false,true)){actor.execute{if(pendingImport==null){importIssue=BackupImportIssue.BUSY;publish(latest)}};return}
        actor.execute {
            publish(latest.copy(busy=true,message=null,backupOperation=BackupOperation.READ_IMPORT))
            var capture:NativeBackupImportFile?=null
            try {
                discardPendingImport()
                val staged=context.contentResolver.openInputStream(uri)!!.use{NativeBackupImportFile.capture(java.io.File(context.filesDir,"import-pending"),it)}
                capture=staged
                val backup = staged.read()
                val data=backup.domain.projectionJson()
                val tasks=data.getJSONArray("projects").length();val history=data.getJSONArray("focusHistory").length()
                val summary=if(latest.preferences.language=="en")"$tasks tasks · $history focus records. A rollback is kept before replacement. An old plan will not resume automatically."
                    else"$tasks 个任务 · $history 条专注记录。替换前保留回滚，旧计划不会自动续轮。"
                pendingImport=PendingBackup(backup,staged,summary);capture=null
                publish(latest.copy(busy=false,backupOperation=null))
            }catch(error:Exception){discardPendingImport();rejectedImport(error);publish(latest.copy(busy=false,backupOperation=null,message=null))}
            catch(error:OutOfMemoryError){discardPendingImport();rejectedImport(error);publish(latest.copy(busy=false,backupOperation=null,message=null))}
            finally{discardImportFile(capture);uiPending.set(false)}
        }
    }
    fun confirmImport(confirm:Boolean){
        if(!confirm){actor.execute{discardPendingImport();publish(latest.copy(importSummary=null,backupOperation=null))};return}
        if(!uiPending.compareAndSet(false,true))return
        actor.execute{
            importIssue=null
            publish(latest.copy(busy=true,message=null,backupOperation=BackupOperation.RESTORE_IMPORT))
            var committed=false
            try{
                val candidate=pendingImport?:error("导入预览已失效");val backup=candidate.backup;val captured=candidate.original
                val original=java.io.File(context.filesDir,"import-originals").apply{check(isDirectory||mkdirs())}
                val file=java.io.File(original,captured.sha256+".json")
                if(!file.exists()){
                    val atomic=android.util.AtomicFile(file);val stream=atomic.startWrite()
                    try{captured.copyTo(stream);stream.fd.sync();atomic.finishWrite(stream)}catch(error:Exception){atomic.failWrite(stream);throw error}
                }
                check(captured.matches(file)){"导入原件留存失败，当前记录未替换"}
                val adopted:StoredState
                if (latest.error != null) {
                    // A corrupt DB is never seeded over. Build and validate a new
                    // named database, then atomically switch the private pointer;
                    // the old DB/WAL remain recoverable and old tickets lose identity.
                    val name = "p2-recovered-${id()}.db"; val fresh = AndroidStateDatabase(context, name)
                    try {
                        val store = NativeStateStore(P2MeasuredDatabase(fresh)); store.initialize(backup.domain);val verified=store.load()!!;check(verified.domain==backup.domain)
                        check(prefs.edit().putString("database", name).commit()) { "数据库切换未保存" }
                        committed=true;val prior=db;db=fresh;this.store=store;coordinator=FocusCoordinator(store,name);initialized=true;adopted=verified
                        try{prior?.close()}catch(error:Exception){android.util.Log.w("BlockcolcP3","Recovery committed; previous connection did not close cleanly",error)}
                    } catch (e: Exception) { if(!committed)fresh.close();throw e }
                } else { val c = open();adopted=c.importBackup(id(),backup,System.currentTimeMillis()).state;committed=true;initialized=true }
                discardPendingImport()
                finishSetup()
                // The transaction has completed. Retire the old workspace and
                // its confirmation window before preparing the imported view;
                // old task actions must not remain live against replaced IDs.
                publish(latest.copy(ready=false,importSummary=null,busy=true))
                uiPending.set(false)
                adopt(adopted)
            } catch (error: Exception) {
                if(error is CommittedStateUnavailable)committed=true
                if(committed){discardPendingImport();initialized=true;finishSetup()}else rejectedImport(error)
                publish(latest.copy(ready=if(committed)true else latest.ready,busy=false,backupOperation=null,importSummary=if(committed)null else latest.importSummary,refreshRequired=committed,
                    message=if(committed)null else "未导入，原记录保留：${error.message}"))
            }
            finally{uiPending.set(false)}
        }
    }
    /** A host lease is consumed by the actual stop, independently of session handoff. */
    internal fun cloudCapture(account:String):Future<CloudLocal> = actor.submit<CloudLocal>{
        check(!recordingTest||cloudTesting){"TEST_WORKSPACE"};val c=open(prepareAssets=false);val state=c.load()
        CloudLocal(c.databaseIdentity,state.token,state.domain,state.recovery,clientPreferences.load().value,checkNotNull(store).cloudBaseline(account))
    }
    internal fun cloudPresenceCapture(account:String,knownExecution:Long):Future<Pair<StoredState,Long>?> = actor.submit<Pair<StoredState,Long>?>{
        check(!recordingTest||cloudTesting){"TEST_WORKSPACE"}
        if(!cloudGate.ownsAccountExecution())return@submit null
        val c=open(prepareAssets=false)
        // A fresh claim can change the fence without changing any workspace row.
        val fence=knownExecution.takeIf{it>0}?:checkNotNull(store).cloudBaseline(account)?.execution?.takeIf{it>0}?:return@submit null
        c.load() to fence
    }
    internal fun cloudAcknowledge(expected:CloudLocal,baseline:CloudBaseline):Future<Unit> = actor.submit<Unit>{
        check((!recordingTest||cloudTesting)&&databaseName()==expected.database){"WORKSPACE_CHANGED"}
        check(open(prepareAssets=false).load().token.replacementGeneration==expected.token.replacementGeneration){"WORKSPACE_CHANGED"}
        checkNotNull(store).acknowledgeCloud(baseline);Unit
    }
    internal fun cloudApply(expected:CloudLocal,domain:DomainDocument,recovery:RecoveryContext,preferences:ClientPreferences,baseline:CloudBaseline,replacement:Boolean=false,preserveRollback:Boolean=replacement):Future<Unit> = actor.submit<Unit>{
        check((!recordingTest||cloudTesting)&&databaseName()==expected.database){"WORKSPACE_CHANGED"}
        val c=open(prepareAssets=false);val current=c.load()
        check(current.token==expected.token&&clientPreferences.load().value==expected.preferences){"LOCAL_CHANGED"}
        val acceptedRecovery=recovery.copy(automatic=recovery.automatic.takeIf{preferences.autoContinueFocus},
            returnReminder=recovery.returnReminder.takeIf{preferences.returnToFocusReminders})
        acceptedRecovery.validate(domain,current.token.replacementGeneration)
        if(preferences!=expected.preferences)clientPreferences.update{preferences}
        if(domain==current.domain&&acceptedRecovery==current.recovery){checkNotNull(store).acknowledgeCloud(baseline)
            if(preferences!=expected.preferences)publish(latest.copy(preferences=preferences))
        }else{
            checkNotNull(store).adoptCloud(current.token,"cloud:${id()}",domain,acceptedRecovery,baseline,replacement,preserveRollback)
            val state=c.load();adopt(state)
            if(latest.setupRequired){val root=domain.projectionJson()
                if(root.getJSONArray("projects").length()+root.getJSONArray("habitBuildings").length()>0)finishSetup()}
        }
        Unit
    }
    internal fun cloudPermission(owned:Boolean,bound:Boolean=true):Future<Unit> = actor.submit<Unit>{
        val changed=cloudGate.update(bound,owned)
        if(changed&&latest.ready){val c=open(prepareAssets=false);adopt(c.load())}
        Unit
    }
    fun openSystemSettings(intent:android.content.Intent){
        main.post{
            navigation.begin()
            runCatching{context.startActivity(intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))}
                .onFailure{runCatching{context.startActivity(platform.settingsIntent("battery").addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))}
                    .onFailure{navigation.cancel();android.util.Log.w("BlockcolcP3","Settings activity unavailable",it)}}
        }
    }
    internal fun activityStopped(activity: Activity) {
        if (activity.isChangingConfigurations) return
        // The display can become non-interactive before the keyguard reports
        // that it is showing. Capture both signals at the transition.
        val asleep = activity.getSystemService(PowerManager::class.java)?.isInteractive == false
        val locked = activity.getSystemService(KeyguardManager::class.java)?.isKeyguardLocked == true
        foreground(false, screenLocked = asleep || locked)
    }
    fun foreground(foreground: Boolean, screenLocked: Boolean = false) {
        val reason=if(foreground){navigation.cancel();"app-switch"}else navigation.backgroundReason(screenLocked)
        enqueue(if(foreground)"RecordFocusForegrounded"else"RecordFocusBackgrounded",lockUi=false,prepareRewardsBefore=false){c->
            val now=System.currentTimeMillis()
            val deadline=latest.ticket?.let{DomainTime.millis(it.end)}
            // Visibility bookkeeping cannot award a new reward before the
            // saved phase deadline. Due reconciliation still needs the pool.
            if(latest.refreshRequired||deadline==null||now>=deadline)prepareRewards(c)
            c.observeLifecycle(foreground,reason,now){id()}
        }
        actor.execute{dailyBackups.foreground(foreground);scheduleDaily()}
    }
    private fun trace(name: String, begin: Long, state: StoredState, replay: Boolean) {
        android.util.Log.i("BlockcolcP2", JSONObject().put("operation", name).put("durationMs", (SystemClock.elapsedRealtimeNanos() - begin) / 1e6).put("revision", state.token.revision).put("generation", state.token.replacementGeneration).put("replayed", replay).toString())
    }
    /** Test APK callers use this same actor and real Android DB, never another writer. */
    internal fun testOperation(block:(FocusCoordinator)->Operation):java.util.concurrent.Future<Operation> {
        return testMeasuredOperation(null,block)
    }
    internal fun testMeasuredOperation(cost:P2OperationCost?,block:(FocusCoordinator)->Operation):java.util.concurrent.Future<Operation> {
        check(BuildConfig.NATIVE_DIAGNOSTICS)
        return actor.submit<Operation>{ P2OperationCost.collect(cost) {
            cost?.mark("actorStartedNs")
            val result=P2OperationCost.section("coordinator") { block(open(forceDailyPool=true)) };cost?.mark("coordinatorReturnedNs");initialized=true
            committedEvents(result);P2OperationCost.section("host-adoption") { adopt(result.state,events=result.events+result.signals) };cost?.mark("adoptedNs")
            P2OperationCost.section("test-journal") { record(result) };cost?.mark("actorFinishedNs")
            result
        } }
    }
    internal fun testRead():java.util.concurrent.Future<StoredState>{check(BuildConfig.NATIVE_DIAGNOSTICS);return actor.submit<StoredState>{open(prepareAssets=false).load()}}
    internal fun testReproject():Future<Unit>{check(BuildConfig.NATIVE_DIAGNOSTICS);return actor.submit<Unit>{adopt(open(prepareAssets=false).load());Unit}}
    internal fun testCloud(begin:Boolean):Future<Unit>{check(BuildConfig.NATIVE_DIAGNOSTICS);return actor.submit<Unit>{
        check(recordingTest);cloudTesting=begin;cloudGate=if(begin)CloudExecutionGate(context,"cloud-execution-isolated")else deviceCloudGate;Unit
    }}
    internal fun testClientPreferences(begin:Boolean):java.util.concurrent.Future<Unit>{
        check(BuildConfig.NATIVE_DIAGNOSTICS)
        return actor.submit<Unit>{
            if(begin){
                check(testPreferences==null);check(recordingTest){"Preferences may only be isolated after the test DB is selected"}
                val directory=java.io.File(context.filesDir,"p3-ui-${id()}");check(directory.mkdir())
                testPreferences=clientPreferences to directory;clientPreferences=PreferencesController(AndroidPreferencesStorage(context,directory))
            }else{
                val prior=checkNotNull(testPreferences);clientPreferences=prior.first
                check(prior.second.parentFile==context.filesDir&&prior.second.name.startsWith("p3-ui-"));check(prior.second.deleteRecursively());testPreferences=null
            }
            val saved=clientPreferences.load();publish(latest.copy(preferences=saved.value,preferencesReadFailed=saved.readFailed))
        }
    }
    internal fun testRecording(clear:Boolean=false):java.util.concurrent.Future<String>{check(BuildConfig.NATIVE_DIAGNOSTICS);return actor.submit<String>{
        if(clear){while(testJournal.length()>0)testJournal.remove(testJournal.length()-1);recordingTest=true};testJournal.toString()
    }}
    private fun isolatePresentation(database:String){
        if(realPresentation!=null)return
        realPresentation=PresentationContext(celebrations,achievementReceipts,achievementAttention,uiPrefs,setupFinishedInProcess)
        val directory=java.io.File(context.filesDir,"presentation-$database");check(directory.isDirectory||directory.mkdir())
        celebrations=NativeCelebrations();achievementReceipts=AchievementReceipts(AndroidAchievementReceiptStorage(directory));achievementAttention=AchievementAttention(AndroidAchievementReceiptStorage.attention(directory))
        uiPrefs=context.getSharedPreferences("native-ui-$database",Context.MODE_PRIVATE);setupFinishedInProcess=false
    }
    private fun restorePresentation(){
        realPresentation?.let{celebrations=it.celebrations;achievementReceipts=it.receipts;achievementAttention=it.attention;uiPrefs=it.firstUse;setupFinishedInProcess=it.setupFinished;realPresentation=null}
    }
    internal fun testFirstUse(setup:Boolean,tutorial:Boolean):java.util.concurrent.Future<Unit>{check(BuildConfig.NATIVE_DIAGNOSTICS);return actor.submit<Unit>{
        check(recordingTest&&realPresentation!=null);check(uiPrefs!==realPresentation!!.firstUse)
        check(uiPrefs.edit().putBoolean("setupRequired",setup).putBoolean("tutorialPending",tutorial).commit())
        setupFinishedInProcess=false;adopt(open(prepareAssets=false).load())
    }}
    internal fun testDatabase(begin:Boolean,prepareAssets:Boolean=begin,beforeSwitch:()->Unit={}):java.util.concurrent.Future<String> {
        check(BuildConfig.NATIVE_DIAGNOSTICS)
        return actor.submit<String>{
            if(begin)check(pendingImport==null){"Cancel the pending import before test isolation"}else discardPendingImport()
            // A queued upgrade/boot receiver may finish before isolation. The
            // test's byte snapshot belongs to this actor boundary, rather than
            // racing that legitimate startup from the instrumentation thread.
            beforeSwitch()
            navigation.cancel()
            pendingWorkspace?.future?.cancel(false);pendingWorkspace=null
            recordingTest=false;future?.cancel(false);dailyFuture?.cancel(false);platform.update(null,PreviewSnapshot());db?.close();db=null;store=null;coordinator=null;initialized=false
            val current=prefs.getString("database","p2-state.db")!!
            val next=if(begin){
                require(prefs.getString("beforeTest",null)==null){"Previous P2 test storage must be restored first"}
                val name="p2-device-${id()}.db";check(prefs.edit().putString("beforeTest",current).putString("database",name).commit());name
            }else{
                val original=prefs.getString("beforeTest",null)?:throw IllegalStateException("No test database to restore")
                check(prefs.edit().putString("database",original).remove("beforeTest").commit());original
            }
            val c=open(prepareAssets,forceDailyPool=begin&&prepareAssets);initialized=true
            if(!begin)restorePresentation()
            // Returning from an isolated test is a read-only restoration of the
            // real presentation context, not the user's first feature visit.
            adopt(c.load(),observePresentation=begin);next
        }
    }
    companion object {
        @android.annotation.SuppressLint("StaticFieldLeak") // Only applicationContext is retained, never an Activity.
        @Volatile private var instance: PreviewRuntime? = null
        fun get(context: Context): PreviewRuntime = instance ?: synchronized(this) { instance ?: PreviewRuntime(context.applicationContext).also { instance = it } }
    }
}
