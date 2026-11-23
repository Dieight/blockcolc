package com.blockcolc.preview

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import com.blockcolc.domain.DomainTime
import com.blockcolc.focus.DeadlineTicket

/** Projection only. It never changes sessions or maintains a second timer. */
class FocusPlatform(private val context: Context) {
    private val alarms = context.getSystemService(AlarmManager::class.java)
    private val notifications = context.getSystemService(NotificationManager::class.java)
    private var previous: PendingIntent? = null
    private var shownTicket: DeadlineTicket? = null
    private val colorOsDevice=listOf(Build.MANUFACTURER,Build.BRAND).any{it.lowercase() in setOf("oppo","oneplus","realme")}
    private fun english(state:PreviewSnapshot)=state.preferences.language=="en"
    private fun text(state:PreviewSnapshot,zh:String,en:String)=if(english(state))en else zh
    private fun surfaceKey(state:PreviewSnapshot)="${state.generation}:${state.planId}"
    internal fun compactFocusLabel(state:PreviewSnapshot):String?=when(state.phase){
        "FOCUS"->text(state,"专注中","Focus")
        "REST"->text(state,"休息中","Break")
        "READY"->text(state,"等待中","Waiting")
        else->null
    }
    fun promotedAllowed():Boolean = Build.VERSION.SDK_INT>=36 && runCatching {
        notifications.javaClass.getMethod("canPostPromotedNotifications").invoke(notifications)==true
    }.getOrDefault(false)
    fun backgroundLimited()=context.getSystemService(ActivityManager::class.java).let{Build.VERSION.SDK_INT>=28&&it.isBackgroundRestricted}
    fun batteryExempt()=context.getSystemService(android.os.PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName)
    fun settingsIntent(kind:String):Intent {
        val app=android.net.Uri.parse("package:${context.packageName}")
        val candidate=when(kind){
            "notifications"->if(Build.VERSION.SDK_INT>=26)Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,context.packageName)else Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,app)
            "exact"->if(Build.VERSION.SDK_INT>=31)Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,app)else Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,app)
            "promotion"->if(Build.VERSION.SDK_INT>=36)Intent("android.settings.APP_NOTIFICATION_PROMOTION_SETTINGS").putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,context.packageName)else Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,app)
            // ColorOS/OriginOS vendor power controls are reached from app details.
            else->Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,app)
        }
        return candidate
    }
    private fun cancelLive(){
        for(item in notifications.activeNotifications){
            if(item.id!=LIVE||item.notification.extras.getString("blockcolc.focus.key")==null)continue
            if(item.tag!=null&&!OriginOsTimerSurface.ownsTag(item.tag,item.notification.extras.getString("blockcolc.focus.tag")?:""))continue
            OriginOsTimerSurface.end(notifications,item)
            notifications.cancel(item.tag,item.id)
        }
        notifications.cancel(LIVE)
    }
    fun exactAllowed() = Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms()
    fun notificationAllowed() = (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) && (Build.VERSION.SDK_INT < 24 || notifications.areNotificationsEnabled()) && (Build.VERSION.SDK_INT<26 || notifications.getNotificationChannel(CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE)
    fun capabilities() = "${if (exactAllowed()) "精确提醒可用" else "未授权精确提醒，后台可能延迟"} · ${if (notificationAllowed()) "通知可用" else "通知未开启"}"
    @android.annotation.SuppressLint("ObsoleteSdkInt") // Capability helpers also query app-op state; they are not SDK predicates.
    fun update(ticket: DeadlineTicket?, state: PreviewSnapshot,events:List<String> = emptyList()):String? {
        val types=events.mapNotNull{runCatching{org.json.JSONObject(it).getString("type")}.getOrNull()}
        if(ticket!=shownTicket){previous?.let(alarms::cancel);previous=null;cancelLive();shownTicket=ticket}
        if (ticket == null) {
            val waiting=state.phase=="READY"&&state.planId!=null&&state.round in 1 until state.rounds
            if(waiting&&colorOsDevice&&promotedAllowed()&&notificationAllowed()){
                context.stopService(Intent(context, FocusAlarmService::class.java))
                notifications.cancel(REMINDER)
                notifications.notify(LIVE,notification(state,null,waitingLive=true))
                return state.returnReminderKey
            }
            cancelLive();context.stopService(Intent(context, FocusAlarmService::class.java))
            val eligible=waiting&&state.planMode!=com.blockcolc.storage.PlanMode.ROUNDS&&state.preferences.returnToFocusReminders
            val complete=state.phase=="REPORT"&&"FocusCompleted" in types
            val returning=eligible&&state.returnReminderKey!=null
            val existing=notifications.activeNotifications.firstOrNull{it.id==REMINDER}
            if(!notificationAllowed()||(!eligible&&state.phase!="REPORT")||existing?.notification?.extras?.getString("blockcolc.focus.key")?.let{it!=surfaceKey(state)}==true)notifications.cancel(REMINDER)
            if(notificationAllowed()&&(complete||returning)){
                if(!returning||existing?.notification?.extras?.getString("blockcolc.return.key")!=state.returnReminderKey)
                    notifications.notify(REMINDER,notification(state,null))
            }
            val adopted=returning&&notifications.activeNotifications.any{it.id==REMINDER&&it.notification.extras.getString("blockcolc.return.key")==state.returnReminderKey}
            return if(state.returnReminderKey!=null&&(!state.preferences.returnToFocusReminders||adopted))state.returnReminderKey else null
        }
        notifications.cancel(REMINDER)
        val intent = Intent(context, FocusDeadlineReceiver::class.java).setAction("com.blockcolc.preview.DEADLINE")
            .setData(android.net.Uri.parse("blockcolc-preview://deadline/${com.blockcolc.domain.StrictJson.sha(ticket.json().toString())}"))
            .putExtra("ticket", ticket.json().toString())
        val pending = PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        previous = pending
        val at = DomainTime.millis(ticket.end)
        try {
            if (exactAllowed()) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
            else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
        } catch (_: SecurityException) { alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending) }
        if (notificationAllowed()) {
            notifications.notify(liveTag(ticket),LIVE, notification(state, ticket))
            if (exactAllowed() && state.automaticAuthorized) {
                val service = Intent(context, FocusAlarmService::class.java).putExtra("ticket", ticket.json().toString())
                try { if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(service) else context.startService(service) }
                catch (e: RuntimeException) { android.util.Log.i("BlockcolcP2", "FGS unavailable: ${e.javaClass.simpleName}; absolute alarm remains scheduled") }
            }else context.stopService(Intent(context,FocusAlarmService::class.java))
        } else context.stopService(Intent(context, FocusAlarmService::class.java))
        return null
    }
    private fun liveTag(ticket:DeadlineTicket)="blockcolc-focus:${com.blockcolc.domain.StrictJson.sha(ticket.json().toString())}"
    internal fun notification(state:PreviewSnapshot,ticket:DeadlineTicket?,waitingLive:Boolean=false,colorOs:Boolean=colorOsDevice):Notification {
        if (Build.VERSION.SDK_INT >= 26) notifications.createNotificationChannel(NotificationChannel(CHANNEL, "方块钟 · 专注与休息", NotificationManager.IMPORTANCE_LOW).apply { setSound(null, null); enableVibration(false) })
        val intent = PendingIntent.getActivity(context, 1, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        @Suppress("DEPRECATION") val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, CHANNEL) else Notification.Builder(context)
        val extended=state.extensionStartedAt?.takeIf{ticket!=null}
        val heading=if(extended!=null)text(state,"加时专注","Extended focus")else if(english(state))when(state.phase){"FOCUS"->"Focus · ${state.round+1}/${state.rounds}";"REST"->"Break";"READY"->"Ready for the next round";"REPORT"->"Focus completed";else->"blockcolc"}else state.heading
        val subtext=if(extended!=null)text(state,"等待用户结束","Waiting for manual finish")else "${minOf(state.round+1,maxOf(1,state.rounds))}/${maxOf(1,state.rounds)}"
        val live=ticket!=null||waitingLive
        b.setSmallIcon(if(colorOs)R.drawable.ic_focus_coloros else R.drawable.ic_focus).setContentTitle(heading).setContentText(state.detail).setContentIntent(intent)
            .setCategory(if(live)"stopwatch" else Notification.CATEGORY_REMINDER)
            .setGroup("blockcolc-focus-audio").setSubText(subtext)
            .setVisibility(Notification.VISIBILITY_PUBLIC).setOnlyAlertOnce(true).setOngoing(live).setShowWhen(false)
        if(live&&colorOs&&Build.VERSION.SDK_INT>=36)compactFocusLabel(state)?.let{label->
            runCatching{Notification.Builder::class.java.getMethod("setShortCriticalText",String::class.java).invoke(b,label)}
        }
        val remaining = ticket?.let { DomainTime.millis(it.end) - System.currentTimeMillis() } ?: 0
        if(extended!=null)b.setWhen(DomainTime.millis(extended)).setShowWhen(true).setUsesChronometer(true)
        else if (remaining > 0 && ticket != null&&Build.VERSION.SDK_INT>=26) {
            b.setWhen(DomainTime.millis(ticket.end)).setShowWhen(true).setUsesChronometer(true)
            b.setChronometerCountDown(true)
            // Even if an OEM delays/kills the receiver, the stale countdown is
            // removed at its deadline instead of counting below zero forever.
            b.setTimeoutAfter(remaining)
        }else if(ticket!=null)b.setContentText("${text(state,"本轮结束于","Round ended at")} ${java.text.SimpleDateFormat("HH:mm:ss",java.util.Locale.getDefault()).format(java.util.Date(DomainTime.millis(ticket.end)))}")
        val extras=Bundle().apply {
            putString("blockcolc.focus.key",surfaceKey(state));state.returnReminderKey?.let{putString("blockcolc.return.key",it)}
            if(ticket!=null){putString("blockcolc.focus.ticket",ticket.json().toString());putString("blockcolc.focus.tag",liveTag(ticket))}
            if(live)putBoolean("android.requestPromotedOngoing",promotedAllowed())
            putBoolean("oplus_smallicon_use_app_icon",false)
        }
        if(ticket!=null){
            extras.putAll(OriginOsTimerSurface.extras(context,intent,heading,state.detail,subtext))
            if(extras.containsKey("notification.superx.scene")&&notifications.activeNotifications.any{
                it.id==LIVE&&it.notification.extras.getString("blockcolc.focus.ticket")==ticket.json().toString()&&it.notification.extras.containsKey("notification.superx.scene")
            })extras.putInt("notification.superx.operation",1)
        }
        b.addExtras(extras)
        return b.build()
    }
    fun serviceNotification(state:PreviewSnapshot):Notification {
        if(Build.VERSION.SDK_INT>=26)notifications.createNotificationChannel(NotificationChannel(SERVICE_CHANNEL,"方块钟 · 计划提醒服务",NotificationManager.IMPORTANCE_MIN).apply{setSound(null,null);enableVibration(false)})
        @Suppress("DEPRECATION") val b=if(Build.VERSION.SDK_INT>=26)Notification.Builder(context,SERVICE_CHANNEL)else Notification.Builder(context)
        val intent=PendingIntent.getActivity(context,1,Intent(context,MainActivity::class.java),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return b.setSmallIcon(R.drawable.ic_focus).setContentTitle(text(state,"方块钟 · 计划提醒","blockcolc · Plan reminders")).setContentText(text(state,"按保存的绝对时间交接，不依赖页面计时","Handoff follows saved absolute deadlines")).setContentIntent(intent).setShowWhen(false).setUsesChronometer(false).setOnlyAlertOnce(true).setOngoing(true).build()
    }
    companion object { const val SERVICE=2700;const val LIVE = 2701; const val REMINDER = 2702; const val CHANNEL = "p2-focus";const val SERVICE_CHANNEL="p2-timer-service" }
}

