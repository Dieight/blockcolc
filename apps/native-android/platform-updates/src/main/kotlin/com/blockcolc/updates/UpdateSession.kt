package com.blockcolc.updates

data class UpdateView(val status:UpdateStatus?=null,val release:AppRelease?=null,val checking:Boolean=false,val operating:Boolean=false,
    val checked:Boolean=false,val problem:UpdateProblem?=null,val notice:Long=0,val installRequested:Boolean=false,val feed:UpdateFeed=UpdateFeed.STABLE)

/** Application workflow, independent of Android/Compose. The host serializes
 * calls except cancellation, and retains this session when About closes. */
class UpdateSession(private val engine:UpdateEngine,private val source:ReleaseSource,private val currentVersion:String,private val publish:(UpdateView)->Unit,
    private val automaticAllowed:()->Boolean={true},initialNotice:Long=0) {
    var view=UpdateView(status=UpdateStatus(engine.channel),notice=initialNotice);private set
    @Volatile private var checking:UpdateCancellation?=null
    @Volatile private var automatic=false
    private var attempted=false
    private var enabled=false
    private var visible=false
    private var operable=false
    private var pendingAutomatic:AppRelease?=null
    private fun show(next:UpdateView){view=next;publish(next)}
    fun cancelCheck(automaticOnly:Boolean=false){if(!automaticOnly||automatic)checking?.cancel()}
    fun configure(enabled:Boolean,visible:Boolean,operable:Boolean){
        this.enabled=enabled;this.visible=visible;this.operable=operable
        if(!enabled){cancelCheck(true);pendingAutomatic=null}
        if(enabled&&visible&&!attempted){attempted=true;check(true)}
        deliverAutomatic()
    }
    fun check(isAutomatic:Boolean=false){
        if(checking!=null)return
        val cancel=UpdateCancellation();checking=cancel;automatic=isAutomatic
        show(view.copy(checking=true,problem=null,installRequested=false))
        try{
            val latest=source.latest(cancel);cancel.check()
            val newer=latest!=null&&UpdatePolicy.compare(latest.version,currentVersion)>0
            show(view.copy(checking=false,release=latest?.takeIf{newer},checked=true))
            if(isAutomatic&&newer)pendingAutomatic=latest
        }catch(error:Exception){
            show(view.copy(checking=false,problem=if(isAutomatic||(error as? UpdateFailure)?.problem==UpdateProblem.CANCELLED)null else UpdateProblem.CHECK))
        }finally{checking=null;automatic=false}
        if(isAutomatic)deliverAutomatic()
    }
    private fun deliverAutomatic(){
        val release=pendingAutomatic?:return
        if(!enabled||!visible||!operable||!automaticAllowed())return
        pendingAutomatic=null;show(view.copy(notice=view.notice+1))
        if(engine.channel==UpdateChannel.STANDARD&&release.asset!=null)download(release.asset)
    }
    fun refresh(){try{show(view.copy(status=engine.status(),problem=null))}catch(error:Exception){show(view.copy(problem=(error as? UpdateFailure)?.problem?:UpdateProblem.STORAGE))}}
    private fun operate(action:()->Unit){
        if(view.operating)return
        show(view.copy(operating=true,problem=null,installRequested=false))
        try{action();show(view.copy(status=engine.status(),operating=false))}
        catch(error:Exception){val status=runCatching{engine.status()}.getOrNull()
            show(view.copy(status=status?:view.status,operating=false,problem=(error as? UpdateFailure)?.problem?:UpdateProblem.STORAGE))}
    }
    /** Only About's confirmation or the explicit automatic preference calls this. */
    fun download(asset:UpdateAsset){operate{engine.start(asset)}}
    fun retry(){val asset=view.status?.asset?:view.release?.asset?:return;download(asset)}
    fun cancel(){operate{engine.cancel()}}
    fun authorize(){operate{engine.authorize()}}
    fun install(){operate{engine.install();show(view.copy(installRequested=true))}}
}
