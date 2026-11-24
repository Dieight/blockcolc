package com.blockcolc.preview

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.blockcolc.cloud.*
import com.blockcolc.domain.StrictJson
import com.blockcolc.export.FocusExport
import com.blockcolc.presentation.ClientPreferences
import com.blockcolc.storage.*
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.SocketTimeoutException
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.SSLException

internal enum class CloudAction { SYNC, MERGE, USE_CLOUD, REPLACE_CLOUD, TAKEOVER, BACKUP, RESTORE, REVOKE_DEVICE }
internal enum class CloudResult { WORKING, COMPLETE, NEEDS_CHOICE, RETRY_PENDING, FAILED }
internal data class CloudReceipt(val action:CloudAction,val result:CloudResult,val error:String?=null)

internal data class CloudView(val ready:Boolean=false,val requestBusy:Boolean=false,val account:JSONObject?=null,val error:String?=null,
    val choiceRequired:Boolean=false,val conflicts:List<String> = emptyList(),val owner:String?=null,val owned:Boolean=false,
    val devices:List<JSONObject> = emptyList(),val friends:List<JSONObject> = emptyList(),val backup:JSONObject?=null,val lastSync:Long?=null,
    val accountPending:Boolean=false,val receipt:CloudReceipt?=null,val friendsError:String?=null,
    val friendOrder:List<String> = emptyList()){
    val busy get()=requestBusy||receipt?.result==CloudResult.WORKING
    fun working(action:CloudAction)=receipt?.action==action&&receipt.result==CloudResult.WORKING
}

/** Workspace reconciliation and live status use separate network lanes.
 * Both read committed facts through PreviewRuntime's serialized writer. */