class FocusDeadlineReceiver: BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if(intent.action !in setOf("com.blockcolc.preview.DEADLINE",Intent.ACTION_BOOT_COMPLETED,Intent.ACTION_TIME_CHANGED,Intent.ACTION_TIMEZONE_CHANGED,Intent.ACTION_MY_PACKAGE_REPLACED,AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED))return
        val pending = goAsync()
        PreviewRuntime.get(context).receive(intent.getStringExtra("ticket")) { pending.finish() }
    }
}
class FocusAlarmService: Service() {
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val runtime = PreviewRuntime.get(this)
        val ticket = runCatching { intent?.getStringExtra("ticket")?.let { DeadlineTicket.parse(org.json.JSONObject(it)) } }.getOrNull()
        val current = runtime.latest
        if (current.ticket==null || current.error != null || !current.automaticAuthorized || !runtime.platform.exactAllowed() || !runtime.platform.notificationAllowed()) { stopSelfResult(startId); return START_NOT_STICKY }
        if(ticket!=current.ticket)return START_NOT_STICKY // A late start must not remove a newer phase's foreground notification.
        try {
            // Android may refuse timeout cancellation for an FGS notification.
            // Keep its mandatory notice static; the separate ordinary LIVE ID
            // owns the expiring countdown, as in the audited background adapter.
            val notification = runtime.platform.serviceNotification(current)
            if (Build.VERSION.SDK_INT >= 34) startForeground(FocusPlatform.SERVICE, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED)
            else startForeground(FocusPlatform.SERVICE, notification)
        } catch (error: RuntimeException) { android.util.Log.i("BlockcolcP2", "Alarm FGS denied: ${error.javaClass.simpleName}"); stopSelf() }
        return START_NOT_STICKY
    }
}
