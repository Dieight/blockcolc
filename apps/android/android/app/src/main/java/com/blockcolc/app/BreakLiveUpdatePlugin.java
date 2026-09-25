package com.blockcolc.app;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.AlarmManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.service.notification.StatusBarNotification;
import android.util.Log;
import android.net.Uri;
import androidx.core.app.NotificationCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Locale;
import java.util.Map;
import java.lang.ref.WeakReference;
import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(name = "BreakLiveUpdate")
public class BreakLiveUpdatePlugin extends Plugin {
    static final int NOTIFICATION_ID = 42002;
    private static final String TAG = "BreakLiveUpdate";
    private static final String CHANNEL_ID = "blockcolc_break_live_v1";
    private static final String EXTRA_REQUEST_PROMOTED_ONGOING = "android.requestPromotedOngoing";
    private static final String EXTRA_OPLUS_SMALL_ICON_USE_APP_ICON = "oplus_smallicon_use_app_icon";
    private static final String EXTRA_UPDATE_KEY = "com.blockcolc.app.extra.LIVE_UPDATE_KEY";
    private static final String EXTRA_KIND = "com.blockcolc.app.extra.LIVE_UPDATE_KIND";
    private static final String EXTRA_RETURN_TO_FOCUS = "com.blockcolc.app.extra.RETURN_TO_FOCUS";
    private static final String EXTRA_ENDS_AT_EPOCH_MS = "com.blockcolc.app.extra.ENDS_AT_EPOCH_MS";
    private static final String EXTRA_DEADLINE_REMINDER = "com.blockcolc.app.extra.DEADLINE_REMINDER";
    private static final String ACTION_BREAK_DEADLINE = "com.blockcolc.app.action.BREAK_DEADLINE";
    private static final String ACTION_BREAK_DISMISSED = "com.blockcolc.app.action.BREAK_DISMISSED";
    static final String ACTION_AUTO_CONTINUATION_DEADLINE = "com.blockcolc.app.action.AUTO_CONTINUATION_DEADLINE";
    static final String ACTION_BOOT_COMPLETED = "android.intent.action.BOOT_COMPLETED";
    static final String ACTION_PACKAGE_REPLACED = "android.intent.action.MY_PACKAGE_REPLACED";
    private static final String AUTO_EVENT_ID = "com.blockcolc.app.extra.AUTO_EVENT_ID";
    private static final String AUTO_AUTHORIZATION_ID = "com.blockcolc.app.extra.AUTO_AUTHORIZATION_ID";
    private static final String AUTO_SCHEDULED_AT = "com.blockcolc.app.extra.AUTO_SCHEDULED_AT_EPOCH_MS";
    private static final String AUTO_PREFERENCES = "blockcolc_automatic_continuation_v1";
    private static final String AUTO_EVENT_PREFIX = "event:";
    private static final String AUTO_DUE_EVENT = "automaticContinuationDue";
    private static final String KIND_FOCUS = "focus";
    private static final String KIND_BREAK = "break";
    private static final String ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS = "android.settings.APP_NOTIFICATION_PROMOTION_SETTINGS";
    private static final int FLAG_PROMOTED_ONGOING = 0x00040000;
    private static final int DEADLINE_REQUEST_OFFSET = 0x40000000;
    /**
     * AlarmManager callbacks and Capacitor calls can arrive on different
     * threads after the WebView has been recreated. Keep active-record lookup,
     * replacement and deadline cancellation one process-local transaction.
     */
    private static final Object TIMER_LOCK = new Object();
    private static final Object AUTO_CONTINUATION_LOCK = new Object();
    private static volatile WeakReference<BreakLiveUpdatePlugin> activePlugin = new WeakReference<>(null);

    static final class DeadlineAlarmResult {
        final boolean scheduled;
        final boolean exact;

        DeadlineAlarmResult(boolean scheduled, boolean exact) {
            this.scheduled = scheduled;
            this.exact = exact;
        }

        static DeadlineAlarmResult none() {
            return new DeadlineAlarmResult(false, false);
        }
    }

    static final class AutomaticDeadlineResult {
        final boolean scheduled;
        final boolean exact;
        final boolean due;

        AutomaticDeadlineResult(boolean scheduled, boolean exact, boolean due) {
            this.scheduled = scheduled;
            this.exact = exact;
            this.due = due;
        }
    }

    @Override
    public void load() {
        super.load();
        activePlugin = new WeakReference<>(this);
    }

    @Override
    protected void handleOnDestroy() {
        WeakReference<BreakLiveUpdatePlugin> reference = activePlugin;
        if (reference != null && reference.get() == this) activePlugin = new WeakReference<>(null);
        super.handleOnDestroy();
    }

    @PluginMethod
    public void scheduleAutomaticContinuation(PluginCall call) {
        String eventId = cleanAutomaticId(call.getString("eventId"));
        String authorizationId = cleanAutomaticId(call.getString("authorizationId"));
        Long scheduledAt = call.getLong("scheduledAtEpochMs");
        if (eventId.isEmpty() || authorizationId.isEmpty() || scheduledAt == null || scheduledAt <= 0L) {
            call.reject("A valid eventId, authorizationId, and absolute scheduledAtEpochMs are required");
            return;
        }
        AutomaticDeadlineResult result = scheduleAutomaticContinuation(
            getContext(), eventId, authorizationId, scheduledAt
        );
        JSObject value = new JSObject();
        value.put("scheduled", result.scheduled);
        value.put("exact", result.exact);
        value.put("due", result.due);
        call.resolve(value);
    }

