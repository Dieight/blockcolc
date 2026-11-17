package com.blockcolc.preview

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.blockcolc.cloud.*
import com.blockcolc.domain.DomainTime
import com.blockcolc.domain.StrictJson
import com.blockcolc.presentation.ClientPreferences
import com.blockcolc.storage.*
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

internal data class CloudView(val ready:Boolean=false,val busy:Boolean=false,val account:JSONObject?=null,val error:String?=null,
    val choiceRequired:Boolean=false,val conflicts:List<String> = emptyList(),val owner:String?=null,val owned:Boolean=false,
    val devices:List<JSONObject> = emptyList(),val friends:List<JSONObject> = emptyList(),val backup:JSONObject?=null,val lastSync:Long?=null,val accountPending:Boolean=false)

/** One network lane. It only adopts through PreviewRuntime's existing
 * serialized writer; it never owns another timer, database or world. */
internal class NativeCloudController private constructor(private val context:Context,private val runtime:PreviewRuntime,
    private val transport:CloudTransport=CloudTransport(context),private val directory:File=context.noBackupFilesDir,preferenceName:String="cloud-device"){
    private val isolatedTransport=preferenceName!="cloud-device"
    private val main=Handler(Looper.getMainLooper())
    private val worker=Executors.newSingleThreadScheduledExecutor{Thread(it,"blockcolc-cloud-io")}
    private val storage=CloudSessionStorage(context,directory)
    private val prefs by lazy{context.getSharedPreferences(preferenceName,Context.MODE_PRIVATE)}
    private val accountOutbox by lazy{AccountPreferenceOutbox({prefs.getString("pending-account-preferences",null)},{wire->
        prefs.edit().apply{if(wire==null)remove("pending-account-preferences")else putString("pending-account-preferences",wire)}.apply()
    })}
    private val resourceChoices by lazy{CloudResourceChoices(context,if(preferenceName=="cloud-device")"cloud-resource-choice"else"cloud-resource-choice-isolated")}
    private val device by lazy{prefs.getString("id",null)?:UUID.randomUUID().toString().also{check(prefs.edit().putString("id",it).commit())}}
    private val listeners=CopyOnWriteArrayList<(CloudView)->Unit>()
    @Volatile private var value=CloudView()
    @Volatile private var session:CloudSession?=null
    @Volatile private var started=false
    private var delayed:ScheduledFuture<*>?=null
    private var pending=false
    private val assets=File(directory,"cloud-assets")
    fun snapshot()=value
    fun subscribe(listener:(CloudView)->Unit):()->Unit{listeners.add(listener);listener(value);return{listeners.remove(listener)}}
    private fun publish(next:CloudView){
        val account=next.account?.let(accountOutbox::overlay)
        value=next.copy(account=account,accountPending=account?.optString("id")?.let{accountOutbox.pending(it)!=null}?:false,
            friends=if(account?.optBoolean("friendsEnabled")==false)emptyList()else next.friends)
        // A queued server reply must not repaint over a newer local choice.
        main.post{val current=value;listeners.forEach{it(current)}}
    }
    @Synchronized fun start(){if(started||!runtime.cloudIoAllowed(isolatedTransport))return;started=true;worker.execute{
        try{session=storage.read();if(session==null)runtime.cloudPermission(owned=true,bound=false).get()
            publish(value.copy(ready=true,account=session?.let{JSONObject().put("id",it.account).put("username",it.username)}));if(session!=null)sync()}
        catch(error:Exception){failure(error)}
    };worker.scheduleWithFixedDelay({if(session!=null&&!value.choiceRequired&&value.conflicts.isEmpty())perform(false){sync()}},30,30,TimeUnit.SECONDS)}
    @Synchronized fun changed(){if(!started||session==null)return;pending=true;delayed?.cancel(false);delayed=worker.schedule({
        pending=false;if(!value.choiceRequired&&value.conflicts.isEmpty())perform(false){sync()}
    },1200,TimeUnit.MILLISECONDS)}
    private fun api(path:String,method:String="GET",body:JSONObject?=null):JSONObject{
        check(runtime.cloudIoAllowed(isolatedTransport)){"TEST_WORKSPACE"}
        return transport.request("/v1/"+path,method,session?.token,body?.let(StrictJson::render))
    }
    private fun failure(error:Exception){val root=generateSequence<Throwable>(error){it.cause}.last();val cloud=root as? CloudFailure
        android.util.Log.w("BlockcolcCloud","Request failed: "+root.javaClass.simpleName)
        val revoked=cloud?.code=="UNAUTHORIZED"
        if(revoked)runCatching{runtime.cloudPermission(false).get()}
        val keys=cloud?.details?.optJSONArray("keys")?.let{a->List(a.length()){a.getString(it)}}.orEmpty()
        val choice=cloud?.code in setOf("EXECUTION_CHANGED","DOMAIN_CONFLICT","PLAN_CONFLICT","SYNC_CONFLICT","WORKSPACE_REPLACED")
        publish(value.copy(ready=true,busy=false,owned=if(revoked)false else value.owned,error=cloud?.code?:root.message?.takeIf{it in setOf("LOCAL_CHANGED","WORKSPACE_CHANGED","TEST_WORKSPACE")}?:"NETWORK_UNAVAILABLE",conflicts=keys,choiceRequired=value.choiceRequired||choice))
    }
    private fun perform(showBusy:Boolean=true,work:()->Unit){if(!runtime.cloudIoAllowed(isolatedTransport))return;if(showBusy)publish(value.copy(busy=true,error=null));try{work();publish(value.copy(busy=false,error=null))}catch(error:Exception){failure(error)}}
    fun login(username:String,password:String,register:Boolean)=worker.execute{perform{
        val input=JSONObject().put("username",username.trim()).put("password",password).put("deviceId",device).put("deviceName",Build.MODEL.take(64))
        if(register)input.put("name",username.trim()).put("timeZone",java.util.TimeZone.getDefault().id)
        val response=transport.request(if(register)"/v1/register"else"/v1/login","POST",body=StrictJson.render(input))
        val account=response.getJSONObject("account");val saved=CloudSession(response.getString("token"),account.getString("id"),account.getString("username"),device)
        // Persist the fence before a logged-in UI or receiver can proceed.
        val previous=session;val previousOwned=value.owned
        try{runtime.cloudPermission(owned=false).get();storage.write(saved);session=saved}
        catch(error:Exception){runCatching{storage.write(previous)};runtime.cloudPermission(previousOwned,bound=previous!=null).get();throw CloudFailure("LOCAL_CREDENTIALS_UNAVAILABLE")}
        publish(CloudView(ready=true,busy=true,account=account));sync()
    }}
    fun logout()=worker.execute{perform{
        runCatching{session?.account?.takeIf{accountOutbox.pending(it)!=null}?.let{refreshAccount()}}
        runCatching{if(value.owned)api("execution/release","POST",JSONObject().put("generation",execution))}
        runCatching{api("logout","POST",JSONObject())};storage.write(null);session=null
        runtime.cloudPermission(owned=true,bound=false).get();publish(CloudView(ready=true))
    }}
    fun refresh()=worker.execute{perform{sync()}}
    fun choose(strategy:String)=worker.execute{perform{require(strategy in setOf("merge","cloud","local"));sync(strategy)}}
    private var execution=0L
    private var remotePlanHint:String?=null
    private fun adoptHead(remote:JSONObject){val owner=remote.getJSONObject("execution").opt("owner") as? String;execution=remote.getJSONObject("execution").getLong("generation")
        val owned=owner==session?.device;runtime.cloudPermission(owned).get()
        val devices=remote.getJSONArray("devices");publish(value.copy(owner=owner,owned=owned,devices=List(devices.length()){devices.getJSONObject(it)},backup=remote.optJSONObject("backup")))
    }
    fun takeover()=worker.execute{perform{
        val head=api("workspace");adoptHead(head)
        val claim=api("execution/claim","POST",JSONObject().put("generation",execution).put("takeover",true));execution=claim.getLong("generation")
        runtime.cloudPermission(true).get();publish(value.copy(owned=true,owner=device,choiceRequired=false,conflicts=emptyList()))
        sync("cloud",takeover=true)
    }}
    private fun entries(x:JSONObject):Map<String,String>{val out=x.getJSONObject("entries");return out.keys().asSequence().associateWith{out.getString(it)}}
    private fun localEntries(local:CloudLocal):CloudWorkspace {
        val facts=CloudWorkspace.split(local.domain);val recovery=JSONObject(local.recovery.canonical())
        val plan=JSONObject().put("plan",recovery.get("plan")).put("automaticEnabled",local.recovery.automatic!=null)
        val planWire=if(!value.owned)remotePlanHint?:StrictJson.render(plan)else StrictJson.render(plan)
        val preferences=JSONObject(local.preferences.canonical());resourceChoices.read()?.let{preferences.put("resourceSelection",it)}
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
    private fun sync(strategy:String?=null,takeover:Boolean=false){
        if(!runtime.cloudIoAllowed(isolatedTransport))return
        val login=session?:return
        val account=refreshAccount()
        var remote=api("workspace");adoptHead(remote);remotePlanHint=entries(remote)["@plan"]
        var local=runtime.cloudCapture(login.account).get();var encoded=localEntries(local)
        if(local.baseline!=null&&local.baseline.epoch!=remote.getString("epoch")&&strategy==null){
            publish(value.copy(choiceRequired=true,error="WORKSPACE_REPLACED"));return
        }
        if(local.baseline==null&&entries(remote).isNotEmpty()&&hasWork(local)&&strategy==null){publish(value.copy(choiceRequired=true));return}
        val selected=strategy?:if(local.baseline==null&&entries(remote).isNotEmpty())"cloud"else"merge"
        val prior=local.baseline
        if(selected=="merge"&&prior!=null&&prior.execution!=0L&&prior.execution!=execution){
            val stale=CloudWorkspace.changes(encoded.entries,prior.hashes).filter{it.getString("key").let{k->k=="$/activeFocusSession"||k.startsWith("focusHistory/")||k.startsWith("progressReports/")}}
            if(stale.isNotEmpty()){publish(value.copy(choiceRequired=true,error="EXECUTION_CHANGED",conflicts=stale.map{it.getString("key")}));return}
        }
        if(entries(remote).isEmpty()||selected=="local"||selected=="merge"){
            val remoteEntries=entries(remote)
            val planInCloud=remoteEntries["@plan"]?.let{JSONObject(it).optJSONObject("plan")}
            val idleCloud=(remoteEntries["$/activeFocusSession"]==null||remoteEntries["$/activeFocusSession"]=="null")&&planInCloud==null
            if(remote.getJSONObject("execution").isNull("owner")&&idleCloud){
                val claim=api("execution/claim","POST",JSONObject().put("generation",execution));execution=claim.getLong("generation")
                runtime.cloudPermission(true).get();publish(value.copy(owner=device,owned=true))
            }
            if(selected=="local"&&entries(remote).isNotEmpty()){
                uploadAssets(encoded.assets)
                remote=api("workspace/replace","POST",JSONObject().put("revision",remote.getLong("revision")).put("entries",JSONObject(encoded.entries)).put("requestId",UUID.randomUUID().toString()))
                adoptHead(remote);val claim=api("execution/claim","POST",JSONObject().put("generation",execution));execution=claim.getLong("generation");runtime.cloudPermission(true).get();publish(value.copy(owner=device,owned=true))
            }else{
                // First deliberate merge only adds absent records. It never
                // interprets an unknown remote record as a local deletion.
                val baseline=local.baseline?.takeIf{it.epoch==remote.getString("epoch")}?.hashes?:emptyMap()
                val changes=CloudWorkspace.changes(encoded.entries,baseline).filter{value.owned||it.getString("key")!="@plan"}
                if(changes.isNotEmpty()){
                    uploadAssets(encoded.assets)
                    val result=api("workspace/commit","POST",JSONObject().put("requestId",UUID.randomUUID().toString()).put("epoch",remote.getString("epoch")).put("execution",execution).put("changes",JSONArray(changes)))
                    val acknowledged=baseline.toMutableMap();for(change in changes){val key=change.getString("key");if(change.isNull("canonical"))acknowledged.remove(key)else acknowledged[key]=StrictJson.sha(change.getString("canonical"))}
                    // A later edit can already exist locally. Acknowledge only
                    // these uploaded rows; keep unadopted remote additions out.
                    runtime.cloudAcknowledge(local,CloudBaseline(login.account,result.getString("epoch"),result.getLong("revision"),acknowledged,execution)).get()
                }
                remote=api("workspace");adoptHead(remote)
            }
        }
        val incoming=entries(remote)
        if(incoming.isEmpty())return
        local=runtime.cloudCapture(login.account).get();encoded=localEntries(local)
        val incomingHashes=incoming.mapValues{StrictJson.sha(it.value)}
        val pendingChanges=if(selected=="cloud")emptyList()else CloudWorkspace.changes(encoded.entries,local.baseline?.hashes.orEmpty()).filter{value.owned||it.getString("key")!="@plan"}
        val conflicts=pendingChanges.filter{change->val key=change.getString("key");val current=incoming[key];val base=local.baseline?.hashes?.get(key)
            current?.let(StrictJson::sha)!=base&&(if(change.isNull("canonical"))null else change.getString("canonical"))!=current}
        if(conflicts.isNotEmpty()){publish(value.copy(conflicts=conflicts.map{it.getString("key")},choiceRequired=true,error="SYNC_CONFLICT"));return}
        if(pendingChanges.isNotEmpty()){changed();return}
        val baseline=CloudBaseline(login.account,remote.getString("epoch"),remote.getLong("revision"),incomingHashes,execution)
        if(local.baseline?.hashes!=incomingHashes||takeover){
            val document=CloudWorkspace.join(incoming,::downloadAsset)
            var recovery=CloudWorkspace.recovery(incoming,document)
            if(value.owned){val old=local.recovery.automatic?.takeIf{local.recovery.plan==recovery.plan}
                val grant=old?:if(takeover&&local.preferences.autoContinueFocus&&JSONObject(incoming["@plan"]?:"{}").optBoolean("automaticEnabled")&&recovery.plan!=null)
                    ContinuationGrant(UUID.randomUUID().toString(),local.token.replacementGeneration,recovery.plan!!.completedSessionIds.lastOrNull())else null
                recovery=recovery.copy(automatic=grant)
            }
            val preferences=incoming["@preferences"]?.let(ClientPreferences::parseText)?:local.preferences
            val replacing=selected=="cloud"&&(local.baseline==null||local.baseline.epoch!=baseline.epoch)
            runtime.cloudApply(local,document,if(replacing)recovery.copy(automatic=null)else recovery,preferences,baseline,replacing,selected=="cloud"&&strategy!=null).get()
            incoming["@preferences"]?.let(::JSONObject)?.optJSONObject("resourceSelection")?.let{selection->
                val active=selection.opt("activeId") as? String;val base=selection.opt("baseId") as? String
                resourceChoices.save(active,base)
                com.blockcolc.preview.resources.NativeResourceController.get(context).cloudSelection(active,base)
            }
        }
        publish(value.copy(choiceRequired=false,conflicts=emptyList(),error=null,lastSync=System.currentTimeMillis()))
        // The server applies the visibility rules for friends and the viewer.
        if(value.owned){val actual=runtime.cloudCapture(login.account).get();val now=System.currentTimeMillis()
            val live=com.blockcolc.export.FocusExport.project(StoredState(actual.token,actual.domain,actual.recovery),com.blockcolc.export.FocusExport.date(now),now).first.getJSONObject("value")
            api("presence","POST",JSONObject().put("execution",execution).put("snapshot",live))
        }
        if(account.optBoolean("friendsEnabled"))loadFriends()
    }
    private fun loadFriends(){
        if(value.account?.optBoolean("friendsEnabled")!=true){publish(value.copy(friends=emptyList()));return}
        val rows=api("friends/summary").getJSONArray("friends");publish(value.copy(friends=List(rows.length()){rows.getJSONObject(it)}))
    }
    fun refreshFriends()=worker.execute{perform(false){loadFriends()}}
    suspend fun friendHistory(account:String,friend:String):JSONObject=suspendCancellableCoroutine{continuation->
        val request=worker.submit{
            if(continuation.isActive)continuation.resumeWith(runCatching{
                if(session?.account!=account)throw CloudFailure("UNAUTHORIZED")
                api("friends/history/"+friend)
            })
        }
        continuation.invokeOnCancellation{request.cancel(false)}
    }
    private fun refreshAccount():JSONObject{
        val login=checkNotNull(session)
        val choice=accountOutbox.pending(login.account)
        val updated=if(choice==null)api("account")else api("account","PATCH",JSONObject(choice.change)).also{accountOutbox.acknowledge(choice)}
        val local=accountOutbox.overlay(updated);publish(value.copy(account=local));return local
    }
    fun account(change:JSONObject,expectedAccount:String?=session?.account){
        val account=expectedAccount?:return;if(!runtime.cloudIoAllowed(isolatedTransport)||session?.account!=account||change.length()==0)return
        accountOutbox.stage(account,change);publish(value)
        worker.execute{perform(false){if(session?.account==account){refreshAccount();loadFriends()}}}
    }
    fun invite(code:String)=worker.execute{perform{api("friends/invite","POST",JSONObject().put("code",code.trim().uppercase()));loadFriends()}}
    fun respond(id:String,action:String)=worker.execute{perform{api("friends/respond","POST",JSONObject().put("id",id).put("action",action));loadFriends()}}
    fun sharing(id:String,policy:JSONObject?)=worker.execute{perform{api("friends/sharing","POST",JSONObject().put("id",id).put("sharing",policy?:JSONObject.NULL));loadFriends()}}
    fun revokeDevice(id:String)=worker.execute{perform{api("devices/revoke","POST",JSONObject().put("id",id));sync()}}
    fun captureBackup()=worker.execute{perform{api("backup/capture","POST",JSONObject());sync()}}
    fun restoreBackup()=worker.execute{perform{
        val head=api("workspace");api("backup/restore","POST",JSONObject().put("revision",head.getLong("revision")).put("requestId",UUID.randomUUID().toString()));sync("cloud")
    }}
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
    internal fun testClose(){check(BuildConfig.NATIVE_DIAGNOSTICS);worker.shutdownNow();worker.awaitTermination(5,TimeUnit.SECONDS)}
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
