package com.blockcolc.updates

data class DownloadRecord(val id:Long,val token:String,val asset:UpdateAsset,val failure:UpdateProblem?=null)
enum class TransferPhase { DOWNLOADING, PAUSED, COMPLETE, FAILED }
data class TransferProgress(val phase:TransferPhase,val received:Long=0,val total:Long?=null)
enum class UpdatePhase { IDLE, DOWNLOADING, PAUSED, READY, FAILED }
data class UpdateStatus(val channel:UpdateChannel,val phase:UpdatePhase=UpdatePhase.IDLE,val asset:UpdateAsset?=null,val received:Long=0,val canInstall:Boolean=false,val problem:UpdateProblem?=null)
interface UpdateJobStore { fun read():DownloadRecord?; fun write(record:DownloadRecord?) }
interface UpdateDownloads { fun enqueue(token:String,asset:UpdateAsset):Long; fun query(id:Long):TransferProgress; fun remove(id:Long) }
interface UpdateFiles { fun verify(record:DownloadRecord,force:Boolean):AppIdentity; fun delete(token:String) }
interface UpdateInstaller { fun allowed():Boolean; fun authorize(); fun install(token:String) }
interface ReleaseSource { fun latest(cancel:UpdateCancellation):AppRelease? }
class UpdateCancellation {
    @Volatile private var cancelled=false
    @Volatile private var disconnect:(()->Unit)?=null
    fun cancel(){cancelled=true;disconnect?.invoke()}
    fun connection(close:(()->Unit)?){disconnect=close;if(cancelled)close?.invoke()}
    fun check(){if(cancelled)throw UpdateFailure(UpdateProblem.CANCELLED)}
}

/** Runs on one feature IO lane, separate from focus/domain writes. Android owns
 * the transfer; reconstructing this engine retains cancel/retry/verification. */
class UpdateEngine(
    val installed:AppIdentity,private val currentVersion:String,private val jobs:UpdateJobStore,
    private val downloads:UpdateDownloads,private val files:UpdateFiles,private val installer:UpdateInstaller,
    private val feed:UpdateFeed=UpdateFeed.STABLE,
    private val token:()->String={java.util.UUID.randomUUID().toString().replace("-","")},
) {
    val channel get()=UpdatePolicy.channel(installed)
    fun accepts(asset:UpdateAsset)=feed==UpdateFeed.BETA||!UpdatePolicy.isBeta(asset.version)
    private fun record():DownloadRecord?=jobs.read()?.also{
        UpdatePolicy.validate(it.asset)
        if(it.id<=0||!it.token.matches(Regex("[a-f0-9]{32}")))throw UpdateFailure(UpdateProblem.STORAGE)
    }
    fun cancel():UpdateStatus {
        record()?.let{downloads.remove(it.id);files.delete(it.token)}
        jobs.write(null)
        return UpdateStatus(channel)
    }
    fun start(asset:UpdateAsset):UpdateStatus {
        UpdatePolicy.requireDownload(installed);UpdatePolicy.validate(asset)
        if(!accepts(asset))throw UpdateFailure(UpdateProblem.CHANNEL)
        if(UpdatePolicy.compare(asset.version,currentVersion)<=0||(UpdatePolicy.isVersion(installed.version)&&UpdatePolicy.compare(asset.version,installed.version)<=0))throw UpdateFailure(UpdateProblem.NOT_NEWER)
        val old=record()
        if(old?.asset==asset&&old.failure==null)return status()
        cancel()
        val name=token();require(name.matches(Regex("[a-f0-9]{32}")))
        val id=downloads.enqueue(name,asset)
        try{jobs.write(DownloadRecord(id,name,asset))}catch(e:Exception){downloads.remove(id);files.delete(name);throw UpdateFailure(UpdateProblem.STORAGE)}
        return status()
    }
    private fun failed(record:DownloadRecord,problem:UpdateProblem):UpdateStatus {
        // Persist failure before returning it. If recording fails the caller
        // gets a storage error; no ready/install state can escape that path.
        jobs.write(record.copy(failure=problem));downloads.remove(record.id);files.delete(record.token)
        return UpdateStatus(channel,UpdatePhase.FAILED,record.asset,problem=problem)
    }
    fun status():UpdateStatus {
        val record=record()?:return UpdateStatus(channel)
        if(channel!=UpdateChannel.STANDARD||!accepts(record.asset)||UpdatePolicy.compare(record.asset.version,currentVersion)<=0)return cancel()
        record.failure?.let{return UpdateStatus(channel,UpdatePhase.FAILED,record.asset,problem=it)}
        val transfer=downloads.query(record.id)
        if(transfer.received>record.asset.size||transfer.received<0||transfer.total?.let{it>0&&it!=record.asset.size}==true)return failed(record,UpdateProblem.INTEGRITY)
        return when(transfer.phase){
            TransferPhase.FAILED->failed(record,UpdateProblem.TRANSFER)
            TransferPhase.DOWNLOADING,TransferPhase.PAUSED->UpdateStatus(channel,if(transfer.phase==TransferPhase.PAUSED)UpdatePhase.PAUSED else UpdatePhase.DOWNLOADING,record.asset,transfer.received)
            TransferPhase.COMPLETE->try{
                UpdatePolicy.identity(files.verify(record,false),installed,record.asset)
                UpdateStatus(channel,UpdatePhase.READY,record.asset,record.asset.size,installer.allowed())
            }catch(error:Exception){failed(record,(error as? UpdateFailure)?.problem?:UpdateProblem.INTEGRITY)}
        }
    }
    fun authorize(){UpdatePolicy.requireDownload(installed);if(status().phase!=UpdatePhase.READY)throw UpdateFailure(UpdateProblem.INTEGRITY);installer.authorize()}
    fun install(){
        UpdatePolicy.requireDownload(installed)
        if(status().phase!=UpdatePhase.READY)throw UpdateFailure(UpdateProblem.INTEGRITY)
        val current=record()?:throw UpdateFailure(UpdateProblem.INTEGRITY)
        try{UpdatePolicy.identity(files.verify(current,true),installed,current.asset)}catch(error:Exception){failed(current,(error as? UpdateFailure)?.problem?:UpdateProblem.INTEGRITY);throw error}
        if(!installer.allowed())throw UpdateFailure(UpdateProblem.PERMISSION)
        installer.install(current.token)
    }
}