    @PluginMethod
    public void cancelAutomaticContinuation(PluginCall call) {
        String eventId = cleanAutomaticId(call.getString("eventId"));
        if (eventId.isEmpty()) {
            call.reject("A valid eventId is required");
            return;
        }
        removeAutomaticEvent(getContext(), eventId);
        call.resolve();
    }

    @PluginMethod
    public void cancelAutomaticContinuations(PluginCall call) {
        String authorizationId = cleanAutomaticId(call.getString("authorizationId"));
        if (authorizationId.isEmpty()) {
            call.reject("A valid authorizationId is required");
            return;
        }
        removeAutomaticEventsForAuthorization(getContext(), authorizationId);
        call.resolve();
    }

    @PluginMethod
    public void getPendingAutomaticContinuations(PluginCall call) {
        JSObject value = new JSObject();
        value.put("events", pendingAutomaticEvents(getContext()));
        call.resolve(value);
    }

    @PluginMethod
    public void acknowledgeAutomaticContinuation(PluginCall call) {
        String eventId = cleanAutomaticId(call.getString("eventId"));
        if (eventId.isEmpty()) {
            call.reject("A valid eventId is required");
            return;
        }
        removeAutomaticEvent(getContext(), eventId);
        call.resolve();
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void show(PluginCall call) {
        synchronized (TIMER_LOCK) {
            showLocked(call);
        }
    }

    @SuppressLint("MissingPermission")
    private void showLocked(PluginCall call) {
        Long endsAtEpochMs = call.getLong("endsAtEpochMs");
        String requestedKind = cleanKind(call.getString("kind"));
        boolean returnToFocus = Boolean.TRUE.equals(call.getBoolean("returnToFocus"));
        boolean deadlineReached = Boolean.TRUE.equals(call.getBoolean("deadlineReached"));
        boolean dueReturnReminder = KIND_BREAK.equals(requestedKind)
            && returnToFocus
            && deadlineReached;
        if (endsAtEpochMs == null || (endsAtEpochMs <= System.currentTimeMillis() && !dueReturnReminder)) {
            call.reject("endsAtEpochMs must be a future timestamp");
            return;
        }
        Context context = getContext();
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            call.reject("Notification service is unavailable");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            call.resolve(capabilityResult(context, manager, null, false, false, false, false));
            return;
        }
        ensureChannel(manager);

        String kind = requestedKind;
        String updateKey = cleanUpdateKey(call.getString("updateKey"));
        boolean focus = KIND_FOCUS.equals(kind);
        StatusBarNotification matching = activeTimerNotification(manager, updateKey);
        if (matching != null) {
            Notification active = matching.getNotification();
            boolean promoted = isPromoted(active);
            boolean deadlineAlarmScheduled = false;
            boolean deadlineAlarmExact = false;
            boolean deadlineReminderPosted = false;
            if (dueReturnReminder) {
                if (active.extras.getBoolean(EXTRA_DEADLINE_REMINDER, false)) {
                    // Idempotent retry after the WebView or receiver raced the
                    // same absolute deadline. The existing record is already
                    // the drawer reminder; never post a second record.
                    deadlineReminderPosted = true;
                } else {
                    cancelBreakDeadline(context, updateKey);
                    Notification reminder = buildBreakDeadlineReminder(
                        context, active, updateKey, System.currentTimeMillis()
                    );
                    try {
                        manager.notify(timerTag(updateKey), NOTIFICATION_ID, reminder);
                        active = reminder;
                        promoted = isPromoted(reminder);
                        deadlineReminderPosted = true;
                    } catch (RuntimeException error) {
                        cancelTimerNotification(manager, matching);
                        call.reject("Notification permission is unavailable", error);
                        return;
                    }
                }
                call.resolve(capabilityResult(
                    context, manager, active, promoted, false, false, deadlineReminderPosted
                ));
                return;
            }
            if (!focus && returnToFocus) {
                DeadlineAlarmResult alarm = scheduleBreakDeadline(
                    context, updateKey, endsAtEpochMs, true
                );
                deadlineAlarmScheduled = alarm.scheduled;
                deadlineAlarmExact = alarm.exact;
                if (!alarm.scheduled) {
                    // The JS port will schedule its ordinary completion alarm.
                    // Do not leave a return card alive beside that fallback.
                    cancelTimerNotification(manager, matching);
                }
            }
            Log.i(TAG, "show skipped=same-" + kind + " promoted=" + promoted);
            call.resolve(capabilityResult(context, manager, active, promoted, deadlineAlarmScheduled, deadlineAlarmExact, false));
            return;
        }
        // ColorOS/OxygenOS caches the AOD Fluid Cloud by StatusBarNotification
        // identity more aggressively than the shade. Keep retries for one timer
        // stable, but give every new focus/break timer a fresh tag so its icon,
        // copy and `when` countdown cannot be inherited from an older session.
        cancelStaleTimerNotifications(context, manager);

        int completedRounds = boundedRound(call.getInt("completedRounds"));
        int totalRounds = boundedRound(call.getInt("totalRounds"));
        String nextTaskTitle = cleanTitle(call.getString("nextTaskTitle"));
        String projectTitle = cleanTitle(call.getString("projectTitle"));
        String taskTitle = cleanTitle(call.getString("taskTitle"));
        boolean marathon = Boolean.TRUE.equals(call.getBoolean("marathon"));
        String contentTitle;
        String summary;
        String details;
        String subText;
        if (focus) {
            // Keep the compact chip below the platform's seven-character
            // threshold. Marathon context remains available in the expanded
            // card instead of occupying the camera-side status area.
            contentTitle = "专注中";
            summary = !taskTitle.isEmpty() ? taskTitle : !projectTitle.isEmpty() ? projectTitle : "方块建造中";
            String projectLine = projectTitle.isEmpty() ? "" : "项目 · " + projectTitle + "\n";
            details = "▣ " + (marathon ? "马拉松建造" : "本轮建造") + "\n"
                + projectLine + "当前 · " + summary + "\n保持节奏，本轮结束后材料送达。";
            subText = "▣ 方块钟 · " + (marathon ? "马拉松" : "建造中");
        } else {
            contentTitle = "休息中";
            String roundText = completedRounds > 0 && totalRounds >= completedRounds
                ? String.format(Locale.SIMPLIFIED_CHINESE, "第 %d / %d 轮", completedRounds, totalRounds)
                : "本轮休息";
            String nextText = nextTaskTitle.isEmpty() ? roundText : roundText + " · 下一项 " + nextTaskTitle;
            summary = returnToFocus ? "返回专注 · " + nextText : nextText;
            details = returnToFocus ? "休息结束后返回专注\n" + nextText
                : nextTaskTitle.isEmpty() ? roundText : roundText + "\n下一项 · " + nextTaskTitle;
            subText = returnToFocus ? "▣ 方块钟 · 返回专注" : summary;
        }

        Intent openIntent = new Intent(context, MainActivity.class)
            .setAction(focus ? "com.blockcolc.app.action.OPEN_FOCUS" : "com.blockcolc.app.action.OPEN_BREAK")
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPendingIntent = PendingIntent.getActivity(
            context,
            NOTIFICATION_ID,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        Bundle liveUpdateExtras = new Bundle();
        liveUpdateExtras.putBoolean(EXTRA_REQUEST_PROMOTED_ONGOING, true);
        // OxygenOS defaults this to false, but set it explicitly so every
        // surface uses our monochrome notification icon rather than the
        // adaptive launcher icon.
        liveUpdateExtras.putBoolean(EXTRA_OPLUS_SMALL_ICON_USE_APP_ICON, false);
        liveUpdateExtras.putString(EXTRA_UPDATE_KEY, updateKey);
        liveUpdateExtras.putString(EXTRA_KIND, kind);
        liveUpdateExtras.putBoolean(EXTRA_RETURN_TO_FOCUS, returnToFocus);
        liveUpdateExtras.putLong(EXTRA_ENDS_AT_EPOCH_MS, endsAtEpochMs);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_tomato_outline)
            .setContentTitle(contentTitle)
            .setContentText(summary)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(details))
            // ColorOS maps subText to the Fluid Cloud card's third line.
            .setSubText(subText)
            .setContentIntent(openPendingIntent)
            .setWhen(endsAtEpochMs)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            // OnePlus reads public stopwatch notifications as lock-screen/AOD
            // timers. The previous private progress card exposed only its text
            // summary there even though the drawer chronometer was correct.
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setColor(0xFF276749)
            .addExtras(liveUpdateExtras);
        // A regular break card can disappear at its deadline because the
        // Capacitor completion alarm owns the fallback. An opted-in return
        // reminder must stay as one native record until the deadline receiver
        // replaces its copy; otherwise the Fluid Cloud card vanishes before it
        // can become the return-to-focus reminder.
        if (!returnToFocus) {
            builder.setTimeoutAfter(Math.max(1L, endsAtEpochMs - System.currentTimeMillis()));
        }
        if (!focus) {
            Intent skipIntent = new Intent(context, MainActivity.class)
                .setAction(MainActivity.ACTION_SKIP_BREAK)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent skipPendingIntent = PendingIntent.getActivity(
                context,
                NOTIFICATION_ID + 1,
                skipIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            builder.addAction(0, "跳过休息", skipPendingIntent);
        }
        if (!focus && returnToFocus) {
            Intent dismissIntent = new Intent(context, BreakDeadlineReceiver.class)
                .setAction(ACTION_BREAK_DISMISSED)
                .putExtra(EXTRA_UPDATE_KEY, updateKey);
            PendingIntent dismissPendingIntent = PendingIntent.getBroadcast(
                context,
                deadlineRequestCode(updateKey) + 1,
                dismissIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            builder.setDeleteIntent(dismissPendingIntent);
        }
        Notification notification = builder.build();
        try {
            boolean promotableCharacteristics = hasPromotableCharacteristics(notification);
            boolean canPostPromotedNotifications = canPostPromotedNotifications(manager);
            DeadlineAlarmResult deadlineAlarm = DeadlineAlarmResult.none();
            boolean deadlineReminderPosted = false;
            if (dueReturnReminder) {
                // This is the process-independent recovery path: the WebView
                // may only be sending the first due callback after a cold
                // start, so construct the final drawer reminder directly.
                notification = buildBreakDeadlineReminder(
                    context, notification, updateKey, System.currentTimeMillis()
                );
                manager.notify(timerTag(updateKey), NOTIFICATION_ID, notification);
                deadlineReminderPosted = true;
            } else {
                manager.notify(timerTag(updateKey), NOTIFICATION_ID, notification);
            }
            if (!focus && returnToFocus && !deadlineReminderPosted) {
                // Post first so a process-independent alarm can always find the
                // exact active record it is meant to replace.
                deadlineAlarm = scheduleBreakDeadline(context, updateKey, endsAtEpochMs, true);
                if (!deadlineAlarm.scheduled) {
                    // Keep the fallback's ordinary completion alarm single-owned:
                    // this record expires at the same absolute deadline instead
                    // of becoming a residual drawer card when AlarmManager is
                    // denied.
                    builder.setTimeoutAfter(Math.max(1L, endsAtEpochMs - System.currentTimeMillis()));
                    notification = builder.build();
                    manager.notify(timerTag(updateKey), NOTIFICATION_ID, notification);
                }
            }
            boolean promoted = isActiveNotificationPromoted(manager);
            JSObject result = capabilityResult(context, manager, notification, promoted, deadlineAlarm.scheduled, deadlineAlarm.exact, deadlineReminderPosted);
            Log.i(TAG, "show requested=true promotable=" + promotableCharacteristics
                + " allowed=" + canPostPromotedNotifications + " promoted=" + promoted
                + " deadlineAlarm=" + deadlineAlarm.scheduled + " exact=" + deadlineAlarm.exact
                + " deadlineReminder=" + deadlineReminderPosted
                + " tag=" + timerTag(updateKey) + " when=" + notification.when
                + " icon=" + notification.getSmallIcon());
            call.resolve(result);
        } catch (RuntimeException error) {
            if (!focus && returnToFocus) cancelBreakDeadline(context, updateKey);
            manager.cancel(timerTag(updateKey), NOTIFICATION_ID);
            call.reject("Notification permission is unavailable", error);
        }
    }

    @PluginMethod
    public void getCapability(PluginCall call) {
        Context context = getContext();
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            call.reject("Notification service is unavailable");
            return;
        }
        call.resolve(capabilityResult(context, manager, null, false, false, false, false));
    }

