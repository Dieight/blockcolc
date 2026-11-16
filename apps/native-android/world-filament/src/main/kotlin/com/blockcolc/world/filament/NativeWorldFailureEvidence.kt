package com.blockcolc.world.filament

import android.content.Context
import java.io.File
import java.util.concurrent.atomic.AtomicReference

/** Explicit diagnostic-test opt-in only. Capture the first failure, after it
 * has already happened, so a forced collection cannot turn a capacity failure
 * into a passing run. Never armed by the user application. */
object NativeWorldFailureEvidence {
    private val target=AtomicReference<File?>()
    fun arm(context:Context,label:String):File {
        check(BuildConfig.NATIVE_DIAGNOSTICS)
        require(label.matches(Regex("[a-z0-9-]{1,100}")))
        val file=File(context.filesDir,"p3-world-failure-$label.hprof")
        check(!file.exists()&&target.compareAndSet(null,file))
        return file
    }
    fun reset(){target.set(null)}
    fun capture(error:Throwable){
        if(!BuildConfig.NATIVE_DIAGNOSTICS)return
        val file=target.getAndSet(null)?:return
        // Preserve the original error even if disk space or heap capture fails.
        try{
            android.util.Log.e("BlockcolcWorld","Capturing failed world heap",error)
            android.os.Debug.dumpHprofData(file.absolutePath)
            android.util.Log.i("BlockcolcWorld","World failure heap complete: ${file.name}")
        }catch(capture:Throwable){android.util.Log.w("BlockcolcWorld","World failure heap unavailable",capture)}
    }
}
