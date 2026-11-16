package com.blockcolc.preview.ui

import androidx.compose.runtime.*
import androidx.compose.foundation.layout.*
import androidx.compose.ui.unit.dp
import androidx.compose.material3.Text
import androidx.compose.ui.platform.LocalContext
import com.blockcolc.preview.FocusPlatform

/** These buttons open system UI only. No vendor whitelist or power policy writes. */
@Composable fun NativeNotificationSettings(language:String,onOpen:(android.content.Intent)->Unit){
    val context=LocalContext.current
    val platform=remember(context){FocusPlatform(context)}
    val en=language=="en"
    fun t(zh:String,english:String)=if(en)english else zh
    // Re-read on resume, including a permission revoked in Settings.
    var revision by remember{mutableIntStateOf(0)}
    val lifecycle=androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle){
        val observer=androidx.lifecycle.LifecycleEventObserver{_,event->if(event==androidx.lifecycle.Lifecycle.Event.ON_RESUME)revision++}
        lifecycle.addObserver(observer);onDispose{lifecycle.removeObserver(observer)}
    }
    @Suppress("UNUSED_VARIABLE") val observed=revision
    androidx.compose.foundation.layout.Column {
        @Composable fun row(title:String,status:String,kind:String){
            androidx.compose.foundation.layout.Row(androidx.compose.ui.Modifier.fillMaxWidth().heightIn(min=60.dp),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){
                androidx.compose.foundation.layout.Column(androidx.compose.ui.Modifier.weight(1f)){
                    NativeText(title,NativeTextRole.BODY);NativeText(status,NativeTextRole.CAPTION,color=androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant)
                }
                FormalTextAction(t("系统设置","System settings"),"gear",{onOpen(platform.settingsIntent(kind))})
            }
        }
        row(t("通知权限","Notifications"),t(if(platform.notificationAllowed())"已开启"else"未开启",if(platform.notificationAllowed())"Enabled"else"Disabled"),"notifications")
        if(android.os.Build.VERSION.SDK_INT>=31&&!platform.exactAllowed()){
            NativeSeparator();row(t("精确提醒","Precise reminders"),t("尚未授权","Not authorized"),"exact")
        }
        NativeSeparator();row(t("后台管理","Background activity"),t("查看应用的后台权限","Manage background access"),"battery")
    }
}