    @PluginMethod
    public void openPromotionSettings(PluginCall call) {
        Context context = getContext();
        Intent intent = promotionSettingsIntent(context);
        if (Build.VERSION.SDK_INT < 36 || intent.resolveActivity(context.getPackageManager()) == null) {
            call.reject("Promoted notification settings are unavailable");
            return;
        }
        try {
            context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            JSObject result = new JSObject();
            result.put("opened", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to open promoted notification settings", error);
        }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        synchronized (TIMER_LOCK) {
            cancelNotificationLocked(getContext());
        }
        call.resolve();
    }

    @PluginMethod
    public void cancelKind(PluginCall call) {
        synchronized (TIMER_LOCK) {
            String requestedKind = cleanKind(call.getString("kind"));
            Context context = getContext();
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                for (StatusBarNotification active : activeTimerNotifications(manager)) {
                    if (!sameKind(active.getNotification().extras.getString(EXTRA_KIND), requestedKind)) continue;
                    cancelBreakDeadline(context, active.getNotification().extras.getString(EXTRA_UPDATE_KEY));
                    cancelTimerNotification(manager, active);
                }
            }
        }
        call.resolve();
    }

    static void cancelNotification(Context context) {
        synchronized (TIMER_LOCK) {
            cancelNotificationLocked(context);
        }
    }

