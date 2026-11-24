package com.blockcolc.preview.world

import android.app.ActivityManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build

internal data class WorldDeviceCapabilities(val lowRam:Boolean,val ramMiB:Long,val glesVersion:Int,
    val vulkanLevelOne:Boolean,val mediaPerformanceClass:Int)

internal fun automaticQuality(device:WorldDeviceCapabilities):String=when{
    device.lowRam||device.ramMiB<2560||device.glesVersion<0x30000->"paper"
    device.mediaPerformanceClass>=34&&device.ramMiB>=6144&&device.vulkanLevelOne->"cinematic"
    device.mediaPerformanceClass>=31||device.ramMiB>=5120&&device.vulkanLevelOne&&device.glesVersion>=0x30001->"balanced"
    else->"performance"
}

internal fun automaticQuality(context:Context):String {
    val memory=context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val info=ActivityManager.MemoryInfo().also(memory::getMemoryInfo)
    val vulkan=Build.VERSION.SDK_INT>=24&&context.packageManager.hasSystemFeature(PackageManager.FEATURE_VULKAN_HARDWARE_LEVEL,1)
    val performance=if(Build.VERSION.SDK_INT>=31)Build.VERSION.MEDIA_PERFORMANCE_CLASS else 0
    return automaticQuality(WorldDeviceCapabilities(memory.isLowRamDevice,info.totalMem/1_048_576,
        memory.deviceConfigurationInfo.reqGlEsVersion,vulkan,performance))
}
