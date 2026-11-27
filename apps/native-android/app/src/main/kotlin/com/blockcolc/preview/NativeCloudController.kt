package com.blockcolc.preview

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import com.blockcolc.cloud.*
import com.blockcolc.domain.StrictJson
import com.blockcolc.focus.FocusFailure
import com.blockcolc.presentation.ClientPreferences
import com.blockcolc.storage.*
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.SocketTimeoutException
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import javax.net.ssl.SSLException

internal enum class CloudAction { SYNC, USE_CLOUD, REPLACE_CLOUD, TAKEOVER, BACKUP, RESTORE, REVOKE_DEVICE }
internal enum class CloudResult { WORKING, COMPLETE, NEEDS_CHOICE, RETRY_PENDING, FAILED }
internal data class CloudReceipt(val action:CloudAction,val result:CloudResult,val error:String?=null)

internal data class CloudView(val ready:Boolean=false,val requestBusy:Boolean=false,val account:JSONObject?=null,val error:String?=null,
    val choiceRequired:Boolean=false,val conflicts:List<String> = emptyList(),val owner:String?=null,val owned:Boolean=false,
    val devices:List<JSONObject> = emptyList(),val friends:List<JSONObject> = emptyList(),val backup:JSONObject?=null,val lastSync:Long?=null,
    val accountPending:Boolean=false,val receipt:CloudReceipt?=null,val friendsError:String?=null,
    val friendOrder:List<String> = emptyList(),val syncRetry:CloudSyncRetry = CloudSyncRetry()){
    val busy get()=requestBusy||receipt?.result==CloudResult.WORKING
    val syncIssue get()=syncRetry.visibleError
    fun working(action:CloudAction)=receipt?.action==action&&receipt.result==CloudResult.WORKING
}

/** State changes upload through one lane. Foreground polls read just the
 * package heads until either side changes its committed facts. */
