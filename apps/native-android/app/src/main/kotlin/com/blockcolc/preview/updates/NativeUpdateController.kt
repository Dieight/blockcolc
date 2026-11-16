package com.blockcolc.preview.updates

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.blockcolc.preview.BuildConfig
import com.blockcolc.updates.*
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Process-owned feature lane; neither a download nor its verification uses the
 * focus actor. Android's DownloadManager survives About/Activity/process exit. */
class NativeUpdateController private constructor(context:Context) {
    private val app=context.applicationContext
    private val main=Handler(Looper.getMainLooper())
    private val worker=ScheduledThreadPoolExecutor(1){r->Thread(r,"blockcolc-updates")}.apply{removeOnCancelPolicy=true}
    private val listeners=CopyOnWriteArraySet<(UpdateView)->Unit>()
    @Volatile private var session:UpdateSession?=null
    @Volatile private var visible=false
    @Volatile private var enabled=false
    @Volatile private var operable=false
    @Volatile private var language="zh-CN"
    @Volatile private var view=UpdateView()
    private val presentedNotice=java.util.concurrent.atomic.AtomicLong()
    private val checkRevision=java.util.concurrent.atomic.AtomicLong()
    private var poll:ScheduledFuture<*>?=null
    fun snapshot()=view
    fun subscribe(listener:(UpdateView)->Unit):()->Unit{listeners+=listener;listener(view);return{listeners-=listener}}
    private fun publish(value:UpdateView){view=value;main.post{listeners.forEach{it(value)}}}
    fun claimNotice(notice:Long):Boolean{val old=presentedNotice.get();return notice>old&&presentedNotice.compareAndSet(old,notice)}
    private fun current():UpdateSession=session?:UpdateSession(AndroidUpdates.engine(app,BuildConfig.PUBLIC_RELEASE_VERSION){language},PublicReleaseSource(),BuildConfig.PUBLIC_RELEASE_VERSION,::publish,
        {enabled&&visible&&operable}).also{session=it}
    private fun run(action:(UpdateSession)->Unit){worker.execute{
        try{action(current())}catch(error:Exception){publish(view.copy(checking=false,operating=false,problem=(error as? UpdateFailure)?.problem?:UpdateProblem.STORAGE))}
        schedule()
    }}
    private fun schedule(){
        poll?.cancel(false);poll=null
        if(visible&&view.status?.phase in setOf(UpdatePhase.DOWNLOADING,UpdatePhase.PAUSED))
            poll=worker.schedule({try{current().refresh()}finally{schedule()}},if(view.status?.phase==UpdatePhase.PAUSED)3000 else 1200,TimeUnit.MILLISECONDS)
    }
    fun configure(automatic:Boolean,canPresent:Boolean,language:String){
        this.language=language;enabled=automatic;operable=canPresent
        if(!automatic)session?.cancelCheck(true)
        run{it.configure(enabled,visible,operable)}
    }
    fun foreground(value:Boolean){
        if(visible==value)return
        visible=value
        if(!value)session?.cancelCheck(true)
        run{it.configure(enabled,visible,operable);if(value)it.refresh()}
    }
    fun closeAbout(){checkRevision.incrementAndGet();session?.cancelCheck()}
    fun check(){val owner=checkRevision.incrementAndGet();run{if(checkRevision.get()==owner)it.check()}}
    fun refresh(){run{it.refresh()}}
    fun confirmDownload(asset:UpdateAsset){run{it.download(asset)}}
    fun retry(asset:UpdateAsset){run{it.download(asset)}}
    fun cancel(){session?.cancelCheck();run{it.cancel()}}
    fun authorize(){run{it.authorize()}}
    fun install(){run{it.install()}}
    companion object {
        @android.annotation.SuppressLint("StaticFieldLeak") // The singleton retains only applicationContext, never an Activity.
        @Volatile private var instance:NativeUpdateController?=null
        fun get(context:Context)=instance?:synchronized(this){instance?:NativeUpdateController(context.applicationContext).also{instance=it}}
    }
}