    private static void cancelNotificationLocked(Context context) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        cancelStaleTimerNotifications(context, manager);
        // Upgrade cleanup for the original untagged notification.
        manager.cancel(NOTIFICATION_ID);
    }

    private static JSObject capabilityResult(
        Context context,
        NotificationManager manager,
        Notification notification,
        boolean promoted,
        boolean deadlineAlarmScheduled,
        boolean deadlineAlarmExact,
        boolean deadlineReminderPosted
    ) {
        boolean supported = Build.VERSION.SDK_INT >= 36;
        boolean allowed = supported && canPostPromotedNotifications(manager);
        boolean promotable = notification != null && supported && hasPromotableCharacteristics(notification);
        boolean settingsAvailable = supported
            && promotionSettingsIntent(context).resolveActivity(context.getPackageManager()) != null;
        JSObject result = new JSObject();
        result.put("supported", supported);
        result.put("allowed", allowed);
        result.put("settingsAvailable", settingsAvailable);
        result.put("requested", notification != null && notification.extras.getBoolean(EXTRA_REQUEST_PROMOTED_ONGOING, false));
        result.put("promotableCharacteristics", promotable);
        result.put("promoted", promoted);
        result.put("liveUpdateEligible", promotable && allowed);
        result.put("deadlineAlarmScheduled", deadlineAlarmScheduled);
        result.put("deadlineAlarmExact", deadlineAlarmExact);
        result.put("deadlineReminderPosted", deadlineReminderPosted);
        return result;
    }

    private static Intent promotionSettingsIntent(Context context) {
        return new Intent(ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
    }

    /** API 36 calls stay behind reflection so V25 can keep its target/compile SDK 35 contract. */
    private static boolean canPostPromotedNotifications(NotificationManager manager) {
        if (Build.VERSION.SDK_INT < 36) return false;
        return invokeBoolean(manager, "canPostPromotedNotifications");
    }

    private static boolean hasPromotableCharacteristics(Notification notification) {
        if (Build.VERSION.SDK_INT < 36) return false;
        return invokeBoolean(notification, "hasPromotableCharacteristics");
    }

    private static boolean invokeBoolean(Object target, String methodName) {
        try {
            Object value = target.getClass().getMethod(methodName).invoke(target);
            return value instanceof Boolean && (Boolean) value;
        } catch (ReflectiveOperationException | RuntimeException error) {
            Log.w(TAG, methodName + " is unavailable", error);
            return false;
        }
    }

    private static boolean isActiveNotificationPromoted(NotificationManager manager) {
        if (Build.VERSION.SDK_INT < 36) return false;
        for (StatusBarNotification active : manager.getActiveNotifications()) {
            if (active.getId() == NOTIFICATION_ID
                && isPromoted(active.getNotification())) return true;
        }
        return false;
    }

    private static StatusBarNotification activeTimerNotification(NotificationManager manager, String updateKey) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return null;
        try {
            for (StatusBarNotification active : manager.getActiveNotifications()) {
                if (active.getId() != NOTIFICATION_ID) continue;
                if (updateKey == null) return active;
                if (sameUpdateKey(active.getNotification().extras.getString(EXTRA_UPDATE_KEY), updateKey)
                    && timerTag(updateKey).equals(active.getTag())) return active;
            }
        } catch (RuntimeException error) {
            Log.w(TAG, "Unable to inspect active timer notification", error);
        }
        return null;
    }

    private static StatusBarNotification[] activeTimerNotifications(NotificationManager manager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return new StatusBarNotification[0];
        try {
            StatusBarNotification[] active = manager.getActiveNotifications();
            java.util.ArrayList<StatusBarNotification> timers = new java.util.ArrayList<>();
            for (StatusBarNotification item : active) {
                if (item.getId() == NOTIFICATION_ID) timers.add(item);
            }
            return timers.toArray(new StatusBarNotification[0]);
        } catch (RuntimeException error) {
            Log.w(TAG, "Unable to inspect active timer notifications", error);
            return new StatusBarNotification[0];
        }
    }

    private static void cancelStaleTimerNotifications(Context context, NotificationManager manager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            manager.cancel(NOTIFICATION_ID);
            return;
        }
        try {
            for (StatusBarNotification active : activeTimerNotifications(manager)) {
                cancelBreakDeadline(context, active.getNotification().extras.getString(EXTRA_UPDATE_KEY));
                cancelTimerNotification(manager, active);
            }
        } catch (RuntimeException error) {
            Log.w(TAG, "Unable to cancel stale timer notifications", error);
            manager.cancel(NOTIFICATION_ID);
        }
    }

    private static void cancelTimerNotification(NotificationManager manager, StatusBarNotification active) {
        if (active.getTag() == null) manager.cancel(active.getId());
        else manager.cancel(active.getTag(), active.getId());
    }

    static String timerTag(String updateKey) {
        return "blockcolc-timer-" + Integer.toUnsignedString(updateKey == null ? 0 : updateKey.hashCode(), 16);
    }

    static boolean sameUpdateKey(String active, String requested) {
        return requested != null && !requested.isEmpty() && requested.equals(active);
    }

    static boolean sameKind(String active, String requested) {
        // Notifications from the previous app build did not record a kind and
        // were always breaks, so break cleanup remains upgrade-safe.
        if (active == null || active.isEmpty()) return KIND_BREAK.equals(requested);
        return active.equals(requested);
    }

    static boolean shouldScheduleDeadline(String kind, boolean returnToFocus) {
        return KIND_BREAK.equals(kind) && returnToFocus;
    }

    static boolean deadlineReached(long endsAtEpochMs, long nowEpochMs) {
        return nowEpochMs >= endsAtEpochMs;
    }

    static int deadlineRequestCode(String updateKey) {
        return DEADLINE_REQUEST_OFFSET ^ (updateKey == null ? 0 : updateKey.hashCode());
    }

    static String cleanAutomaticId(String value) {
        if (value == null || value.length() > 180 || !value.matches("[A-Za-z0-9:_-]+")) return "";
        return value;
    }

    static boolean validAutomaticContinuationEvent(String eventId, String authorizationId, long scheduledAtEpochMs) {
        return !cleanAutomaticId(eventId).isEmpty()
            && !cleanAutomaticId(authorizationId).isEmpty()
            && scheduledAtEpochMs > 0L;
    }

    static int automaticContinuationRequestCode(String eventId) {
        return eventId == null ? 0 : eventId.hashCode();
    }

    private static SharedPreferences automaticPreferences(Context context) {
        return context.getSharedPreferences(AUTO_PREFERENCES, Context.MODE_PRIVATE);
    }

    private static String automaticEventKey(String eventId) {
        return AUTO_EVENT_PREFIX + eventId;
    }

    private static JSONObject readAutomaticEvent(SharedPreferences preferences, String eventId) {
        String raw = preferences.getString(automaticEventKey(eventId), null);
        if (raw == null) return null;
        try {
            return new JSONObject(raw);
        } catch (JSONException error) {
            Log.w(TAG, "Discarding malformed automatic continuation event", error);
            preferences.edit().remove(automaticEventKey(eventId)).commit();
            return null;
        }
    }

    private static JSONObject automaticEvent(String eventId, String authorizationId, long scheduledAtEpochMs, boolean due) {
        JSONObject value = new JSONObject();
        try {
            value.put("eventId", eventId);
            value.put("authorizationId", authorizationId);
            value.put("scheduledAtEpochMs", scheduledAtEpochMs);
            value.put("due", due);
            return value;
        } catch (JSONException error) {
            throw new IllegalStateException("Unable to encode automatic continuation event", error);
        }
    }

    private static AutomaticDeadlineResult scheduleAutomaticContinuation(
        Context context,
        String eventId,
        String authorizationId,
        long scheduledAtEpochMs
    ) {
        if (!validAutomaticContinuationEvent(eventId, authorizationId, scheduledAtEpochMs)) {
            return new AutomaticDeadlineResult(false, false, false);
        }
        synchronized (AUTO_CONTINUATION_LOCK) {
            SharedPreferences preferences = automaticPreferences(context);
            JSONObject existing = readAutomaticEvent(preferences, eventId);
            if (existing != null
                && authorizationId.equals(existing.optString("authorizationId", ""))
                && scheduledAtEpochMs == existing.optLong("scheduledAtEpochMs", -1L)
                && existing.optBoolean("due", false)) {
                publishAutomaticContinuationDue(existing);
                return new AutomaticDeadlineResult(true, false, true);
            }
            JSONObject event = automaticEvent(
                eventId, authorizationId, scheduledAtEpochMs, deadlineReached(scheduledAtEpochMs, System.currentTimeMillis())
            );
            if (!preferences.edit().putString(automaticEventKey(eventId), event.toString()).commit()) {
                return new AutomaticDeadlineResult(false, false, false);
            }
            if (event.optBoolean("due", false)) {
                cancelAutomaticAlarm(context, eventId);
                publishAutomaticContinuationDue(event);
                return new AutomaticDeadlineResult(true, false, true);
            }
            boolean exact = scheduleAutomaticAlarm(context, eventId, authorizationId, scheduledAtEpochMs);
            return new AutomaticDeadlineResult(exact || automaticAlarmExists(context, eventId), exact, false);
        }
    }

    private static boolean scheduleAutomaticAlarm(Context context, String eventId, String authorizationId, long scheduledAtEpochMs) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return false;
        cancelAutomaticAlarm(context, eventId);
        Intent intent = new Intent(context, BreakDeadlineReceiver.class)
            .setAction(ACTION_AUTO_CONTINUATION_DEADLINE)
            .setData(Uri.parse("blockcolc://automatic-continuation/" + eventId))
            .putExtra(AUTO_EVENT_ID, eventId)
            .putExtra(AUTO_AUTHORIZATION_ID, authorizationId)
            .putExtra(AUTO_SCHEDULED_AT, scheduledAtEpochMs);
        PendingIntent pending = PendingIntent.getBroadcast(
            context,
            automaticContinuationRequestCode(eventId),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && alarms.canScheduleExactAlarms()) {
                try {
                    alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, scheduledAtEpochMs, pending);
                    return true;
                } catch (SecurityException deniedExactAlarm) {
                    Log.i(TAG, "Exact automatic continuation alarm unavailable; using inexact idle alarm");
                }
            }
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, scheduledAtEpochMs, pending);
            return false;
        } catch (RuntimeException error) {
            Log.w(TAG, "Unable to schedule automatic continuation deadline", error);
            cancelAutomaticAlarm(context, eventId);
            return false;
        }
    }

    private static boolean automaticAlarmExists(Context context, String eventId) {
        Intent intent = new Intent(context, BreakDeadlineReceiver.class)
            .setAction(ACTION_AUTO_CONTINUATION_DEADLINE)
            .setData(Uri.parse("blockcolc://automatic-continuation/" + eventId));
        return PendingIntent.getBroadcast(
            context,
            automaticContinuationRequestCode(eventId),
            intent,
            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE
        ) != null;
    }

    private static void cancelAutomaticAlarm(Context context, String eventId) {
        if (cleanAutomaticId(eventId).isEmpty()) return;
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        Intent intent = new Intent(context, BreakDeadlineReceiver.class)
            .setAction(ACTION_AUTO_CONTINUATION_DEADLINE)
            .setData(Uri.parse("blockcolc://automatic-continuation/" + eventId));
        PendingIntent pending = PendingIntent.getBroadcast(
            context,
            automaticContinuationRequestCode(eventId),
            intent,
            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE
        );
        if (pending == null) return;
        if (alarms != null) alarms.cancel(pending);
        pending.cancel();
    }

    private static void removeAutomaticEvent(Context context, String eventId) {
        synchronized (AUTO_CONTINUATION_LOCK) {
            cancelAutomaticAlarm(context, eventId);
            automaticPreferences(context).edit().remove(automaticEventKey(eventId)).commit();
        }
    }

    private static void removeAutomaticEventsForAuthorization(Context context, String authorizationId) {
        synchronized (AUTO_CONTINUATION_LOCK) {
            SharedPreferences preferences = automaticPreferences(context);
            Map<String, ?> values = preferences.getAll();
            SharedPreferences.Editor editor = preferences.edit();
            for (Map.Entry<String, ?> entry : values.entrySet()) {
                if (!entry.getKey().startsWith(AUTO_EVENT_PREFIX) || !(entry.getValue() instanceof String)) continue;
                try {
                    JSONObject event = new JSONObject((String) entry.getValue());
                    if (!authorizationId.equals(event.optString("authorizationId", ""))) continue;
                    String eventId = event.optString("eventId", "");
                    cancelAutomaticAlarm(context, eventId);
                    editor.remove(entry.getKey());
                } catch (JSONException error) {
                    editor.remove(entry.getKey());
                }
            }
            editor.commit();
        }
    }

    private static JSArray pendingAutomaticEvents(Context context) {
        synchronized (AUTO_CONTINUATION_LOCK) {
            SharedPreferences preferences = automaticPreferences(context);
            java.util.ArrayList<JSONObject> due = new java.util.ArrayList<>();
            for (Map.Entry<String, ?> entry : preferences.getAll().entrySet()) {
                if (!entry.getKey().startsWith(AUTO_EVENT_PREFIX) || !(entry.getValue() instanceof String)) continue;
                try {
                    JSONObject event = new JSONObject((String) entry.getValue());
                    if (event.optBoolean("due", false)) due.add(event);
                } catch (JSONException error) {
                    Log.w(TAG, "Ignoring malformed automatic continuation event", error);
                }
            }
            java.util.Collections.sort(due, (left, right) -> Long.compare(
                left.optLong("scheduledAtEpochMs", 0L), right.optLong("scheduledAtEpochMs", 0L)
            ));
            JSArray result = new JSArray();
            for (JSONObject event : due) result.put(event);
            return result;
        }
    }

    static void onAutomaticContinuationDeadline(Context context, Intent intent) {
        if (intent == null || !ACTION_AUTO_CONTINUATION_DEADLINE.equals(intent.getAction())) return;
        String eventId = cleanAutomaticId(intent.getStringExtra(AUTO_EVENT_ID));
        String authorizationId = cleanAutomaticId(intent.getStringExtra(AUTO_AUTHORIZATION_ID));
        long scheduledAt = intent.getLongExtra(AUTO_SCHEDULED_AT, 0L);
        if (!validAutomaticContinuationEvent(eventId, authorizationId, scheduledAt)) return;
        synchronized (AUTO_CONTINUATION_LOCK) {
            SharedPreferences preferences = automaticPreferences(context);
            JSONObject current = readAutomaticEvent(preferences, eventId);
            if (current == null
                || !authorizationId.equals(current.optString("authorizationId", ""))
                || scheduledAt != current.optLong("scheduledAtEpochMs", -1L)) return;
            if (!deadlineReached(scheduledAt, System.currentTimeMillis())) {
                scheduleAutomaticAlarm(context, eventId, authorizationId, scheduledAt);
                return;
            }
            JSONObject due = automaticEvent(eventId, authorizationId, scheduledAt, true);
            if (preferences.edit().putString(automaticEventKey(eventId), due.toString()).commit()) {
                cancelAutomaticAlarm(context, eventId);
                publishAutomaticContinuationDue(due);
            }
        }
    }

    static void restoreAutomaticContinuations(Context context) {
        synchronized (AUTO_CONTINUATION_LOCK) {
            SharedPreferences preferences = automaticPreferences(context);
            for (Map.Entry<String, ?> entry : preferences.getAll().entrySet()) {
                if (!entry.getKey().startsWith(AUTO_EVENT_PREFIX) || !(entry.getValue() instanceof String)) continue;
                try {
                    JSONObject event = new JSONObject((String) entry.getValue());
                    String eventId = cleanAutomaticId(event.optString("eventId", ""));
                    String authorizationId = cleanAutomaticId(event.optString("authorizationId", ""));
                    long scheduledAt = event.optLong("scheduledAtEpochMs", 0L);
                    if (!validAutomaticContinuationEvent(eventId, authorizationId, scheduledAt)) continue;
                    if (deadlineReached(scheduledAt, System.currentTimeMillis())) {
                        JSONObject due = automaticEvent(eventId, authorizationId, scheduledAt, true);
                        preferences.edit().putString(automaticEventKey(eventId), due.toString()).commit();
                    } else if (!event.optBoolean("due", false)) {
                        scheduleAutomaticAlarm(context, eventId, authorizationId, scheduledAt);
                    }
                } catch (JSONException error) {
                    Log.w(TAG, "Ignoring malformed automatic continuation event during restore", error);
                }
            }
        }
    }

    private static void publishAutomaticContinuationDue(JSONObject event) {
        BreakLiveUpdatePlugin plugin = activePlugin == null ? null : activePlugin.get();
        if (plugin == null) return;
        JSObject payload = new JSObject();
        payload.put("eventId", event.optString("eventId", ""));
        payload.put("authorizationId", event.optString("authorizationId", ""));
        payload.put("scheduledAtEpochMs", event.optLong("scheduledAtEpochMs", 0L));
        new Handler(Looper.getMainLooper()).post(() -> plugin.notifyListeners(AUTO_DUE_EVENT, payload));
    }

    private static Intent deadlineIntent(Context context, String action, String updateKey) {
        return new Intent(context, BreakDeadlineReceiver.class)
            .setAction(action)
            .putExtra(EXTRA_UPDATE_KEY, updateKey);
    }

    private static DeadlineAlarmResult scheduleBreakDeadline(
        Context context,
        String updateKey,
        long endsAtEpochMs,
        boolean returnToFocus
    ) {
        if (!shouldScheduleDeadline(KIND_BREAK, returnToFocus)
            || updateKey == null || updateKey.isEmpty()
            || deadlineReached(endsAtEpochMs, System.currentTimeMillis())) {
            return DeadlineAlarmResult.none();
        }
        // Re-arming is idempotent for the same update key. Remove any prior
        // PendingIntent first so a denied replacement cannot leave an older
        // deadline wake-up behind the current notification.
        cancelBreakDeadline(context, updateKey);
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return DeadlineAlarmResult.none();
        Intent intent = deadlineIntent(context, ACTION_BREAK_DEADLINE, updateKey)
            .putExtra(EXTRA_KIND, KIND_BREAK)
            .putExtra(EXTRA_RETURN_TO_FOCUS, true)
            .putExtra(EXTRA_ENDS_AT_EPOCH_MS, endsAtEpochMs);
        PendingIntent pending = PendingIntent.getBroadcast(
            context,
            deadlineRequestCode(updateKey),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        boolean exact = false;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && alarms.canScheduleExactAlarms()) {
                alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endsAtEpochMs, pending);
                exact = true;
            } else {
                // OEMs may deny exact alarms. The absolute end time remains the
                // only timer truth; this path only accepts a potentially late
                // presentation wake-up.
                alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endsAtEpochMs, pending);
            }
            return new DeadlineAlarmResult(true, exact);
        } catch (RuntimeException error) {
            Log.w(TAG, "Unable to schedule break deadline alarm", error);
            return DeadlineAlarmResult.none();
        }
    }

    private static void cancelBreakDeadline(Context context, String updateKey) {
        if (updateKey == null || updateKey.isEmpty()) return;
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        Intent intent = deadlineIntent(context, ACTION_BREAK_DEADLINE, updateKey);
        PendingIntent pending = PendingIntent.getBroadcast(
            context,
            deadlineRequestCode(updateKey),
            intent,
            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE
        );
        if (pending != null) {
            alarms.cancel(pending);
            pending.cancel();
        }
    }

    static void onBreakDeadline(Context context, Intent intent) {
        synchronized (TIMER_LOCK) {
            onBreakDeadlineLocked(context, intent);
        }
    }

    private static void onBreakDeadlineLocked(Context context, Intent intent) {
        if (intent == null) return;
        String updateKey = cleanUpdateKey(intent.getStringExtra(EXTRA_UPDATE_KEY));
        if (ACTION_BREAK_DISMISSED.equals(intent.getAction())) {
            cancelBreakDeadline(context, updateKey);
            return;
        }
        if (!ACTION_BREAK_DEADLINE.equals(intent.getAction()) || updateKey.isEmpty()) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        StatusBarNotification active = activeTimerNotification(manager, updateKey);
        if (active == null) {
            cancelBreakDeadline(context, updateKey);
            return;
        }
        Notification current = active.getNotification();
        Bundle extras = current.extras;
        if (!KIND_BREAK.equals(extras.getString(EXTRA_KIND))
            || !extras.getBoolean(EXTRA_RETURN_TO_FOCUS, false)) {
            cancelBreakDeadline(context, updateKey);
            return;
        }
        if (extras.getBoolean(EXTRA_DEADLINE_REMINDER, false)) {
            cancelBreakDeadline(context, updateKey);
            return;
        }
        long endsAt = extras.getLong(EXTRA_ENDS_AT_EPOCH_MS, 0L);
        long now = System.currentTimeMillis();
        if (!deadlineReached(endsAt, now)) {
            // A wake-up can arrive a little early on some OEMs. Keep the same
            // absolute deadline and re-arm instead of presenting prematurely.
            scheduleBreakDeadline(context, updateKey, endsAt, true);
            return;
        }
        cancelBreakDeadline(context, updateKey);
        Notification reminder = buildBreakDeadlineReminder(context, current, updateKey, now);
        try {
            manager.notify(timerTag(updateKey), NOTIFICATION_ID, reminder);
        } catch (RuntimeException error) {
            // Permission/channel policy may change while the process is gone.
            // Remove the stale countdown rather than leave a card with no
            // remaining owner or retry loop.
            Log.w(TAG, "Unable to post break deadline reminder", error);
            manager.cancel(timerTag(updateKey), NOTIFICATION_ID);
        }
    }

    private static Notification buildBreakDeadlineReminder(
        Context context,
        Notification current,
        String updateKey,
        long nowEpochMs
    ) {
        Intent openIntent = new Intent(context, MainActivity.class)
            .setAction("com.blockcolc.app.action.OPEN_BREAK")
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPendingIntent = PendingIntent.getActivity(
            context,
            NOTIFICATION_ID,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        Bundle extras = new Bundle();
        extras.putBoolean(EXTRA_REQUEST_PROMOTED_ONGOING, true);
        extras.putBoolean(EXTRA_OPLUS_SMALL_ICON_USE_APP_ICON, false);
        extras.putString(EXTRA_UPDATE_KEY, updateKey);
        extras.putString(EXTRA_KIND, KIND_BREAK);
        extras.putBoolean(EXTRA_RETURN_TO_FOCUS, true);
        extras.putBoolean(EXTRA_DEADLINE_REMINDER, true);
        extras.putLong(EXTRA_ENDS_AT_EPOCH_MS, current.extras.getLong(EXTRA_ENDS_AT_EPOCH_MS, nowEpochMs));
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_tomato_outline)
            .setContentTitle("返回专注")
            .setContentText("休息已结束，回来开始下一轮专注。")
            .setStyle(new NotificationCompat.BigTextStyle().bigText("休息已结束，回来开始下一轮专注。\n点击打开方块钟。"))
            .setSubText("▣ 方块钟 · 返回专注")
            .setContentIntent(openPendingIntent)
            .setWhen(nowEpochMs)
            .setShowWhen(true)
            .setUsesChronometer(false)
            .setOngoing(true)
            .setOnlyAlertOnce(false)
            .setSilent(false)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setColor(0xFF276749)
            .addExtras(extras);
        Intent dismissIntent = deadlineIntent(context, ACTION_BREAK_DISMISSED, updateKey);
        PendingIntent dismissPendingIntent = PendingIntent.getBroadcast(
            context,
            deadlineRequestCode(updateKey) + 1,
            dismissIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        return builder.setDeleteIntent(dismissPendingIntent).build();
    }

    private static boolean isPromoted(Notification notification) {
        return notification != null && (notification.flags & FLAG_PROMOTED_ONGOING) != 0;
    }

    private static int boundedRound(Integer value) {
        if (value == null) return 0;
        return Math.max(0, Math.min(999, value));
    }

    private static String cleanTitle(String value) {
        if (value == null) return "";
        String clean = value.trim().replaceAll("\\s+", " ");
        return clean.length() <= 80 ? clean : clean.substring(0, 80);
    }

    private static String cleanUpdateKey(String value) {
        if (value == null) return "";
        return value.length() <= 512 ? value : value.substring(0, 512);
    }

    private static String cleanKind(String value) {
        return KIND_FOCUS.equals(value) ? KIND_FOCUS : KIND_BREAK;
    }

    private static void ensureChannel(NotificationManager manager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "实时专注与休息", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("在流体云、锁屏和通知栏显示专注或休息的实时倒计时");
        channel.setSound(null, null);
        channel.enableVibration(false);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(channel);
    }
}