internal class NativeCloudController private constructor(private val context:Context,private val runtime:PreviewRuntime,
    private val transport:CloudTransport=CloudTransport(context),private val directory:File=context.noBackupFilesDir,preferenceName:String="cloud-device"){
    private val isolatedTransport=preferenceName!="cloud-device"
    private val main=Handler(Looper.getMainLooper())
    private val worker=Executors.newSingleThreadScheduledExecutor{Thread(it,"blockcolc-cloud-io")}
    private val friendsWorker=Executors.newSingleThreadExecutor{Thread(it,"blockcolc-cloud-friends")}
    private val friendsQueued=AtomicBoolean()
    private val storage=CloudSessionStorage(context,directory)
    private val prefs by lazy{context.getSharedPreferences(preferenceName,Context.MODE_PRIVATE)}
    private val accountOutbox by lazy{AccountPreferenceOutbox({prefs.getString("pending-account-preferences",null)},{wire->
        prefs.edit().apply{if(wire==null)remove("pending-account-preferences")else putString("pending-account-preferences",wire)}.apply()
    })}
    private val resourceChoices by lazy{CloudResourceChoices(context,if(preferenceName=="cloud-device")"cloud-resource-choice"else"cloud-resource-choice-isolated")}
    private val device by lazy{prefs.getString("id",null)?:UUID.randomUUID().toString().also{check(prefs.edit().putString("id",it).commit())}}
    private val listeners=CopyOnWriteArrayList<(CloudView)->Unit>()
    private val viewGate=Any()
    @Volatile private var value=CloudView()
    @Volatile private var session:CloudSession?=null
    @Volatile private var execution=0L
    @Volatile private var started=false
    @Volatile private var foreground=false
    private data class ServerClock(val time:Long,val observedAt:Long)
    @Volatile private var serverClock:ServerClock?=null
    private val bootCount by lazy{runCatching{Settings.Global.getInt(context.contentResolver,"boot_count",-1)}.getOrDefault(-1)}
    private var persistedClockAt=-1L
    private val localChanges=AtomicLong()
    private var acknowledgedChanges=-1L
    private val focusUploadGate = Any()
    private var focusUpload = 0L
    private var attemptedFocusUpload = 0L
    private var acknowledgedFocusUpload = 0L
    private var remoteHead:JSONObject?=null
    private var focusEditable=false
    private var delayed:ScheduledFuture<*>?=null
    private var scheduledPoll:ScheduledFuture<*>?=null
    private val assets=File(directory,"cloud-assets")
    fun snapshot()=value
    fun subscribe(listener:(CloudView)->Unit):()->Unit{listeners.add(listener);listener(value);return{listeners.remove(listener)}}
    private fun publish(update:(CloudView)->CloudView){
        synchronized(viewGate){
            val next=update(value)
            val account=next.account?.let(accountOutbox::overlay)
            val accountId=account?.optString("id")
            val order=when{
                accountId==null->emptyList()
                accountId==value.account?.optString("id")->next.friendOrder
                else->readFriendOrder(accountId)
            }
            value=next.copy(account=account,accountPending=account?.optString("id")?.let{accountOutbox.pending(it)!=null}?:false,
                friends=if(account?.optBoolean("friendsEnabled")==false)emptyList()else next.friends,friendOrder=order)
        }
        // A queued server reply must not repaint over a newer local choice.
        notifyView()
    }
    private fun notifyView(){
        main.post{val current=value;listeners.forEach{it(current)}}
    }
    private fun readFriendOrder(account:String):List<String> = runCatching{
        val stored=JSONArray(prefs.getString("friends-order/$account","[]"))
        List(stored.length()){stored.getString(it)}
    }.getOrDefault(emptyList())
    fun saveFriendOrder(account:String,ids:List<String>){
        if(session?.account!=account)return
        val accepted=value.friends.filter{it.optString("status")=="accepted"}.map{it.getString("id")}.toSet()
        val ordered=ids.distinct().filter{it in accepted}
        prefs.edit().putString("friends-order/$account",JSONArray(ordered).toString()).apply()
        publish{if(it.account?.optString("id")==account)it.copy(friendOrder=ordered)else it}
    }
    @Synchronized fun start(syncOnOpen: Boolean = true) {
        if (started || !runtime.cloudIoAllowed(isolatedTransport)) return
        started = true
        worker.execute {
            try {
                session = storage.read()
                if(session!=null)loadServerClock()
                if (session == null) runtime.cloudPermission(owned = true, bound = false).get()
                publish { current ->
                    current.copy(ready = true, account = session?.let { login ->
                        JSONObject().put("id", login.account).put("username", login.username)
                    })
                }
                if (session != null && syncOnOpen) perform(synchronizing = true) { sync() }
            } catch (error: Exception) {
                failure(error, synchronizing = true)
            }
        }
    }

    @Synchronized fun changed() {
        if (!started || session == null) return
        localChanges.incrementAndGet()
        delayed?.cancel(false)
        delayed = worker.schedule({
            val newFocusTransition = synchronized(focusUploadGate) { focusUpload != attemptedFocusUpload }
            if (localChanges.get() != acknowledgedChanges && (value.syncRetry.failures == 0 || newFocusTransition))
                perform(false, synchronizing = true) { sync(header = remoteHead, profile = false) }
        }, 150, TimeUnit.MILLISECONDS)
    }

    internal fun focusChanged() {
        synchronized(focusUploadGate) {
            focusUpload++
            CloudFocusSyncJob.enqueue(context)
        }
        start()
        changed()
    }

    internal fun flushPendingFocus(done: (Boolean) -> Unit) {
        start(syncOnOpen = false)
        worker.execute {
            var complete = session == null
            if (!complete) perform(false, synchronizing = true) {
                sync(profile = false)
                complete = synchronized(focusUploadGate) { focusUpload == acknowledgedFocusUpload }
            }
            val retry = !complete && value.error != "UNAUTHORIZED"
            main.post { done(retry) }
        }
    }

    fun foreground(active: Boolean) {
        val previous = foreground
        foreground = active
        if (active == previous || !started) return
        worker.execute {
            if (!foreground) scheduleNextPoll()
            else if (session != null && scheduledPoll == null && !value.working(CloudAction.SYNC))
                perform(false, synchronizing = true) { poll() }
        }
    }

    // Worker-owned so the countdown and the actual retry use the same deadline.
    private fun scheduleNextPoll() {
        scheduledPoll?.cancel(false)
        scheduledPoll = null
        val due = if (foreground && session != null && !worker.isShutdown) SystemClock.elapsedRealtime() + CLOUD_SYNC_INTERVAL_MS else null
        if (due != null) scheduledPoll = worker.schedule({
            scheduledPoll = null
            if (foreground && session != null && !value.working(CloudAction.SYNC))
                perform(false, synchronizing = true) { poll() }
        }, (due - SystemClock.elapsedRealtime()).coerceAtLeast(0L), TimeUnit.MILLISECONDS)
        if (value.syncRetry.failures > 0) publish { current ->
            current.copy(syncRetry = current.syncRetry.copy(nextAt = due, inFlight = false))
        }
    }

    fun focusNow(): Long? = serverClock?.takeIf { session != null }
        ?.let { it.time + SystemClock.elapsedRealtime() - it.observedAt }

    private fun fetchHead(): JSONObject {
        val sent = SystemClock.elapsedRealtime()
        val state = api("sync/head", timeoutMillis = 8000)
        val reference = ServerClock(state.getLong("serverTime"), (sent + SystemClock.elapsedRealtime()) / 2)
        serverClock = reference
        if(bootCount>=0&&(persistedClockAt<0||reference.observedAt-persistedClockAt>=300_000)){
            prefs.edit().putInt("clock-boot",bootCount).putLong("clock-server",reference.time)
                .putLong("clock-monotonic",reference.observedAt).apply()
            persistedClockAt=reference.observedAt
        }
        return state
    }

    private fun loadServerClock(){
        if(bootCount<0||prefs.getInt("clock-boot",-1)!=bootCount)return
        val observed=prefs.getLong("clock-monotonic",-1)
        val time=prefs.getLong("clock-server",-1)
        if(observed in 0..SystemClock.elapsedRealtime()&&time>0){serverClock=ServerClock(time,observed);persistedClockAt=observed}
    }

    private fun poll() {
        val head = fetchHead()
        val known = remoteHead
        val same = known != null && known.optString("epoch") == head.optString("epoch") &&
            known.optLong("revision") == head.optLong("revision") &&
            packageHeads(known) == packageHeads(head) &&
            known.getJSONObject("execution").optLong("generation") == head.getJSONObject("execution").optLong("generation")&&
            known.optBoolean("focusLocked")==head.optBoolean("focusLocked")
        if (same && localChanges.get() == acknowledgedChanges) {
            remoteHead = head
            if (value.syncRetry.failures > 0) publish { current ->
                current.copy(syncRetry = CloudSyncRetry(), lastSync = System.currentTimeMillis(),
                    error = current.error.takeUnless { it == current.syncRetry.lastError })
            }
        } else sync(header = head, profile = false)
    }
    private fun api(path:String,method:String="GET",body:JSONObject?=null,timeoutMillis:Long?=null):JSONObject{
        check(runtime.cloudIoAllowed(isolatedTransport)){"TEST_WORKSPACE"}
        val wire=body?.let(StrictJson::render)
        return if(timeoutMillis==null)transport.request("/v1/"+path,method,session?.token,wire)
            else transport.request("/v1/"+path,method,session?.token,wire,timeoutMillis)
    }
    internal fun reserveNativeFocus(request: String): Boolean {
        val login = session ?: return false
        val generation = execution
        if (generation <= 0 || !runtime.cloudIoAllowed(isolatedTransport)) return false
        val body = JSONObject().put("generation", generation).put("request", request)
        try {
            transport.request("/v1/execution/focus/start", "POST", login.token, StrictJson.render(body), timeoutMillis = 2200)
            return session === login
        } catch (failure: CloudFailure) {
            when (failure.code) {
                "NOT_FOUND", "HTTP_404", "REQUEST_TIMEOUT" -> return false
                "UNAUTHORIZED", "EXECUTION_CHANGED" -> throw FocusFailure("CLOUD_VIEW_ONLY")
                else -> throw FocusFailure(failure.code)
            }
        } catch (_: IOException) {
            // Offline intervals are still checked when the device reconnects.
            return false
        }
    }
    internal fun cancelNativeReservation(request: String) {
        val login = session ?: return
        worker.execute {
            if (session === login) runCatching {
                transport.request("/v1/execution/focus/cancel", "POST", login.token,
                    StrictJson.render(JSONObject().put("request", request)), timeoutMillis = 2200)
            }
        }
    }
    private fun errorCode(error:Throwable):String{
        val causes=generateSequence(error){it.cause}.toList()
        return causes.filterIsInstance<CloudFailure>().firstOrNull()?.code?:when{
            causes.any{it is SocketTimeoutException}->"REQUEST_TIMEOUT"
            causes.any{it is SSLException}->"TLS_UNAVAILABLE"
            causes.any{it is OutOfMemoryError}->"CLOUD_DEVICE_MEMORY_LIMIT"
            else->causes.last().message?.takeIf{it in setOf("LOCAL_CHANGED","WORKSPACE_CHANGED","TEST_WORKSPACE","CLOUD_ASSET_DIGEST","CLOUD_RESPONSE_TOO_LARGE")}
                ?:"NETWORK_UNAVAILABLE"
        }
    }
    private fun failure(error:Throwable,action:CloudAction?=null,synchronizing:Boolean=action==CloudAction.SYNC){
        val code=errorCode(error)
        val cloud=generateSequence(error){it.cause}.filterIsInstance<CloudFailure>().firstOrNull()
        android.util.Log.w("BlockcolcCloud","Request failed: "+error.javaClass.simpleName)
        val revoked=code=="UNAUTHORIZED"
        if(revoked)runCatching{runtime.cloudPermission(false).get()}
        val keys=cloud?.details?.optJSONArray("keys")?.let{a->List(a.length()){a.optString(it)}.filter(String::isNotEmpty)}.orEmpty()
        val choice=action in setOf(CloudAction.REPLACE_CLOUD,CloudAction.RESTORE)&&code in setOf("EXECUTION_CHANGED","SYNC_CONFLICT","WORKSPACE_REPLACED")
        publish{current->
            val result=when{choice->CloudResult.NEEDS_CHOICE;code=="LOCAL_CHANGED"->CloudResult.RETRY_PENDING;else->CloudResult.FAILED}
            current.copy(ready=true,requestBusy=false,owned=if(revoked)false else current.owned,error=code,
                conflicts=if(choice)keys else current.conflicts,choiceRequired=current.choiceRequired||choice,
                receipt=action?.let{CloudReceipt(it,result,code)}?:current.receipt,
                syncRetry=if(synchronizing&&session!=null&&code!="LOCAL_CHANGED")current.syncRetry.failed(code) else current.syncRetry)
        }
    }
    private fun perform(showBusy:Boolean=true,synchronizing:Boolean=false,work:()->Unit){
        if(!runtime.cloudIoAllowed(isolatedTransport)){
            if(synchronizing)scheduleNextPoll()
            return
        }
        if(showBusy)publish{it.copy(requestBusy=true,error=null)}
        if(synchronizing&&value.syncRetry.failures>0)publish{it.copy(syncRetry=it.syncRetry.copy(nextAt=null,inFlight=true))}
        try {
            work()
        }catch(error:Exception){failure(error,synchronizing=synchronizing)}
        catch(error:OutOfMemoryError){failure(error,synchronizing=synchronizing)}
        finally{
            if(showBusy)publish{it.copy(requestBusy=false)}
            if(synchronizing)scheduleNextPoll()
        }
    }
    private fun runAction(action:CloudAction,work:()->CloudResult){
        synchronized(viewGate){
            if(value.busy||action==CloudAction.SYNC&&value.syncRetry.inFlight)return
            value=value.copy(receipt=CloudReceipt(action,CloudResult.WORKING),error=null)
        }
        notifyView()
        worker.execute{
            try{
                if(!runtime.cloudIoAllowed(isolatedTransport))throw CloudFailure("TEST_WORKSPACE")
                if(session==null)throw CloudFailure("UNAUTHORIZED")
                publish{it.copy(error=null)}
                val result=work()
                publish{it.copy(receipt=CloudReceipt(action,result,it.error))}
            }catch(error:Exception){
                failure(error,action)
                if(value.receipt?.result==CloudResult.RETRY_PENDING)changed()
            }
            catch(error:OutOfMemoryError){failure(error,action)}
            finally { if(action==CloudAction.SYNC)scheduleNextPoll() }
        }
    }
    fun login(username:String,password:String,register:Boolean)=worker.execute{perform(synchronizing=true){
        val input=JSONObject().put("username",username.trim()).put("password",password).put("deviceId",device).put("deviceName",Build.MODEL.take(64))
        if(register)input.put("name",username.trim()).put("timeZone",java.util.TimeZone.getDefault().id)
        val response=transport.request(if(register)"/v1/register"else"/v1/login","POST",body=StrictJson.render(input))
        val account=response.getJSONObject("account");val saved=CloudSession(response.getString("token"),account.getString("id"),account.getString("username"),device)
        // Persist the fence before a logged-in UI or receiver can proceed.
        val previous=session;val previousOwned=value.owned
        try{runtime.cloudPermission(owned=false).get();storage.write(saved);resetSyncState();session=saved}
        catch(error:Exception){runCatching{storage.write(previous)};runtime.cloudPermission(previousOwned,bound=previous!=null).get();throw CloudFailure("LOCAL_CREDENTIALS_UNAVAILABLE")}
        publish{CloudView(ready=true,requestBusy=true,account=account)};sync()
    }}
    fun logout()=worker.execute{perform{
        runCatching{session?.account?.takeIf{accountOutbox.pending(it)!=null}?.let{refreshAccount()}}
        if(session!=null)try{api("logout","POST",JSONObject())}catch(error:CloudFailure){
            if(error.code!="UNAUTHORIZED")throw error
        }
        storage.write(null);session=null;resetSyncState()
        runtime.cloudPermission(owned=true,bound=false).get();publish{CloudView(ready=true)}
    }}
    private fun resetSyncState(){execution=0;remoteHead=null;serverClock=null;acknowledgedChanges=-1L;remotePlanHint=null;focusEditable=false
        scheduledPoll?.cancel(false);scheduledPoll=null
        synchronized(focusUploadGate) {
            attemptedFocusUpload = focusUpload
            acknowledgedFocusUpload = focusUpload
            if (!isolatedTransport) CloudFocusSyncJob.cancel(context)
        }
    }
    fun refresh(){
        publish{it.copy(syncRetry=it.syncRetry.copy(ignored=false))}
        runAction(CloudAction.SYNC){sync()}
    }
    fun ignoreSyncIssue(){publish{it.copy(syncRetry=it.syncRetry.copy(ignored=true))}}
    fun choose(strategy:String){
        val action=when(strategy){"cloud"->CloudAction.USE_CLOUD;"local"->CloudAction.REPLACE_CLOUD;else->error("Unknown sync strategy")}
        runAction(action){sync(strategy)}
    }
    private var remotePlanHint:String?=null
    private fun adoptHead(remote:JSONObject){
        val control=remote.getJSONObject("execution")
        val owner=control.opt("owner") as? String
        val owned=owner==session?.device
        val editable=owned
        if(remoteHead==null||editable!=focusEditable||control.getLong("generation")!=execution)runtime.cloudPermission(editable).get()
        focusEditable=editable
        execution=control.getLong("generation")
        publish{it.copy(owner=owner,owned=owned,backup=remote.optJSONObject("backup"))}
    }
    fun takeover()=runAction(CloudAction.TAKEOVER){
        val head=fetchHead();adoptHead(head)
        val claim=api("execution/claim","POST",JSONObject().put("generation",execution).put("takeover",true));execution=claim.getLong("generation")
        runtime.cloudPermission(true).get();publish{it.copy(owned=true,owner=device,choiceRequired=false,conflicts=emptyList())}
        sync("cloud",takeover=true)
    }
    private fun localEntries(local:CloudLocal):CloudWorkspace {
        val facts=CloudWorkspace.split(local.domain);val recovery=JSONObject(local.recovery.canonical())
        val plan=JSONObject().put("plan",recovery.get("plan")).put("automaticEnabled",local.recovery.automatic!=null)
        val planWire=if(!focusEditable)remotePlanHint?:StrictJson.render(plan)else StrictJson.render(plan)
        val preferences=JSONObject(local.preferences.canonical());resourceChoices.read()?.let{preferences.put("resourceSelection",it)}
        // Keep the preview usable with older versions of the cloud service.
        if(local.preferences.lightingQuality=="paper")preferences.put("lightingQuality","performance")
        return facts.copy(entries=facts.entries+("@preferences" to StrictJson.render(preferences))+("@plan" to planWire))
    }
    private fun downloadAsset(key:String):String {
        require(key.matches(Regex("[a-f0-9]{64}")));check(assets.isDirectory||assets.mkdirs());val file=File(assets,key)
        if(file.isFile){val text=file.readText();if(StrictJson.sha(text)==key)return text;file.delete()}
        val text=transport.text("/v1/assets/$key",token=checkNotNull(session).token);check(StrictJson.sha(text)==key){"CLOUD_ASSET_DIGEST"}
        val target=android.util.AtomicFile(file);val stream=target.startWrite();try{stream.writer(Charsets.UTF_8).apply{write(text);flush()};target.finishWrite(stream)}catch(error:Exception){target.failWrite(stream);throw error};return text
    }
    private fun uploadAssets(values:Map<String,String>){
        for(chunk in values.keys.chunked(512)){
            val missing=api("assets/status","POST",JSONObject().put("keys",JSONArray(chunk))).getJSONArray("missing")
            for(i in 0 until missing.length()){val key=missing.getString(i);transport.request("/v1/assets/$key","PUT",checkNotNull(session).token,values.getValue(key))}
        }
    }
    private fun packageHeads(state: JSONObject) = CloudPackageHead.readAll(state.getJSONObject("packages"))

    private fun requiredAssets(changes: List<JSONObject>): Set<String> = changes.mapNotNull { change ->
        val slot = when (change.getString("key").substringBefore('/')) {
            "projects", "habitBuildings" -> "importedBlueprint"
            "buildingBlueprintResources", "decorationBlueprintResources" -> "blueprint"
            else -> null
        }
        if (slot == null || change.isNull("canonical")) null else
            JSONObject(change.getString("canonical")).optJSONObject("value")
                ?.optJSONObject(slot)?.optString("\$asset")?.takeIf { it.isNotEmpty() }
    }.toSet()

    private fun applyEntries(target: MutableMap<String, String>, updates: JSONObject) {
        for (key in updates.keys()) {
            if (updates.isNull(key)) target.remove(key) else target[key] = updates.getString(key)
        }
    }
    private fun applyDelta(target: MutableMap<String, String>, received: JSONObject) {
        val delta = received.optJSONObject("delta") ?: return
        for (name in delta.keys()) {
            val update = delta.getJSONObject(name)
            if (update.getBoolean("snapshot")) target.keys.removeAll { CloudWorkspace.packageOf(it) == name }
            applyEntries(target, update.getJSONObject("entries"))
        }
    }

    private fun sync(
        strategy: String? = null, takeover: Boolean = false, header: JSONObject? = null, profile: Boolean = true,
    ): CloudResult {
        val login = session ?: throw CloudFailure("UNAUTHORIZED")
        val dirtyAtStart = localChanges.get()
        val focusAtStart = synchronized(focusUploadGate) { focusUpload }
        attemptedFocusUpload = focusAtStart
        val account = if (profile || value.account?.has("friendsEnabled") != true) refreshAccount() else value.account
        if (profile) {
            val devices = api("devices", timeoutMillis = 8000).getJSONArray("devices")
            publish { it.copy(devices = List(devices.length()) { index -> devices.getJSONObject(index) }) }
        }
        var status = header ?: fetchHead()
        adoptHead(status)
        if (status.optBoolean("claimable")) {
            api("execution/claim", "POST", JSONObject().put("generation", execution))
            status = fetchHead()
            adoptHead(status)
        }
        val local = runtime.cloudCapture(login.account).get()
        val encoded = localEntries(local)
        val previous = local.baseline
        val epoch = status.getString("epoch")
        val reset = previous != null && previous.epoch != epoch
        val knownEpoch = previous?.epoch
        val known = JSONObject(previous?.packages.orEmpty().mapValues { it.value.json() })
        val incoming = encoded.entries.toMutableMap()
        val changes = if (strategy == "cloud" || reset) emptyList() else
            CloudWorkspace.changes(encoded.entries, previous?.hashes.orEmpty())
        var preserveLocal = reset || strategy == "cloud"
        var remote: JSONObject
        if (strategy == "local" && status.getLong("revision") != 0L) {
            if (!value.owned) throw CloudFailure("EXECUTION_CHANGED")
            uploadAssets(encoded.assets)
            api("workspace/replace", "POST", JSONObject().put("revision", status.getLong("revision"))
                .put("execution", execution).put("entries", JSONObject(encoded.entries)).put("requestId", UUID.randomUUID().toString()))
            remote = api("sync/pull", "POST", JSONObject().put("known", JSONObject()))
        } else if (changes.isNotEmpty()) {
            val wantedAssets = requiredAssets(changes)
            uploadAssets(encoded.assets.filterKeys { it in wantedAssets })
            val request = JSONObject().put("epoch", epoch).put("execution", execution)
                .put("knownEpoch", knownEpoch ?: JSONObject.NULL).put("known", known).put("changes", JSONArray(changes))
            request.put("requestId", StrictJson.sha(StrictJson.render(request)))
            val receipt = api("sync/commit", "POST", request)
            val winners = receipt.getJSONObject("winners")
            preserveLocal = preserveLocal || winners.length() > 0
            applyEntries(incoming, winners)
            remote = receipt.getJSONObject("state")
        } else {
            remote = if (!reset && strategy != "cloud" && previous?.packages == packageHeads(status)) status else
                api("sync/pull", "POST", JSONObject().put("epoch", if (strategy == "cloud") JSONObject.NULL else knownEpoch ?: JSONObject.NULL)
                    .put("known", known))
        }
        applyDelta(incoming, remote)
        var hashes = incoming.mapValues { StrictJson.sha(it.value) }
        if (!CloudWorkspace.matchesPackages(hashes, packageHeads(remote))) {
            remote = api("sync/pull", "POST", JSONObject().put("known", JSONObject()))
            incoming.clear()
            applyDelta(incoming, remote)
            hashes = incoming.mapValues { StrictJson.sha(it.value) }
            if (!CloudWorkspace.matchesPackages(hashes, packageHeads(remote))) throw CloudFailure("CLOUD_PACKAGE_DIGEST")
            preserveLocal = true
        }
        if (incoming.isEmpty()) throw CloudFailure("CLOUD_EMPTY")

        adoptHead(remote)
        remotePlanHint = incoming["@plan"]
        val baseline = CloudBaseline(login.account, remote.getString("epoch"), remote.getLong("revision"),
            hashes, execution, packageHeads(remote))
        if (incoming != encoded.entries || takeover) {
            val document = CloudWorkspace.join(incoming, ::downloadAsset)
            var recovery = CloudWorkspace.recovery(incoming, document)
            if (value.owned) {
                val old = local.recovery.automatic?.takeIf { local.recovery.plan == recovery.plan }
                val grant = old ?: if (takeover && local.preferences.autoContinueFocus &&
                    JSONObject(incoming["@plan"] ?: "{}").optBoolean("automaticEnabled") && recovery.plan != null)
                    ContinuationGrant(UUID.randomUUID().toString(), local.token.replacementGeneration, recovery.plan!!.completedSessionIds.lastOrNull())
                else null
                recovery = recovery.copy(automatic = grant, returnReminder = local.recovery.returnReminder.takeIf { recovery.plan == local.recovery.plan })
            }
            val synced = incoming["@preferences"]?.let(ClientPreferences::parseText) ?: local.preferences
            val preferences = if (local.preferences.lightingQuality == "paper" && synced.lightingQuality == "performance")
                synced.copy(lightingQuality = "paper") else synced
            val replaced = previous != null && previous.epoch != baseline.epoch
            runtime.cloudApply(local, document, recovery, preferences, baseline, replacement = replaced,
                preserveRollback = preserveLocal || replaced).get()
            incoming["@preferences"]?.let(::JSONObject)?.optJSONObject("resourceSelection")?.let { selection ->
                resourceChoices.save(selection.opt("activeId") as? String, selection.opt("baseId") as? String)
                com.blockcolc.preview.resources.NativeResourceController.get(context).cloudSelection(selection.opt("activeId") as? String,
                    selection.opt("baseId") as? String)
            }
        } else if (previous != baseline) runtime.cloudAcknowledge(local, baseline).get()

        remote.remove("delta")
        remoteHead = remote
        acknowledgedChanges = dirtyAtStart
        synchronized(focusUploadGate) {
            acknowledgedFocusUpload = focusAtStart
            if (!isolatedTransport && focusUpload == focusAtStart) CloudFocusSyncJob.cancel(context)
        }
        publish { current ->
            current.copy(choiceRequired = false, conflicts = emptyList(), error = null,
                lastSync = System.currentTimeMillis(), syncRetry = CloudSyncRetry(),
                receipt = current.receipt?.let {
                    if (it.result == CloudResult.RETRY_PENDING) CloudReceipt(it.action, CloudResult.COMPLETE) else it
                })
        }
        if (profile && account?.optBoolean("friendsEnabled") == true) refreshFriends()
        return CloudResult.COMPLETE
    }
    private fun loadFriends(login:CloudSession){
        if(value.account?.optBoolean("friendsEnabled")!=true){publish{it.copy(friends=emptyList(),friendsError=null)};return}
        val rows=transport.request("/v1/friends/summary","GET",login.token,null,timeoutMillis=8000).getJSONArray("friends")
        publish{current->
            if(session!==login)current else current.copy(friends=List(rows.length()){index->rows.getJSONObject(index)},friendsError=null)
        }
    }
    fun refreshFriends(){
        val login=session?:return
        if(!friendsQueued.compareAndSet(false,true))return
        friendsWorker.execute{
            try{if(session===login&&runtime.cloudIoAllowed(isolatedTransport))loadFriends(login)}
            catch(error:Exception){publish{if(session===login)it.copy(friendsError=errorCode(error))else it}}
            finally{friendsQueued.set(false)}
        }
    }
    private fun refreshChangedFriends(){
        val login=session?:return
        friendsWorker.execute{
            if(session===login&&runtime.cloudIoAllowed(isolatedTransport)){
                try{loadFriends(login)}catch(error:Exception){
                    publish{if(session===login)it.copy(friendsError=errorCode(error))else it}
                }
            }
        }
    }
    suspend fun friendHistory(account:String,friend:String):JSONObject=suspendCancellableCoroutine{continuation->
        val request=friendsWorker.submit{
            if(continuation.isActive)continuation.resumeWith(runCatching{
                val login=session?.takeIf{it.account==account&&runtime.cloudIoAllowed(isolatedTransport)}?:throw CloudFailure("UNAUTHORIZED")
                val result=transport.request("/v1/friends/history/$friend","GET",login.token,null,timeoutMillis=15000)
                if(session!==login)throw CloudFailure("UNAUTHORIZED")
                result
            })
        }
        continuation.invokeOnCancellation{request.cancel(false)}
    }
    internal suspend fun integrations(account: String, method: String = "GET", input: JSONObject? = null, deleteId: String? = null): JSONObject =
        suspendCancellableCoroutine { continuation ->
            val request = friendsWorker.submit {
                if (continuation.isActive) continuation.resumeWith(runCatching {
                    val login = session?.takeIf { it.account == account && runtime.cloudIoAllowed(isolatedTransport) }
                        ?: throw CloudFailure("UNAUTHORIZED")
                    val path = when (method) {
                        "POST" -> "tokens"
                        "DELETE" -> "tokens/" + checkNotNull(deleteId).also { require(Regex("[a-f0-9-]{36}").matches(it)) }
                        else -> "manage"
                    }
                    val response = transport.request("/v1/integrations/$path", method, login.token, input?.let(StrictJson::render), timeoutMillis = 15000)
                    if (session !== login) throw CloudFailure("UNAUTHORIZED")
                    response
                })
            }
            continuation.invokeOnCancellation { request.cancel(false) }
        }
    private fun refreshAccount():JSONObject{
        val login=checkNotNull(session)
        val choice=accountOutbox.pending(login.account)
        val updated=if(choice==null)api("account",timeoutMillis=15000)
            else api("account","PATCH",JSONObject(choice.change),timeoutMillis=15000).also{accountOutbox.acknowledge(choice)}
        val local=accountOutbox.overlay(updated);publish{it.copy(account=local)};return local
    }
    fun account(change:JSONObject,expectedAccount:String?=session?.account){
        val account=expectedAccount?:return;if(!runtime.cloudIoAllowed(isolatedTransport)||session?.account!=account||change.length()==0)return
        accountOutbox.stage(account,change);publish{it}
        worker.execute{perform(false){if(session?.account==account){refreshAccount();refreshFriends()}}}
    }
    fun invite(code:String)=worker.execute{perform{api("friends/invite","POST",JSONObject().put("code",code.trim().uppercase()));refreshChangedFriends()}}
    fun respond(id:String,action:String)=worker.execute{perform{api("friends/respond","POST",JSONObject().put("id",id).put("action",action));refreshChangedFriends()}}
    fun sharing(id:String,policy:JSONObject?)=worker.execute{perform{api("friends/sharing","POST",JSONObject().put("id",id).put("sharing",policy?:JSONObject.NULL));refreshChangedFriends()}}
    fun revokeDevice(id:String)=runAction(CloudAction.REVOKE_DEVICE){api("devices/revoke","POST",JSONObject().put("id",id));sync()}
    fun captureBackup()=runAction(CloudAction.BACKUP){
        when(val synced=sync()){
            CloudResult.COMPLETE->{api("backup/capture","POST",JSONObject());sync()}
            CloudResult.RETRY_PENDING->throw CloudFailure("BACKUP_NOT_SYNCED")
            else->synced
        }
    }
    fun restoreBackup()=runAction(CloudAction.RESTORE){
        val head=fetchHead();api("backup/restore","POST",JSONObject().put("revision",head.getLong("revision")).put("requestId",UUID.randomUUID().toString()));sync("cloud")
    }
    fun changePassword(account:String,current:String,next:String,onResult:(String?)->Unit)=worker.execute{
        val code=try{
            if(session?.account!=account)throw CloudFailure("UNAUTHORIZED")
            val response=api("password","POST",JSONObject().put("currentPassword",current).put("password",next))
            check(response.optBoolean("ok"))
            null
        }catch(error:Exception){
            val cloud=error as? CloudFailure
            if(cloud?.code=="UNAUTHORIZED"&&session?.account==account)failure(cloud)
            cloud?.code?:"NETWORK_UNAVAILABLE"
        }
        main.post{onResult(code)}
    }
    internal fun testClose(){check(BuildConfig.NATIVE_DIAGNOSTICS);synchronized(this){
        started=false;worker.shutdownNow();friendsWorker.shutdownNow()}
        worker.awaitTermination(5,TimeUnit.SECONDS);friendsWorker.awaitTermination(5,TimeUnit.SECONDS)}
    companion object {
        @Volatile private var instance:NativeCloudController?=null
        fun get(context:Context,runtime:PreviewRuntime):NativeCloudController=instance?:synchronized(this){instance?:NativeCloudController(context.applicationContext,runtime).also{instance=it}}
        fun peek()=instance
        internal fun isolated(context:Context,runtime:PreviewRuntime,transport:CloudTransport,directory:File):NativeCloudController{
            check(BuildConfig.NATIVE_DIAGNOSTICS);require(directory.parentFile==context.noBackupFilesDir&&directory.name.startsWith("cloud-test-"));check(directory.mkdir())
            return NativeCloudController(context.applicationContext,runtime,transport,directory,"cloud-device-isolated")
        }
    }
}
