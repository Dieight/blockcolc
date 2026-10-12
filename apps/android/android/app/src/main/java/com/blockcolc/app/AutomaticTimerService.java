package com.blockcolc.app;

import android.annotation.SuppressLint;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import java.lang.ref.WeakReference;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Keeps only a finite, explicitly authorized timer timeline alive. No WebView,
 * domain writes, polling loop, audio, location or long-lived wake lock. */
public final class AutomaticTimerService extends Service {
    private static final String CHANNEL = "blockcolc_automatic_timer_v2";
    private static final int ID = 42004;
    private static volatile WeakReference<AutomaticTimerService> active = new WeakReference<>(null);
    private final Object scheduleLock = new Object();
    private final ScheduledThreadPoolExecutor scheduler = new ScheduledThreadPoolExecutor(1,
        runnable -> new Thread(runnable, "AutomaticTimer"));
    private ScheduledFuture<?> pending;
    private long generation;
    private volatile boolean destroyed;

    static void refresh(Context context) {
        if (!BreakLiveUpdatePlugin.hasAutomaticTimeline(context)) {
            context.stopService(new Intent(context, AutomaticTimerService.class));
            return;
        }
        AutomaticTimerService current = active.get();
        if (current != null && !current.destroyed) {
            current.requestAdvance();
            return;
        }
        // Android 14's systemExempted type is for exact-alarm integrations.
        // A denied grant must retain the durable alarm/resume fallback, not
        // crash a service after startForegroundService has already returned.
        AlarmManager alarms = (AlarmManager) context.getSystemService(ALARM_SERVICE);
        if (Build.VERSION.SDK_INT >= 34 && (alarms == null || !alarms.canScheduleExactAlarms())) return;
        try {
            Intent intent = new Intent(context, AutomaticTimerService.class);
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
            else context.startService(intent);
        } catch (RuntimeException denied) {
            Log.i("AutomaticTimer", "Timer foreground service unavailable; retaining alarm recovery");
        }
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public void onCreate() {
        super.onCreate();
        // Durable preference commits and notification Binder calls must not
        // wait behind a paused WebView or block activity/layout work.
        scheduler.setRemoveOnCancelPolicy(true);
        scheduler.setExecuteExistingDelayedTasksAfterShutdownPolicy(false);
        active = new WeakReference<>(this);
    }

    // Private builds merge the main manifest through an external source set;
    // the final APK inspection verifies the packaged declaration in both.
    @SuppressLint("ForegroundServiceType")
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26) {
                manager.createNotificationChannel(new NotificationChannel(CHANNEL,
                    PresentationLanguage.text(this, "连续专注计时", "Continuous focus timer"),
                    NotificationManager.IMPORTANCE_LOW));
            }
            PendingIntent open = PendingIntent.getActivity(this, ID, new Intent(this, MainActivity.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification notification = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_tomato_outline)
                .setContentTitle("blockcolc")
                .setContentText(PresentationLanguage.text(this, "连续专注计划进行中", "Continuous focus plan is running"))
                .setContentIntent(open).setOngoing(true).setSilent(true)
                .setPriority(NotificationCompat.PRIORITY_LOW).setCategory(NotificationCompat.CATEGORY_SERVICE).build();
            ServiceCompat.startForeground(this, ID, notification,
                Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED : 0);
            requestAdvance();
            return START_STICKY;
        } catch (RuntimeException denied) {
            stopSelf();
            return START_NOT_STICKY;
        }
    }

    private void requestAdvance() {
        synchronized (scheduleLock) {
            if (destroyed) return;
            long ticket = ++generation;
            if (pending != null) pending.cancel(false);
            pending = scheduler.schedule(() -> advance(ticket), 0L, TimeUnit.MILLISECONDS);
        }
    }

    private void advance(long ticket) {
        if (destroyed) return;
        BreakLiveUpdatePlugin.traceAutomaticService(this, "service-wake", 0L);
        long next = BreakLiveUpdatePlugin.advanceAutomaticTimelines(this);
        BreakLiveUpdatePlugin.traceAutomaticService(this, "service-next", next);
        synchronized (scheduleLock) {
            // A newer authorization refresh must not be replaced by the older
            // callback that happened to be running during its durable commit.
            if (destroyed || ticket != generation) return;
            if (next <= 0L) {
                stopSelf();
                return;
            }
            // Wake at the absolute boundary; bounded clock rechecks cover wall
            // clock changes without a per-second background ticker.
            long delay = Math.max(1L, Math.min(60_000L, next - System.currentTimeMillis()));
            pending = scheduler.schedule(() -> advance(ticket), delay, TimeUnit.MILLISECONDS);
            if (BuildConfig.BLOCKCOLC_PERFORMANCE_DIAGNOSTICS) {
                // Synthetic-plan-only trace compares Looper dispatch with the
                // independent scheduler. Removed from non-diagnostic APKs.
                new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(
                    () -> BreakLiveUpdatePlugin.traceAutomaticService(this, "looper-check", next), delay);
            }
        }
    }

    @Override public void onDestroy() {
        synchronized (scheduleLock) {
            destroyed = true;
            generation++;
            if (pending != null) pending.cancel(false);
            scheduler.shutdown();
            if (active.get() == this) active = new WeakReference<>(null);
        }
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }
}
