package com.blockcolc.preview

import android.app.Activity
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.TextView
import android.widget.FrameLayout
import com.blockcolc.world.NativeGeneratedScene
import com.blockcolc.world.filament.NativeWorldView

/** Test host only: avoids making a long CPU/filesystem check depend on an OEM
 * cached-app schedule. It does not open NativeApp, storage, GPU or a timer. */
class P3DerivedCacheCheckActivity:Activity() {
    var generatedWorld:NativeWorldView?=null;private set
    var onGeneratedFrame:((Long)->Unit)?=null
    var onGeneratedError:((String)->Unit)?=null
    override fun onCreate(savedInstanceState:Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(TextView(this).apply{text=getString(R.string.p3_cache_check_label);gravity=Gravity.CENTER})
    }
    /** Explicit instrumentation-only route; the normal empty activity still
     * opens neither a domain database nor a GPU engine. */
    fun presentGenerated(input:NativeGeneratedScene,fixedCamera:Boolean=false){
        val current=generatedWorld
        if(current!=null){current.updateGenerated(input,resetCamera=true);return}
        val root=FrameLayout(this);val height=(resources.displayMetrics.widthPixels*4.0/3).toInt()
        val world=NativeWorldView.generated(this,input,{_,_,presentation->onGeneratedFrame?.invoke(presentation)},{value->
            if(value.startsWith("ERROR:")||value=="NATIVE_UPDATE_ERROR")onGeneratedError?.invoke(value)
        },fixedCamera=fixedCamera);generatedWorld=world;root.addView(world,FrameLayout.LayoutParams(-1,height,Gravity.CENTER));setContentView(root);world.resume()
    }
    override fun onPause(){generatedWorld?.pause();super.onPause()}
    override fun onResume(){super.onResume();generatedWorld?.resume()}
    override fun onDestroy(){generatedWorld?.close();generatedWorld=null;super.onDestroy()}
}
