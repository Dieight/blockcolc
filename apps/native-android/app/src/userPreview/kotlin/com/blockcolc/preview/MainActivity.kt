package com.blockcolc.preview
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
/** Single user-facing root. Intent extras cannot select experimental renderers. */
class MainActivity:ComponentActivity(){
 override fun onCreate(savedInstanceState:Bundle?){
  super.onCreate(savedInstanceState)
  NativeStartupTrace.point("activity-created")
  val runtime=PreviewRuntime.get(this)
  // R8 removes this entire branch and its intent keys from user releases.
  // One benchmark APK can compare moving/still artwork with identical code.
  val loading=if(BuildConfig.BUILD_TYPE=="benchmark"){
   val family=intent.getStringExtra("p3LoadingArt")
   val moving=intent.getBooleanExtra("p3LoadingAnimated",true)
   if(family=="house"||family=="tomato"||!moving)com.blockcolc.preview.ui.NativeLoadingChoice(family=="tomato",0,moving)else null
  }else null
  // A benchmark may pin the existing session-only visual controls. User
  // releases remove this branch and ignore the extra; business time is real.
  val debug=if(BuildConfig.BUILD_TYPE=="benchmark"&&intent.getStringExtra("p4VisualPreset")=="clear-afternoon")
   com.blockcolc.world.NativeWorldDebug(true,com.blockcolc.world.NativeDebugWeather.CLEAR,900,0.0)else null
  setContent{NativeApp(runtime,loading,debug)};runtime.start()
 }
 override fun onResume(){super.onResume();PreviewRuntime.get(this).foreground(true)}
 override fun onStop(){PreviewRuntime.get(this).foreground(false,getSystemService(android.app.KeyguardManager::class.java).isKeyguardLocked);super.onStop()}
}