internal class NativeCloudController private constructor(private val context:Context,private val runtime:PreviewRuntime,
    private val transport:CloudTransport=CloudTransport(context),private val directory:File=context.noBackupFilesDir,preferenceName:String="cloud-device"){
    private val isolatedTransport=preferenceName!="cloud-device"
    private val main=Handler(Looper.getMainLooper())
    private val worker=Executors.newSingleThreadScheduledExecutor{Thread(it,"blockcolc-cloud-io")}
    private val presenceWorker=Executors.newSingleThreadScheduledExecutor{Thread(it,"blockcolc-cloud-presence")}
    private val friendsWorker=Executors.newSingleThreadExecutor{Thread(it,"blockcolc-cloud-friends")}
    private val presenceQueued=AtomicBoolean()
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
    @Volatile private var presenceConfirmedAt=0L
    @Volatile private var started=false
    private var unsubscribeFocus:(()->Unit)?=null
    private var delayed:ScheduledFuture<*>?=null
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
    @Synchronized fun start(){if(started||!runtime.cloudIoAllowed(isolatedTransport))return
        started=true;unsubscribeFocus=runtime.subscribeCloudFocus(::focusChanged);worker.execute{
        try{session=storage.read();if(session==null)runtime.cloudPermission(owned=true,bound=false).get()
            publish{it.copy(ready=true,requestBusy=session!=null,account=session?.let{login->JSONObject().put("id",login.account).put("username",login.username)})}
            if(session!=null){focusChanged();perform{sync()}}}
        catch(error:Exception){failure(error)}
    };worker.scheduleWithFixedDelay({if(session!=null&&!value.choiceRequired&&value.conflicts.isEmpty())perform(false){sync()}},30,30,TimeUnit.SECONDS)
        presenceWorker.scheduleWithFixedDelay(::sendPresence,30,30,TimeUnit.SECONDS)
    }
    @Synchronized fun changed(){if(!started||session==null)return;delayed?.cancel(false);delayed=worker.schedule({
        if(!value.choiceRequired&&value.conflicts.isEmpty())perform(false){sync()}
    },1200,TimeUnit.MILLISECONDS)}
    @Synchronized private fun focusChanged(){
        if(!started||session==null||!runtime.cloudIoAllowed(isolatedTransport)||!presenceQueued.compareAndSet(false,true))return
        presenceWorker.execute{presenceQueued.set(false);sendPresence()}
    }
    private fun sendPresence(){
        val login=session?:return
        if(!runtime.cloudIoAllowed(isolatedTransport))return
        try{
            val (state,generation)=runtime.cloudPresenceCapture(login.account,execution).get()?:return
            val now=System.currentTimeMillis()
            val snapshot=FocusExport.presence(state,now)
            if(session!==login||!runtime.cloudIoAllowed(isolatedTransport))return
            transport.request("/v1/presence","POST",login.token,StrictJson.render(
                JSONObject().put("execution",generation).put("snapshot",snapshot)),timeoutMillis=8000)
            if(session===login)presenceConfirmedAt=android.os.SystemClock.elapsedRealtime()
        }catch(error:Exception){
            // Heartbeats keep retrying after a network interruption. The
            // workspace lane owns conflicts and authentication UI feedback.
            val root=generateSequence<Throwable>(error){it.cause}.last()
            if(root is CloudFailure&&root.code in setOf("EXECUTION_CHANGED","UNAUTHORIZED"))changed()
            android.util.Log.w("BlockcolcCloud","Live status update deferred: "+root.javaClass.simpleName)
        }
    }
    private fun api(path:String,method:String="GET",body:JSONObject?=null,timeoutMillis:Long?=null):JSONObject{
        check(runtime.cloudIoAllowed(isolatedTransport)){"TEST_WORKSPACE"}
        val wire=body?.let(StrictJson::render)
        return if(timeoutMillis==null)transport.request("/v1/"+path,method,session?.token,wire)
            else transport.request("/v1/"+path,method,session?.token,wire,timeoutMillis)
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
    private fun failure(error:Throwable,action:CloudAction?=null){
        val code=errorCode(error)
        val cloud=generateSequence(error){it.cause}.filterIsInstance<CloudFailure>().firstOrNull()
        android.util.Log.w("BlockcolcCloud","Request failed: "+error.javaClass.simpleName)
        val revoked=code=="UNAUTHORIZED"
        if(revoked)runCatching{runtime.cloudPermission(false).get()}
        val keys=cloud?.details?.optJSONArray("keys")?.let{a->List(a.length()){a.optString(it)}.filter(String::isNotEmpty)}.orEmpty()
        val choice=code in setOf("EXECUTION_CHANGED","DOMAIN_CONFLICT","PLAN_CONFLICT","SYNC_CONFLICT","WORKSPACE_REPLACED")
        publish{current->
            val result=when{choice->CloudResult.NEEDS_CHOICE;code=="LOCAL_CHANGED"->CloudResult.RETRY_PENDING;else->CloudResult.FAILED}
            current.copy(ready=true,requestBusy=false,owned=if(revoked)false else current.owned,error=code,
                conflicts=if(choice)keys else current.conflicts,choiceRequired=current.choiceRequired||choice,
                receipt=action?.let{CloudReceipt(it,result,code)}?:current.receipt)
        }
    }
    private fun perform(showBusy:Boolean=true,work:()->Unit){
        if(!runtime.cloudIoAllowed(isolatedTransport))return
        if(showBusy)publish{it.copy(requestBusy=true,error=null)}
        try {
            work()
        }catch(error:Exception){failure(error)}
        catch(error:OutOfMemoryError){failure(error)}
        finally{if(showBusy)publish{it.copy(requestBusy=false)}}
    }
    private fun runAction(action:CloudAction,work:()->CloudResult){
        synchronized(viewGate){
            if(value.busy)return
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
        }
    }
    fun login(username:String,password:String,register:Boolean)=worker.execute{perform{
        val input=JSONObject().put("username",username.trim()).put("password",password).put("deviceId",device).put("deviceName",Build.MODEL.take(64))
        if(register)input.put("name",username.trim()).put("timeZone",java.util.TimeZone.getDefault().id)
        val response=transport.request(if(register)"/v1/register"else"/v1/login","POST",body=StrictJson.render(input))
        val account=response.getJSONObject("account");val saved=CloudSession(response.getString("token"),account.getString("id"),account.getString("username"),device)
        // Persist the fence before a logged-in UI or receiver can proceed.
        val previous=session;val previousOwned=value.owned
        try{runtime.cloudPermission(owned=false).get();storage.write(saved);execution=0;session=saved}
        catch(error:Exception){runCatching{storage.write(previous)};runtime.cloudPermission(previousOwned,bound=previous!=null).get();throw CloudFailure("LOCAL_CREDENTIALS_UNAVAILABLE")}
        publish{CloudView(ready=true,requestBusy=true,account=account)};sync()
    }}
    fun logout()=worker.execute{perform{
        runCatching{session?.account?.takeIf{accountOutbox.pending(it)!=null}?.let{refreshAccount()}}
        if(session!=null)try{api("logout","POST",JSONObject())}catch(error:CloudFailure){
            if(error.code!="UNAUTHORIZED")throw error
        }
        storage.write(null);session=null;execution=0
        runtime.cloudPermission(owned=true,bound=false).get();publish{CloudView(ready=true)}
    }}
    fun refresh()=runAction(CloudAction.SYNC){sync()}
    fun choose(strategy:String){
        val action=when(strategy){"merge"->CloudAction.MERGE;"cloud"->CloudAction.USE_CLOUD;"local"->CloudAction.REPLACE_CLOUD;else->error("Unknown sync strategy")}
        runAction(action){sync(strategy)}
    }
    private var remotePlanHint:String?=null
    private fun adoptHead(remote:JSONObject){val owner=remote.getJSONObject("execution").opt("owner") as? String;execution=remote.getJSONObject("execution").getLong("generation")
        val previouslyOwned=value.owned
        val owned=owner==session?.device;runtime.cloudPermission(owned).get()
        val devices=remote.getJSONArray("devices");publish{it.copy(owner=owner,owned=owned,devices=List(devices.length()){index->devices.getJSONObject(index)},backup=remote.optJSONObject("backup"))}
        if(owned&&!previouslyOwned){presenceConfirmedAt=0L;focusChanged()}
    }
    fun takeover()=runAction(CloudAction.TAKEOVER){
        val head=api("workspace");adoptHead(head)
        val claim=api("execution/claim","POST",JSONObject().put("generation",execution).put("takeover",true));execution=claim.getLong("generation")
        runtime.cloudPermission(true).get();publish{it.copy(owned=true,owner=device,choiceRequired=false,conflicts=emptyList())}
        sync("cloud",takeover=true)
    }
    private fun entries(x:JSONObject):Map<String,String>{val out=x.getJSONObject("entries");return out.keys().asSequence().associateWith{out.getString(it)}}
    private fun engineEntry(key:String)=key=="\$/activeFocusSession"||key=="@plan"||
        key.startsWith("focusHistory/")||key.startsWith("progressReports/")
    private fun localEntries(local:CloudLocal):CloudWorkspace {
        val facts=CloudWorkspace.split(local.domain);val recovery=JSONObject(local.recovery.canonical())
        val plan=JSONObject().put("plan",recovery.get("plan")).put("automaticEnabled",local.recovery.automatic!=null)
        val planWire=if(!value.owned)remotePlanHint?:StrictJson.render(plan)else StrictJson.render(plan)
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
    private fun hasWork(local:CloudLocal):Boolean {val root=local.domain.projectionJson();return root.getJSONArray("projects").length()>0||root.getJSONArray("habitBuildings").length()>0||root.getJSONArray("focusHistory").length()>0||root.getJSONArray("quickNotes").length()>0}
    private fun sync(strategy:String?=null,takeover:Boolean=false):CloudResult{
        val login=session?:throw CloudFailure("UNAUTHORIZED")
        val account=refreshAccount()
        var remote=api("workspace");adoptHead(remote);remotePlanHint=entries(remote)["@plan"]
        var local=runtime.cloudCapture(login.account).get();var encoded=localEntries(local)
        val originalEntries=entries(remote)
        if(value.owned&&local.baseline?.epoch!=remote.getString("epoch")&&originalEntries==encoded.entries){
            runtime.cloudAcknowledge(local,CloudBaseline(login.account,remote.getString("epoch"),remote.getLong("revision"),encoded.hashes,execution)).get()
            local=runtime.cloudCapture(login.account).get()
        }
        if(local.baseline!=null&&local.baseline.epoch!=remote.getString("epoch")&&strategy==null){
            publish{it.copy(choiceRequired=true,error="WORKSPACE_REPLACED")};return CloudResult.NEEDS_CHOICE
        }
        if(local.baseline==null&&entries(remote).isNotEmpty()&&hasWork(local)&&strategy==null){
            publish{it.copy(choiceRequired=true,conflicts=emptyList(),error=null)};return CloudResult.NEEDS_CHOICE
        }
        val selected=strategy?:if(local.baseline==null&&entries(remote).isNotEmpty())"cloud"else"merge"
        if(entries(remote).isEmpty()||selected=="local"||selected=="merge"){
            val remoteEntries=entries(remote)
            val planInCloud=remoteEntries["@plan"]?.let{JSONObject(it).optJSONObject("plan")}
            val idleCloud=(remoteEntries["$/activeFocusSession"]==null||remoteEntries["$/activeFocusSession"]=="null")&&planInCloud==null
            if(remote.getJSONObject("execution").isNull("owner")&&idleCloud){
                val claim=api("execution/claim","POST",JSONObject().put("generation",execution));execution=claim.getLong("generation")
                runtime.cloudPermission(true).get();publish{it.copy(owner=device,owned=true)}
                presenceConfirmedAt=0L
                focusChanged()
                local=runtime.cloudCapture(login.account).get();encoded=localEntries(local)
            }
            if(selected=="local"&&entries(remote).isNotEmpty()){
                if(!value.owned)throw CloudFailure("EXECUTION_CHANGED")
                uploadAssets(encoded.assets)
                remote=api("workspace/replace","POST",JSONObject().put("revision",remote.getLong("revision"))
                    .put("execution",execution).put("entries",JSONObject(encoded.entries)).put("requestId",UUID.randomUUID().toString()))
                val replacementExecution=remote.getJSONObject("execution").getLong("generation")
                runtime.cloudAcknowledge(local,CloudBaseline(login.account,remote.getString("epoch"),remote.getLong("revision"),encoded.hashes,replacementExecution)).get()
                adoptHead(remote)
                if(!value.owned)api("execution/claim","POST",JSONObject().put("generation",execution))
                remote=api("workspace");adoptHead(remote)
            }else{
                // Retain the last acknowledged values for a deliberate merge
                // across epochs so independent edits stay independent.
                val baseline=local.baseline?.hashes.orEmpty()
                val localChanges=CloudWorkspace.changes(encoded.entries,baseline).filter{value.owned||it.getString("key")!="@plan"}
                val changes=localChanges.filter{change->remoteEntries[change.getString("key")]!=encoded.entries[change.getString("key")]}
                val protectedChanges=changes.filter{engineEntry(it.getString("key"))}
                if(!value.owned&&protectedChanges.isNotEmpty()){
                    publish{it.copy(choiceRequired=true,error="EXECUTION_CHANGED",conflicts=protectedChanges.map{change->change.getString("key")})}
                    return CloudResult.NEEDS_CHOICE
                }
                var revision=remote.getLong("revision")
                if(changes.isNotEmpty()){
                    uploadAssets(encoded.assets)
                    val result=api("workspace/commit","POST",JSONObject().put("requestId",UUID.randomUUID().toString()).put("epoch",remote.getString("epoch")).put("execution",execution).put("changes",JSONArray(changes)))
                    revision=result.getLong("revision")
                }
                if(localChanges.isNotEmpty()){
                    val acknowledged=baseline.toMutableMap();for(change in localChanges){val key=change.getString("key");if(change.isNull("canonical"))acknowledged.remove(key)else acknowledged[key]=StrictJson.sha(change.getString("canonical"))}
                    // A later edit can already exist locally. Acknowledge only
                    // these uploaded rows; keep unadopted remote additions out.
                    runtime.cloudAcknowledge(local,CloudBaseline(login.account,remote.getString("epoch"),revision,acknowledged,execution)).get()
                }
                remote=api("workspace");adoptHead(remote)
            }
        }
        val incoming=entries(remote)
        remotePlanHint=incoming["@plan"]
        if(incoming.isEmpty())throw CloudFailure("CLOUD_EMPTY")
        local=runtime.cloudCapture(login.account).get();encoded=localEntries(local)
        val incomingHashes=incoming.mapValues{StrictJson.sha(it.value)}
        val pendingChanges=if(selected=="cloud")emptyList()else CloudWorkspace.changes(encoded.entries,local.baseline?.hashes.orEmpty()).filter{value.owned||it.getString("key")!="@plan"}
        val conflicts=pendingChanges.filter{change->val key=change.getString("key");val current=incoming[key];val base=local.baseline?.hashes?.get(key)
            current?.let(StrictJson::sha)!=base&&(if(change.isNull("canonical"))null else change.getString("canonical"))!=current}
        if(conflicts.isNotEmpty()){
            publish{it.copy(conflicts=conflicts.map{change->change.getString("key")},choiceRequired=true,error="SYNC_CONFLICT")}
            return CloudResult.NEEDS_CHOICE
        }
        if(pendingChanges.isNotEmpty()){
            publish{it.copy(choiceRequired=false,conflicts=emptyList(),error=null)}
            changed();return CloudResult.RETRY_PENDING
        }
        val baseline=CloudBaseline(login.account,remote.getString("epoch"),remote.getLong("revision"),incomingHashes,execution)
        if(local.baseline?.hashes!=incomingHashes||takeover||selected=="cloud"&&encoded.entries!=incoming){
            val document=CloudWorkspace.join(incoming,::downloadAsset)
            var recovery=CloudWorkspace.recovery(incoming,document)
            if(value.owned){val old=local.recovery.automatic?.takeIf{local.recovery.plan==recovery.plan}
                val grant=old?:if(takeover&&local.preferences.autoContinueFocus&&JSONObject(incoming["@plan"]?:"{}").optBoolean("automaticEnabled")&&recovery.plan!=null)
                    ContinuationGrant(UUID.randomUUID().toString(),local.token.replacementGeneration,recovery.plan!!.completedSessionIds.lastOrNull())else null
                recovery=recovery.copy(automatic=grant,returnReminder=local.recovery.returnReminder.takeIf{local.recovery.plan==recovery.plan})
            }
            val synced=incoming["@preferences"]?.let(ClientPreferences::parseText)?:local.preferences
            val preferences=if(local.preferences.lightingQuality=="paper"&&synced.lightingQuality=="performance")
                synced.copy(lightingQuality="paper") else synced
            val replacing=selected=="cloud"&&(local.baseline==null||local.baseline.epoch!=baseline.epoch)
            runtime.cloudApply(local,document,if(replacing)recovery.copy(automatic=null)else recovery,preferences,baseline,replacing,selected=="cloud"&&strategy!=null).get()
            incoming["@preferences"]?.let(::JSONObject)?.optJSONObject("resourceSelection")?.let{selection->
                val active=selection.opt("activeId") as? String;val base=selection.opt("baseId") as? String
                resourceChoices.save(active,base)
                com.blockcolc.preview.resources.NativeResourceController.get(context).cloudSelection(active,base)
            }
        }else if(local.baseline!=baseline)runtime.cloudAcknowledge(local,baseline).get()
        publish{current->
            val receipt=current.receipt
            current.copy(choiceRequired=false,conflicts=emptyList(),error=null,lastSync=System.currentTimeMillis(),
                receipt=if(receipt?.result==CloudResult.RETRY_PENDING)
                    CloudReceipt(receipt.action,CloudResult.COMPLETE)else receipt)
        }
        if(value.owned)focusChanged()
        if(account.optBoolean("friendsEnabled"))refreshFriends()
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
        if(value.owned&&(presenceConfirmedAt==0L||android.os.SystemClock.elapsedRealtime()-presenceConfirmedAt>=25_000))focusChanged()
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
    fun captureBackup()=runAction(CloudAction.BACKUP){api("backup/capture","POST",JSONObject());sync()}
    fun restoreBackup()=runAction(CloudAction.RESTORE){
        val head=api("workspace");api("backup/restore","POST",JSONObject().put("revision",head.getLong("revision")).put("requestId",UUID.randomUUID().toString()));sync("cloud")
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
        started=false;unsubscribeFocus?.invoke();unsubscribeFocus=null;worker.shutdownNow();presenceWorker.shutdownNow();friendsWorker.shutdownNow()}
        worker.awaitTermination(5,TimeUnit.SECONDS);presenceWorker.awaitTermination(5,TimeUnit.SECONDS);friendsWorker.awaitTermination(5,TimeUnit.SECONDS)}
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
