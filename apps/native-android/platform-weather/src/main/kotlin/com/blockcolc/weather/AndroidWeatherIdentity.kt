package com.blockcolc.weather

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import java.security.MessageDigest

/** Uses this APK's identity; never substitutes the installed formal app. */
object AndroidWeatherIdentity {
    @Suppress("DEPRECATION")
    fun read(context:Context):WeatherIdentity?=try{
        val own=context.packageName
        val signers=if(Build.VERSION.SDK_INT>=28){
            context.packageManager.getPackageInfo(own,PackageManager.GET_SIGNING_CERTIFICATES).signingInfo?.apkContentsSigners
        }else context.packageManager.getPackageInfo(own,PackageManager.GET_SIGNATURES).signatures
        val signer=signers?.singleOrNull()
        if(signer==null)null else WeatherIdentity(own,QWeatherProtocol.formatSha1Fingerprint(MessageDigest.getInstance("SHA-1").digest(signer.toByteArray())))
    }catch(_:Exception){null}
}
