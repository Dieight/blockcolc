package com.blockcolc.preview.world

import android.app.ActivityManager
import android.content.Context

internal fun automaticQuality(lowRam:Boolean,heapMiB:Int):String=when{
    lowRam||heapMiB<192->"paper"
    heapMiB<320->"performance"
    heapMiB<512->"balanced"
    else->"cinematic"
}

internal fun automaticQuality(context:Context):String {
    val memory=context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    return automaticQuality(memory.isLowRamDevice,memory.memoryClass)
}
