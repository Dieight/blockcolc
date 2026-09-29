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
import java.net.URLEncoder;
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
    // Separate actions and request codes are part of PendingIntent identity.
    // Keep ACTION_BREAK_DISMISSED for cleanup/handling of notifications made
    // by older builds, whose countdown and reminder shared one PendingIntent.
    static final String ACTION_BREAK_DISMISSED = "com.blockcolc.app.action.BREAK_DISMISSED";
    static final String ACTION_BREAK_COUNTDOWN_DISMISSED = "com.blockcolc.app.action.BREAK_COUNTDOWN_DISMISSED";
    static final String ACTION_BREAK_REMINDER_DISMISSED = "com.blockcolc.app.action.BREAK_REMINDER_DISMISSED";
    static final String ACTION_AUTO_CONTINUATION_DEADLINE = "com.blockcolc.app.action.AUTO_CONTINUATION_DEADLINE";
    static final String ACTION_AUTO_TIMELINE_BOUNDARY = "com.blockcolc.app.action.AUTO_TIMELINE_BOUNDARY";
    static final String ACTION_BOOT_COMPLETED = "android.intent.action.BOOT_COMPLETED";
    static final String ACTION_PACKAGE_REPLACED = "android.intent.action.MY_PACKAGE_REPLACED";
    private static final String AUTO_EVENT_ID = "com.blockcolc.app.extra.AUTO_EVENT_ID";
    private static final String AUTO_AUTHORIZATION_ID = "com.blockcolc.app.extra.AUTO_AUTHORIZATION_ID";
    private static final String AUTO_SCHEDULED_AT = "com.blockcolc.app.extra.AUTO_SCHEDULED_AT_EPOCH_MS";
    private static final String AUTO_PREFERENCES = "blockcolc_automatic_continuation_v1";
    private static final String BREAK_PRESENTATION_PREFERENCES = "blockcolc_break_presentation_v1";
    private static final String BREAK_PRESENTATION_PREFIX = "projection:";
    private static final String AUTO_EVENT_PREFIX = "event:";
    private static final String AUTO_AUTHORIZATION_PREFIX = "authorization:";
    private static final String AUTO_REVOKED_PREFIX = "revoked:";
    private static final String AUTO_ACK_PREFIX = "acknowledged:";
    private static final String AUTO_DUE_EVENT = "automaticContinuationDue";
    private static final String KIND_FOCUS = "focus";
    private static final String KIND_BREAK = "break";
    private static final String ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS = "android.settings.APP_NOTIFICATION_PROMOTION_SETTINGS";
    private static final int FLAG_PROMOTED_ONGOING = 0x00040000;
    private static final int DEADLINE_REQUEST_OFFSET = 0x40000000;
    private static final int AUTO_TIMELINE_REQUEST_OFFSET = 0x20000000;
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

        static AutomaticDeadlineResult none() {
            return new AutomaticDeadlineResult(false, false, false);
        }
    }

    @Override
    public void load() {
        super.load();
        activePlugin = new WeakReference<>(this);
        restoreAutomaticContinuations(getContext());
        restoreBreakReminderProjections(getContext());
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
        JSONObject timeline = call.getData().optJSONObject("timeline");
        if (eventId.isEmpty() || authorizationId.isEmpty() || scheduledAt == null || scheduledAt <= 0L) {
            call.reject("A valid eventId, authorizationId, and absolute scheduledAtEpochMs are required");
            return;
        }
        AutomaticDeadlineResult result = scheduleAutomaticContinuation(
            getContext(), eventId, authorizationId, scheduledAt, timeline
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
        if (!removeAutomaticEvent(getContext(), eventId)) {
            call.reject("Unable to persist automatic continuation acknowledgement");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void cancelAutomaticContinuations(PluginCall call) {
        String authorizationId = cleanAutomaticId(call.getString("authorizationId"));
        if (authorizationId.isEmpty()) {
            call.reject("A valid authorizationId is required");
            return;
        }
        if (!removeAutomaticEventsForAuthorization(getContext(), authorizationId)) {
            call.reject("Unable to persist automatic continuation revocation");
            return;
        }
        cancelAutomaticTimelineAlarm(getContext(), authorizationId);
        cancelAutomaticTimelineNotification(getContext(), authorizationId);
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
        if (!removeAutomaticEvent(getContext(), eventId)) {
            call.reject("Unable to persist automatic continuation acknowledgement");
            return;
        }
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
        String updateKey = cleanUpdateKey(call.getString("updateKey"));
        boolean returnToFocus = Boolean.TRUE.equals(call.getBoolean("returnToFocus"));
        boolean dueReturnReminder = KIND_BREAK.equals(requestedKind)
            && returnToFocus
            && endsAtEpochMs != null
            && endsAtEpochMs <= System.currentTimeMillis();
        if (endsAtEpochMs == null) {
            call.reject("endsAtEpochMs must be a future timestamp");
            return;
        }
        Context context = getContext();
        if (KIND_FOCUS.equals(requestedKind)) revokeBreakProjection(context, updateKey);
        else {
            if (!revokeOtherBreakProjections(context, updateKey)) {
                call.reject("Unable to persist prior break reminder cancellation");
                return;
            }
            if (!returnToFocus) revokeBreakProjection(context, updateKey);
        }
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            call.reject("Notification service is unavailable");
            return;
        }
        if (KIND_BREAK.equals(requestedKind) && returnToFocus) {
            SharedPreferences preferences = breakPresentationPreferences(context);
            BreakReminderProjection existing = readBreakProjection(preferences, updateKey);
            if (!BreakReminderProjection.allowsShow(existing, endsAtEpochMs)) {
                // A duplicate WebView show is a retry of the same absolute
                // break, not a fresh authorization after user dismissal.
                JSObject result = capabilityResult(context, manager, null, false, false, false, false);
                result.put("returnReminderDismissed", true);
                call.resolve(result);
                return;
            }
            BreakReminderProjection projection = BreakReminderProjection.pending(endsAtEpochMs);
            if (existing != null && existing.endsAtEpochMs == endsAtEpochMs
                && existing.stage == BreakReminderProjection.Stage.REMINDER) {
                projection = existing;
            } else if (dueReturnReminder && projection != null) {
                projection = projection.asReminder(System.currentTimeMillis());
            }
            if (!persistBreakProjection(context, updateKey, projection)) {
                call.reject("Unable to persist break reminder recovery intent");
                return;
            }
        }
        if (endsAtEpochMs <= System.currentTimeMillis() && !dueReturnReminder) {
            // Never leave an expired break chronometer in the shade/Fluid Cloud.
            // OEMs can ignore notification timeoutAfter; a late WebView refresh
            // must actively retire the previous timer instead of rejecting the
            // update and leaving its negative countdown visible.
            StatusBarNotification expired = activeTimerNotification(manager, updateKey);
            if (expired != null) cancelTimerNotification(manager, expired);
            if (!updateKey.isEmpty()) revokeBreakProjection(context, updateKey);
            call.resolve(capabilityResult(context, manager, null, false, false, false, false));
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            call.resolve(capabilityResult(context, manager, null, false, false, false, false));
            return;
        }
        ensureChannel(manager);

        String kind = requestedKind;
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
                        context, updateKey, endsAtEpochMs, System.currentTimeMillis()
                    );
                    try {
                        manager.notify(timerTag(updateKey), NOTIFICATION_ID, reminder);
                        active = reminder;
                        promoted = isPromoted(reminder);
                        deadlineReminderPosted = true;
                    } catch (RuntimeException error) {
                        cancelTimerNotification(manager, matching);
                        scheduleBreakReminderRetry(context, updateKey, endsAtEpochMs, System.currentTimeMillis());
                        call.reject("Notification permission is unavailable", error);
                        return;
                    }
                }
                call.resolve(capabilityResult(
                    context, manager, active, promoted, false, false, deadlineReminderPosted
                ));
                return;
            }
            if (!focus) {
                DeadlineAlarmResult alarm = scheduleBreakDeadline(
                    context, updateKey, endsAtEpochMs, returnToFocus
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
        // Always bound the countdown presentation by its absolute deadline.
        // Return reminders have a durable receipt + alarm to replace this card
        // even if the OS removes it before a delayed/inexact receiver runs.
        if (!focus) {
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
            builder.setDeleteIntent(breakCountdownDismissPendingIntent(context, updateKey, endsAtEpochMs));
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
                notification = buildBreakDeadlineReminder(context, updateKey, endsAtEpochMs, System.currentTimeMillis());
                manager.notify(timerTag(updateKey), NOTIFICATION_ID, notification);
                deadlineReminderPosted = true;
            } else {
                manager.notify(timerTag(updateKey), NOTIFICATION_ID, notification);
            }
            if (!focus && !deadlineReminderPosted) {
                // Post first so a process-independent alarm can always find the
                // exact active record it is meant to replace.
                deadlineAlarm = scheduleBreakDeadline(context, updateKey, endsAtEpochMs, returnToFocus);
                if (!deadlineAlarm.scheduled && returnToFocus) {
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
            // Keep the durable presentation receipt and alarm so a transient
            // notification failure can recover on receiver/boot retry.
            if (!focus && returnToFocus) {
                scheduleBreakReminderRetry(context, updateKey, endsAtEpochMs, System.currentTimeMillis());
            }
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
        boolean canceled;
        synchronized (TIMER_LOCK) {
            canceled = cancelNotificationLocked(getContext());
        }
        if (canceled) call.resolve();
        else call.reject("Unable to persist break reminder cancellation");
    }

    @PluginMethod
    public void cancelKind(PluginCall call) {
        synchronized (TIMER_LOCK) {
            String requestedKind = cleanKind(call.getString("kind"));
            Context context = getContext();
            if (KIND_BREAK.equals(requestedKind) && !revokeAllBreakProjections(context)) {
                call.reject("Unable to persist break reminder cancellation");
                return;
            }
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                for (StatusBarNotification active : activeTimerNotifications(manager)) {
                    if (!sameKind(active.getNotification().extras.getString(EXTRA_KIND), requestedKind)) continue;
                    revokeBreakProjection(context, active.getNotification().extras.getString(EXTRA_UPDATE_KEY));
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

    private static boolean cancelNotificationLocked(Context context) {
        if (!revokeAllBreakProjections(context)) return false;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return true;
        cancelStaleTimerNotifications(context, manager);
        // Upgrade cleanup for the original untagged notification.
        manager.cancel(NOTIFICATION_ID);
        return true;
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
                if (!revokeBreakProjection(context, active.getNotification().extras.getString(EXTRA_UPDATE_KEY))) continue;
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
        // Every break needs a one-shot cleanup wake so an OEM cannot leave its
        // countdown running below zero. The flag only controls whether that
        // wake replaces the timer with a return reminder or removes it.
        return KIND_BREAK.equals(kind);
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

    private static boolean timelineContainsEvent(AutomaticContinuationTimeline timeline, String eventId, long scheduledAtEpochMs) {
        for (AutomaticContinuationTimeline.Phase phase : timeline.phases()) {
            if (eventId.equals(phase.eventId) && scheduledAtEpochMs == phase.startsAtEpochMs) return true;
        }
        return false;
    }

    private static String automaticTag(String authorizationId) {
        return "automatic-continuation:" + authorizationId;
    }

    private static void cancelAutomaticTimelineNotification(Context context, String authorizationId) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.cancel(automaticTag(authorizationId), NOTIFICATION_ID);
    }

    static int automaticContinuationRequestCode(String eventId) {
        return eventId == null ? 0 : eventId.hashCode();
    }

    static boolean shouldUseInexactAutomaticAlarm(boolean exactAvailable, boolean exactRequestDenied) {
        return !exactAvailable || exactRequestDenied;
    }

    static boolean shouldQueueAutomaticEvent(boolean authorizationRevoked, boolean acknowledged) {
        return !authorizationRevoked && !acknowledged;
    }

    static boolean shouldPublishAutomaticEvent(boolean authorizationRevoked, boolean acknowledged, boolean durableDueMatches) {
        return !authorizationRevoked && !acknowledged && durableDueMatches;
    }

    static boolean shouldExposeAutomaticEvent(boolean authorizationRevoked, boolean acknowledged, boolean due) {
        return !authorizationRevoked && !acknowledged && due;
    }

    private static SharedPreferences automaticPreferences(Context context) {
        return context.getSharedPreferences(AUTO_PREFERENCES, Context.MODE_PRIVATE);
    }

    private static SharedPreferences breakPresentationPreferences(Context context) {
        return context.getSharedPreferences(BREAK_PRESENTATION_PREFERENCES, Context.MODE_PRIVATE);
    }

    private static String breakProjectionKey(String updateKey) {
        return BREAK_PRESENTATION_PREFIX + updateKey;
    }

    private static BreakReminderProjection readBreakProjection(SharedPreferences preferences, String updateKey) {
        return BreakReminderProjection.parse(preferences.getString(breakProjectionKey(updateKey), null));
    }

    private static boolean persistBreakProjection(Context context, String updateKey, BreakReminderProjection projection) {
        if (updateKey == null || updateKey.isEmpty() || projection == null) return false;
        return breakPresentationPreferences(context).edit()
            .putString(breakProjectionKey(updateKey), projection.encode()).commit();
    }

    private static boolean revokeBreakProjection(Context context, String updateKey) {
        if (updateKey == null || updateKey.isEmpty()) return true;
        SharedPreferences preferences = breakPresentationPreferences(context);
        BreakReminderProjection current = readBreakProjection(preferences, updateKey);
        if (current != null && !preferences.edit()
            .putString(breakProjectionKey(updateKey), current.dismiss().encode()).commit()) return false;
        cancelBreakDeadline(context, updateKey);
        cancelBreakDismissIntent(context, updateKey);
        return true;
    }

    private static boolean revokeOtherBreakProjections(Context context, String retainedUpdateKey) {
        SharedPreferences preferences = breakPresentationPreferences(context);
        SharedPreferences.Editor editor = preferences.edit();
        java.util.ArrayList<String> revoked = new java.util.ArrayList<>();
        for (Map.Entry<String, ?> entry : preferences.getAll().entrySet()) {
            if (!entry.getKey().startsWith(BREAK_PRESENTATION_PREFIX) || !(entry.getValue() instanceof String)) continue;
            String key = entry.getKey().substring(BREAK_PRESENTATION_PREFIX.length());
            if (key.equals(retainedUpdateKey)) continue;
            BreakReminderProjection record = BreakReminderProjection.parse((String) entry.getValue());
            if (record == null || record.stage == BreakReminderProjection.Stage.DISMISSED) continue;
            editor.putString(entry.getKey(), record.dismiss().encode());
            revoked.add(key);
        }
        if (revoked.isEmpty()) return true;
        if (!editor.commit()) return false;
        for (String key : revoked) {
            cancelBreakDeadline(context, key);
            cancelBreakDismissIntent(context, key);
        }
        return true;
    }

    private static boolean revokeAllBreakProjections(Context context) {
        return revokeOtherBreakProjections(context, "");
    }

    static void restoreBreakReminderProjections(Context context) {
        synchronized (TIMER_LOCK) {
            SharedPreferences preferences = breakPresentationPreferences(context);
            for (Map.Entry<String, ?> entry : preferences.getAll().entrySet()) {
                if (!entry.getKey().startsWith(BREAK_PRESENTATION_PREFIX) || !(entry.getValue() instanceof String)) continue;
                String updateKey = entry.getKey().substring(BREAK_PRESENTATION_PREFIX.length());
                BreakReminderProjection projection = BreakReminderProjection.parse((String) entry.getValue());
                if (updateKey.isEmpty() || projection == null || projection.stage == BreakReminderProjection.Stage.DISMISSED) continue;
                long now = System.currentTimeMillis();
                NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                StatusBarNotification active = manager == null ? null : activeTimerNotification(manager, updateKey);
                boolean reminderAlreadyVisible = active != null
                    && active.getNotification().extras.getBoolean(EXTRA_DEADLINE_REMINDER, false);
                if (!reminderAlreadyVisible && projection.stage == BreakReminderProjection.Stage.PENDING) {
                    // Refresh extras on an older countdown's shared PendingIntent.
                    breakCountdownDismissPendingIntent(context, updateKey, projection.endsAtEpochMs);
                }
                if (projection.stage == BreakReminderProjection.Stage.REMINDER || projection.isDue(now)) {
                    presentBreakReminderLocked(context, updateKey, projection, now);
                }
                else scheduleBreakDeadline(context, updateKey, projection.endsAtEpochMs, true);
            }
        }
    }

    private static void presentBreakReminderLocked(
        Context context, String updateKey, BreakReminderProjection projection, long nowEpochMs
    ) {
        BreakReminderProjection dueProjection = projection.asReminder(nowEpochMs);
        if (dueProjection == null || !persistBreakProjection(context, updateKey, dueProjection)) {
            scheduleBreakReminderRetry(context, updateKey, projection.endsAtEpochMs, nowEpochMs);
            return;
        }
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            scheduleBreakReminderRetry(context, updateKey, projection.endsAtEpochMs, nowEpochMs);
            return;
        }
        StatusBarNotification active = activeTimerNotification(manager, updateKey);
        if (active != null && active.getNotification().extras.getBoolean(EXTRA_DEADLINE_REMINDER, false)) return;
        Notification reminder = buildBreakDeadlineReminder(context, updateKey, dueProjection.endsAtEpochMs, nowEpochMs);
        try {
            ensureChannel(manager);
            manager.notify(timerTag(updateKey), NOTIFICATION_ID, reminder);
        } catch (RuntimeException error) {
            Log.w(TAG, "Unable to post durable break deadline reminder", error);
            scheduleBreakReminderRetry(context, updateKey, projection.endsAtEpochMs, nowEpochMs);
        }
    }

    private static void scheduleBreakReminderRetry(Context context, String updateKey, long endsAtEpochMs, long nowEpochMs) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
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
        long retryAt = Math.max(nowEpochMs + 60_000L, System.currentTimeMillis() + 60_000L);
        try {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, retryAt, pending);
        } catch (RuntimeException error) {
            try {
                alarms.set(AlarmManager.RTC_WAKEUP, retryAt, pending);
            } catch (RuntimeException fallbackError) {
                Log.w(TAG, "Unable to schedule reminder retry", fallbackError);
            }
        }
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

    private static AutomaticContinuationTimeline readAutomaticTimeline(JSONObject record, String authorizationId) {
        if (record == null || !authorizationId.equals(record.optString("authorizationId", ""))) return null;
        org.json.JSONArray encoded = record.optJSONArray("phases");
        if (encoded == null || encoded.length() > AutomaticContinuationTimeline.MAX_PHASES) return null;
        java.util.ArrayList<AutomaticContinuationTimeline.Phase> phases = new java.util.ArrayList<>();
        for (int index = 0; index < encoded.length(); index++) {
            JSONObject phase = encoded.optJSONObject(index);
            if (phase == null) return null;
            String kind = phase.optString("kind", "");
            String eventId = phase.optString("eventId", "");
            int round = phase.optInt("round", 0);
            if ("focus".equals(kind)
                && (eventId.isEmpty() || !eventId.equals(authorizationId + ":round:" + round))) return null;
            phases.add(new AutomaticContinuationTimeline.Phase(
                kind,
                phase.optLong("startsAtEpochMs", 0L),
                phase.optLong("endsAtEpochMs", 0L),
                round,
                eventId
            ));
        }
        return AutomaticContinuationTimeline.of(phases);
    }

    private static JSONObject automaticTimelineRecord(
        String authorizationId,
        AutomaticContinuationTimeline timeline,
        String projectTitle,
        String taskTitle
    ) {
        JSONObject record = new JSONObject();
        org.json.JSONArray phases = new org.json.JSONArray();
        try {
            for (AutomaticContinuationTimeline.Phase phase : timeline.phases()) {
                JSONObject encoded = new JSONObject();
                encoded.put("kind", phase.kind);
                encoded.put("startsAtEpochMs", phase.startsAtEpochMs);
                encoded.put("endsAtEpochMs", phase.endsAtEpochMs);
                encoded.put("round", phase.round);
                if (!phase.eventId.isEmpty()) encoded.put("eventId", phase.eventId);
                phases.put(encoded);
            }
            record.put("authorizationId", authorizationId);
            record.put("phases", phases);
            record.put("projectTitle", cleanTitle(projectTitle));
            record.put("taskTitle", cleanTitle(taskTitle));
            return record;
        } catch (JSONException error) {
            throw new IllegalStateException("Unable to encode automatic continuation timeline", error);
        }
    }

    private static String automaticAuthorizationKey(String authorizationId) {
        return AUTO_AUTHORIZATION_PREFIX + authorizationId;
    }

    private static String automaticRevocationKey(String authorizationId) {
        return AUTO_REVOKED_PREFIX + authorizationId;
    }

    private static String automaticAcknowledgementKey(String eventId) {
        return AUTO_ACK_PREFIX + eventId;
    }

    private static AutomaticDeadlineResult scheduleAutomaticContinuation(
        Context context,
        String eventId,
        String authorizationId,
        long scheduledAtEpochMs,
        JSONObject timelineValue
    ) {
        if (!validAutomaticContinuationEvent(eventId, authorizationId, scheduledAtEpochMs)) {
            return new AutomaticDeadlineResult(false, false, false);
        }
        synchronized (AUTO_CONTINUATION_LOCK) {
            SharedPreferences preferences = automaticPreferences(context);
            if (!shouldQueueAutomaticEvent(
                preferences.getBoolean(automaticRevocationKey(authorizationId), false),
                preferences.getBoolean(automaticAcknowledgementKey(eventId), false)
            )) {
                return new AutomaticDeadlineResult(false, false, false);
            }
            if (timelineValue != null) {
                AutomaticContinuationTimeline timeline = readAutomaticTimeline(timelineValue, authorizationId);
                if (timeline == null || !timelineContainsEvent(timeline, eventId, scheduledAtEpochMs)) {
                    return new AutomaticDeadlineResult(false, false, false);
                }
                JSONObject record = automaticTimelineRecord(
                    authorizationId,
                    timeline,
                    timelineValue.optString("projectTitle", ""),
                    timelineValue.optString("taskTitle", "")
                );
                SharedPreferences.Editor editor = preferences.edit()
                    .putString(automaticAuthorizationKey(authorizationId), record.toString());
                java.util.HashSet<String> retainedEventIds = new java.util.HashSet<>();
                long now = System.currentTimeMillis();
                boolean due = false;
                for (AutomaticContinuationTimeline.Phase phase : timeline.phases()) {
                    if (!"focus".equals(phase.kind) || phase.eventId.isEmpty()) continue;
                    if (!phase.eventId.startsWith(authorizationId + ":round:")) return new AutomaticDeadlineResult(false, false, false);
                    retainedEventIds.add(phase.eventId);
                    if (preferences.getBoolean(automaticAcknowledgementKey(phase.eventId), false)) {
                        editor.remove(automaticEventKey(phase.eventId));
                        continue;
                    }
                    JSONObject old = readAutomaticEvent(preferences, phase.eventId);
                    boolean alreadyDue = old != null && authorizationId.equals(old.optString("authorizationId", ""))
                        && phase.startsAtEpochMs == old.optLong("scheduledAtEpochMs", -1L)
                        && old.optBoolean("due", false);
                    boolean phaseDue = phase.startsAtEpochMs <= now;
                    due |= phaseDue;
                    editor.putString(automaticEventKey(phase.eventId), automaticEvent(
                        phase.eventId, authorizationId, phase.startsAtEpochMs, alreadyDue || phaseDue
                    ).toString());
                }
                for (Map.Entry<String, ?> entry : preferences.getAll().entrySet()) {
                    if (!entry.getKey().startsWith(AUTO_EVENT_PREFIX) || !(entry.getValue() instanceof String)) continue;
                    try {
                        JSONObject old = new JSONObject((String) entry.getValue());
                        if (!authorizationId.equals(old.optString("authorizationId", ""))) continue;
                        String oldId = old.optString("eventId", "");
                        if (!retainedEventIds.contains(oldId) && !old.optBoolean("due", false)) editor.remove(entry.getKey());
                    } catch (JSONException error) {
                        // Leave malformed entries for the existing pending reader to ignore.
                    }
                }
                if (!editor.commit()) return new AutomaticDeadlineResult(false, false, due);
                long nextBoundary = timeline.nextBoundaryAfter(now);
                AutomaticDeadlineResult alarm = nextBoundary > 0L
                    ? scheduleAutomaticTimelineAlarm(context, authorizationId, nextBoundary)
                    : AutomaticDeadlineResult.none();
                if (nextBoundary == 0L) cancelAutomaticTimelineAlarm(context, authorizationId);
                for (AutomaticContinuationTimeline.Phase phase : timeline.dueFocusPhases(now)) {
                    JSONObject queued = readAutomaticEvent(preferences, phase.eventId);
                    if (queued != null && queued.optBoolean("due", false)) publishAutomaticContinuationDue(queued);
                }
                return new AutomaticDeadlineResult(alarm.scheduled, alarm.exact, due);
            }
            JSONObject existing = readAutomaticEvent(preferences, eventId);
            if (preferences.getBoolean(automaticAcknowledgementKey(eventId), false)) {
                return new AutomaticDeadlineResult(false, false, false);
            }
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
        boolean exactAvailable = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && alarms.canScheduleExactAlarms();
        boolean exactDenied = false;
        try {
            if (exactAvailable) {
                try {
                    alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, scheduledAtEpochMs, pending);
                    return true;
                } catch (SecurityException deniedExactAlarm) {
                    exactDenied = true;
                    Log.i(TAG, "Exact automatic continuation alarm unavailable; using inexact idle alarm");
                }
            }
            if (!shouldUseInexactAutomaticAlarm(exactAvailable, exactDenied)) return false;
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

    private static int automaticTimelineRequestCode(String authorizationId) {
        return AUTO_TIMELINE_REQUEST_OFFSET ^ (authorizationId == null ? 0 : authorizationId.hashCode());
    }

    private static Intent automaticTimelineIntent(Context context, String authorizationId) {
        return new Intent(context, BreakDeadlineReceiver.class)
            .setAction(ACTION_AUTO_TIMELINE_BOUNDARY)
            .setData(Uri.parse("blockcolc://automatic-timeline/" + authorizationId))
            .putExtra(AUTO_AUTHORIZATION_ID, authorizationId);
    }

    private static AutomaticDeadlineResult scheduleAutomaticTimelineAlarm(Context context, String authorizationId, long atEpochMs) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null || cleanAutomaticId(authorizationId).isEmpty() || atEpochMs <= 0L) {
            return AutomaticDeadlineResult.none();
        }
        cancelAutomaticTimelineAlarm(context, authorizationId);
        PendingIntent pending = PendingIntent.getBroadcast(
            context,
            automaticTimelineRequestCode(authorizationId),
            automaticTimelineIntent(context, authorizationId),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        boolean exactAvailable = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && alarms.canScheduleExactAlarms();
        boolean exactDenied = false;
        try {
            if (exactAvailable) {
                try {
                    alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atEpochMs, pending);
                    return new AutomaticDeadlineResult(true, true, false);
                } catch (SecurityException deniedExactAlarm) {
                    exactDenied = true;
                    Log.i(TAG, "Exact automatic timeline alarm unavailable; using inexact idle alarm");
                }
            }
            if (!shouldUseInexactAutomaticAlarm(exactAvailable, exactDenied)) return AutomaticDeadlineResult.none();
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atEpochMs, pending);
            return new AutomaticDeadlineResult(true, false, false);
        } catch (RuntimeException error) {
            Log.w(TAG, "Unable to schedule automatic timeline boundary", error);
            cancelAutomaticTimelineAlarm(context, authorizationId);
            return AutomaticDeadlineResult.none();
        }
    }

    private static void cancelAutomaticTimelineAlarm(Context context, String authorizationId) {
        if (cleanAutomaticId(authorizationId).isEmpty()) return;
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pending = PendingIntent.getBroadcast(
            context,
            automaticTimelineRequestCode(authorizationId),
            automaticTimelineIntent(context, authorizationId),
            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE
        );
        if (pending == null) return;
        if (alarms != null) alarms.cancel(pending);
        pending.cancel();
    }

    private static boolean removeAutomaticEvent(Context context, String eventId) {
        synchronized (AUTO_CONTINUATION_LOCK) {
            SharedPreferences preferences = automaticPreferences(context);
            if (!preferences.edit().putBoolean(automaticAcknowledgementKey(eventId), true)
                .remove(automaticEventKey(eventId)).commit()) return false;
            cancelAutomaticAlarm(context, eventId);
            return true;
        }
    }

    private static boolean removeAutomaticEventsForAuthorization(Context context, String authorizationId) {
        synchronized (AUTO_CONTINUATION_LOCK) {
            SharedPreferences preferences = automaticPreferences(context);
            Map<String, ?> values = preferences.getAll();
            SharedPreferences.Editor editor = preferences.edit();
            editor.putBoolean(automaticRevocationKey(authorizationId), true);
            editor.remove(automaticAuthorizationKey(authorizationId));
            java.util.ArrayList<String> eventIds = new java.util.ArrayList<>();
            for (Map.Entry<String, ?> entry : values.entrySet()) {
                if (!entry.getKey().startsWith(AUTO_EVENT_PREFIX) || !(entry.getValue() instanceof String)) continue;
                try {
                    JSONObject event = new JSONObject((String) entry.getValue());
                    if (!authorizationId.equals(event.optString("authorizationId", ""))) continue;
                    String eventId = event.optString("eventId", "");
                    eventIds.add(eventId);
                    editor.remove(entry.getKey());
                } catch (JSONException error) {
                    editor.remove(entry.getKey());
                }
            }
            if (!editor.commit()) return false;
            for (String eventId : eventIds) cancelAutomaticAlarm(context, eventId);
            return true;
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
                    String eventId = cleanAutomaticId(event.optString("eventId", ""));
                    String authorizationId = cleanAutomaticId(event.optString("authorizationId", ""));
                    if (shouldExposeAutomaticEvent(
                        preferences.getBoolean(automaticRevocationKey(authorizationId), false),
                        preferences.getBoolean(automaticAcknowledgementKey(eventId), false),
                        event.optBoolean("due", false)
                    )) due.add(event);
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

    static void onAutomaticTimelineBoundary(Context context, Intent intent) {
        if (intent == null || !ACTION_AUTO_TIMELINE_BOUNDARY.equals(intent.getAction())) return;
        String authorizationId = cleanAutomaticId(intent.getStringExtra(AUTO_AUTHORIZATION_ID));
        if (authorizationId.isEmpty()) return;
        java.util.ArrayList<JSONObject> dueEvents = new java.util.ArrayList<>();
        boolean timelineRetired = false;
        synchronized (AUTO_CONTINUATION_LOCK) {
            SharedPreferences preferences = automaticPreferences(context);
            if (preferences.getBoolean(automaticRevocationKey(authorizationId), false)) return;
            JSONObject record = safeAutomaticTimeline(preferences, authorizationId);
            if (record == null) return;
            AutomaticContinuationTimeline timeline = readAutomaticTimeline(record, authorizationId);
            if (timeline == null) {
                Log.w(TAG, "Ignoring malformed automatic continuation timeline");
                return;
            }
            long now = System.currentTimeMillis();
            SharedPreferences.Editor editor = preferences.edit();
            for (AutomaticContinuationTimeline.Phase phase : timeline.dueFocusPhases(now)) {
                JSONObject queued = readAutomaticEvent(preferences, phase.eventId);
                if (preferences.getBoolean(automaticAcknowledgementKey(phase.eventId), false)) {
                    editor.remove(automaticEventKey(phase.eventId));
                    continue;
                }
                if (queued == null || !authorizationId.equals(queued.optString("authorizationId", ""))
                    || phase.startsAtEpochMs != queued.optLong("scheduledAtEpochMs", -1L)) continue;
                if (!queued.optBoolean("due", false)) {
                    queued = automaticEvent(phase.eventId, authorizationId, phase.startsAtEpochMs, true);
                    editor.putString(automaticEventKey(phase.eventId), queued.toString());
                }
                dueEvents.add(queued);
            }
            long nextBoundary = timeline.nextBoundaryAfter(now);
            boolean hasPhase = timeline.phaseAt(now) != null;
            if (nextBoundary == 0L && !hasPhase) {
                editor.remove(automaticAuthorizationKey(authorizationId));
                if (!editor.commit()) {
                    scheduleAutomaticTimelineAlarm(context, authorizationId, now + 60_000L);
                    return;
                }
                cancelAutomaticTimelineAlarm(context, authorizationId);
                timelineRetired = true;
            } else if (!editor.commit()) {
                // Retain the authorization and retry its current absolute phase;
                // no due event is emitted until its durable write succeeds.
                scheduleAutomaticTimelineAlarm(context, authorizationId, now + 60_000L);
                return;
            } else if (nextBoundary > 0L) {
                scheduleAutomaticTimelineAlarm(context, authorizationId, nextBoundary);
            }
        }
        if (timelineRetired) {
            synchronized (TIMER_LOCK) { cancelAutomaticTimelineNotification(context, authorizationId); }
        } else {
            renderAutomaticTimeline(context, authorizationId);
        }
        for (JSONObject event : dueEvents) publishAutomaticContinuationDue(event);
    }

    private static JSONObject safeAutomaticTimeline(SharedPreferences preferences, String authorizationId) {
        try {
            String raw = preferences.getString(automaticAuthorizationKey(authorizationId), null);
            return raw == null ? null : new JSONObject(raw);
        } catch (JSONException error) {
            Log.w(TAG, "Ignoring malformed automatic continuation authorization", error);
            return null;
        }
    }

    private static void renderAutomaticTimeline(Context context, String authorizationId) {
        // Lock order is TIMER_LOCK -> AUTO_CONTINUATION_LOCK only. Revocation
        // writes its tombstone under AUTO_CONTINUATION_LOCK, releases it, then
        // clears the notification under TIMER_LOCK.
        synchronized (TIMER_LOCK) {
            synchronized (AUTO_CONTINUATION_LOCK) {
                SharedPreferences preferences = automaticPreferences(context);
                if (preferences.getBoolean(automaticRevocationKey(authorizationId), false)) {
                    cancelAutomaticTimelineNotification(context, authorizationId);
                    return;
                }
                JSONObject record = safeAutomaticTimeline(preferences, authorizationId);
                AutomaticContinuationTimeline timeline = readAutomaticTimeline(record, authorizationId);
                NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                if (manager == null) return;
                AutomaticContinuationTimeline.Phase phase = timeline == null ? null : timeline.phaseAt(System.currentTimeMillis());
                if (phase == null) {
                    if (timeline != null && timeline.nextBoundaryAfter(System.currentTimeMillis()) > 0L) return;
                    manager.cancel(automaticTag(authorizationId), NOTIFICATION_ID);
                    return;
                }
                // The native authorization now owns the single ongoing timer
                // surface until Web/domain recovery reconciles or revokes it.
                cancelStaleTimerNotifications(context, manager);
                ensureChannel(manager);
                boolean focus = "focus".equals(phase.kind);
                String projectTitle = cleanTitle(record.optString("projectTitle", ""));
                String taskTitle = cleanTitle(record.optString("taskTitle", ""));
                String title = focus ? "专注中" : "休息中";
                String round = "第 " + phase.round + " 轮";
                String summary = focus
                    ? (taskTitle.isEmpty() ? projectTitle : taskTitle)
                    : "休息中 · " + round + (taskTitle.isEmpty() ? "" : " · 下一项 " + taskTitle);
                if (summary.isEmpty()) summary = focus ? "方块建造中" : round;
                String detail = focus
                    ? "▣ 自动连续专注\n" + (projectTitle.isEmpty() ? "" : "项目 · " + projectTitle + "\n")
                        + "当前 · " + summary + "\n保持节奏，本轮结束后材料送达。"
                    : "休息中\n" + round + (taskTitle.isEmpty() ? "" : "\n下一项 · " + taskTitle);
                Intent openIntent = new Intent(context, MainActivity.class)
                    .setAction(focus ? "com.blockcolc.app.action.OPEN_FOCUS" : "com.blockcolc.app.action.OPEN_BREAK")
                    .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                PendingIntent openPending = PendingIntent.getActivity(context,
                    automaticTimelineRequestCode(authorizationId), openIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                Bundle extras = new Bundle();
                extras.putBoolean(EXTRA_REQUEST_PROMOTED_ONGOING, true);
                extras.putBoolean(EXTRA_OPLUS_SMALL_ICON_USE_APP_ICON, false);
                extras.putString(EXTRA_UPDATE_KEY, automaticTag(authorizationId));
                extras.putString(EXTRA_KIND, phase.kind);
                extras.putLong(EXTRA_ENDS_AT_EPOCH_MS, phase.endsAtEpochMs);
                NotificationCompat.Builder phaseBuilder = new NotificationCompat.Builder(context, CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_stat_tomato_outline)
                    .setContentTitle(title)
                    .setContentText(summary)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(detail))
                    .setSubText("▣ 方块钟 · " + round)
                    .setContentIntent(openPending)
                    .setWhen(phase.endsAtEpochMs)
                    .setShowWhen(true)
                    // API 23 keeps the authorized phase and its absolute end
                    // timestamp, but cannot display a countdown chronometer.
                    .setUsesChronometer(false)
                    // A denied exact alarm may be delivered after this phase.
                    // Expire the stale OS countdown rather than leave it negative;
                    // the durable timeline projects the current phase on wake-up.
                    .setTimeoutAfter(Math.max(1L, phase.endsAtEpochMs - System.currentTimeMillis()))
                    .setOngoing(true)
                    .setOnlyAlertOnce(true)
                    .setSilent(true)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
                    .setPriority(NotificationCompat.PRIORITY_LOW)
                    .setColor(0xFF276749)
                    .addExtras(extras);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    phaseBuilder.setUsesChronometer(true).setChronometerCountDown(true);
                }
                Notification notification = phaseBuilder.build();
                try {
                    manager.notify(automaticTag(authorizationId), NOTIFICATION_ID, notification);
                } catch (RuntimeException error) {
                    Log.w(TAG, "Unable to project automatic continuation phase", error);
                }
            }
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
                || preferences.getBoolean(automaticAcknowledgementKey(eventId), false)
                || preferences.getBoolean(automaticRevocationKey(authorizationId), false)
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
        java.util.ArrayList<String> render = new java.util.ArrayList<>();
        java.util.ArrayList<JSONObject> publish = new java.util.ArrayList<>();
        synchronized (AUTO_CONTINUATION_LOCK) {
            SharedPreferences preferences = automaticPreferences(context);
            Map<String, ?> values = preferences.getAll();
            for (Map.Entry<String, ?> entry : values.entrySet()) {
                if (!entry.getKey().startsWith(AUTO_AUTHORIZATION_PREFIX) || !(entry.getValue() instanceof String)) continue;
                String authorizationId = cleanAutomaticId(entry.getKey().substring(AUTO_AUTHORIZATION_PREFIX.length()));
                if (authorizationId.isEmpty() || preferences.getBoolean(automaticRevocationKey(authorizationId), false)) continue;
                JSONObject record;
                try { record = new JSONObject((String) entry.getValue()); }
                catch (JSONException error) { Log.w(TAG, "Ignoring malformed automatic continuation timeline", error); continue; }
                AutomaticContinuationTimeline timeline = readAutomaticTimeline(record, authorizationId);
                if (timeline == null) continue;
                long now = System.currentTimeMillis();
                SharedPreferences.Editor editor = preferences.edit();
                java.util.ArrayList<JSONObject> authorizationDue = new java.util.ArrayList<>();
                for (AutomaticContinuationTimeline.Phase phase : timeline.dueFocusPhases(now)) {
                    JSONObject queued = readAutomaticEvent(preferences, phase.eventId);
                    if (preferences.getBoolean(automaticAcknowledgementKey(phase.eventId), false)) {
                        editor.remove(automaticEventKey(phase.eventId));
                        continue;
                    }
                    if (queued == null || !authorizationId.equals(queued.optString("authorizationId", ""))
                        || phase.startsAtEpochMs != queued.optLong("scheduledAtEpochMs", -1L)) continue;
                    if (!queued.optBoolean("due", false)) {
                        queued = automaticEvent(phase.eventId, authorizationId, phase.startsAtEpochMs, true);
                        editor.putString(automaticEventKey(phase.eventId), queued.toString());
                    }
                    authorizationDue.add(queued);
                }
                long next = timeline.nextBoundaryAfter(now);
                if (next == 0L && timeline.phaseAt(now) == null) editor.remove(entry.getKey());
                if (!editor.commit()) {
                    scheduleAutomaticTimelineAlarm(context, authorizationId, now + 60_000L);
                    continue;
                }
                publish.addAll(authorizationDue);
                if (next > 0L) scheduleAutomaticTimelineAlarm(context, authorizationId, next);
                else if (timeline.phaseAt(now) == null) cancelAutomaticTimelineAlarm(context, authorizationId);
                else scheduleAutomaticTimelineAlarm(context, authorizationId, now + 60_000L);
                render.add(authorizationId);
            }
            values = preferences.getAll();
            for (Map.Entry<String, ?> entry : values.entrySet()) {
                if (!entry.getKey().startsWith(AUTO_EVENT_PREFIX) || !(entry.getValue() instanceof String)) continue;
                try {
                    JSONObject event = new JSONObject((String) entry.getValue());
                    String eventId = cleanAutomaticId(event.optString("eventId", ""));
                    String authorizationId = cleanAutomaticId(event.optString("authorizationId", ""));
                    long scheduledAt = event.optLong("scheduledAtEpochMs", 0L);
                    if (!validAutomaticContinuationEvent(eventId, authorizationId, scheduledAt)) continue;
                    if (preferences.getBoolean(automaticAcknowledgementKey(eventId), false)) {
                        preferences.edit().remove(automaticEventKey(eventId)).commit();
                        continue;
                    }
                    if (safeAutomaticTimeline(preferences, authorizationId) != null) continue;
                    if (preferences.getBoolean(automaticRevocationKey(authorizationId), false)) continue;
                    if (deadlineReached(scheduledAt, System.currentTimeMillis())) {
                        JSONObject due = automaticEvent(eventId, authorizationId, scheduledAt, true);
                        if (preferences.edit().putString(automaticEventKey(eventId), due.toString()).commit()) publish.add(due);
                    } else if (!event.optBoolean("due", false)) {
                        scheduleAutomaticAlarm(context, eventId, authorizationId, scheduledAt);
                    }
                } catch (JSONException error) {
                    Log.w(TAG, "Ignoring malformed automatic continuation event during restore", error);
                }
            }
        }
        for (String authorizationId : render) renderAutomaticTimeline(context, authorizationId);
        for (JSONObject event : publish) publishAutomaticContinuationDue(event);
    }

    private static void publishAutomaticContinuationDue(JSONObject event) {
        String eventId = cleanAutomaticId(event.optString("eventId", ""));
        String authorizationId = cleanAutomaticId(event.optString("authorizationId", ""));
        long scheduledAt = event.optLong("scheduledAtEpochMs", 0L);
        if (!validAutomaticContinuationEvent(eventId, authorizationId, scheduledAt)) return;
        new Handler(Looper.getMainLooper()).post(() -> {
            BreakLiveUpdatePlugin plugin = activePlugin == null ? null : activePlugin.get();
            if (plugin == null) return;
            synchronized (AUTO_CONTINUATION_LOCK) {
                SharedPreferences preferences = automaticPreferences(plugin.getContext());
                JSONObject current = readAutomaticEvent(preferences, eventId);
                boolean durableDueMatches = current != null
                    && authorizationId.equals(current.optString("authorizationId", ""))
                    && current.optLong("scheduledAtEpochMs", -1L) == scheduledAt
                    && current.optBoolean("due", false);
                if (!shouldPublishAutomaticEvent(
                    preferences.getBoolean(automaticRevocationKey(authorizationId), false),
                    preferences.getBoolean(automaticAcknowledgementKey(eventId), false),
                    durableDueMatches
                )) return;
                JSObject payload = new JSObject();
                payload.put("eventId", eventId);
                payload.put("authorizationId", authorizationId);
                payload.put("scheduledAtEpochMs", scheduledAt);
                plugin.notifyListeners(AUTO_DUE_EVENT, payload);
            }
        });
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
            .putExtra(EXTRA_RETURN_TO_FOCUS, returnToFocus)
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
            // If the idle-alarm API is rejected by an OEM policy, make one
            // ordinary inexact wake-up attempt. It may be later, but the
            // durable receipt + timeout keep the countdown bounded and allow
            // the receiver to restore the reminder when it can run.
            try {
                alarms.set(AlarmManager.RTC_WAKEUP, endsAtEpochMs, pending);
                Log.i(TAG, "Break idle alarm unavailable; using ordinary inexact wake-up");
                return new DeadlineAlarmResult(true, false);
            } catch (RuntimeException fallbackError) {
                Log.w(TAG, "Unable to schedule break deadline alarm", fallbackError);
                cancelBreakDeadline(context, updateKey);
                return DeadlineAlarmResult.none();
            }
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

    private static PendingIntent breakCountdownDismissPendingIntent(Context context, String updateKey, long endsAtEpochMs) {
        if (updateKey == null || updateKey.isEmpty()) return null;
        Intent intent = dismissalIntent(context, updateKey, BreakReminderProjection.Stage.PENDING)
            .putExtra(EXTRA_ENDS_AT_EPOCH_MS, endsAtEpochMs);
        return PendingIntent.getBroadcast(
            context,
            dismissalRequestCode(updateKey, BreakReminderProjection.Stage.PENDING),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static PendingIntent breakReminderDismissPendingIntent(Context context, String updateKey, long endsAtEpochMs) {
        if (updateKey == null || updateKey.isEmpty()) return null;
        Intent intent = dismissalIntent(context, updateKey, BreakReminderProjection.Stage.REMINDER)
            .putExtra(EXTRA_ENDS_AT_EPOCH_MS, endsAtEpochMs);
        return PendingIntent.getBroadcast(
            context,
            dismissalRequestCode(updateKey, BreakReminderProjection.Stage.REMINDER),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    static String dismissalActionForStage(BreakReminderProjection.Stage stage) {
        return stage == BreakReminderProjection.Stage.REMINDER
            ? ACTION_BREAK_REMINDER_DISMISSED : ACTION_BREAK_COUNTDOWN_DISMISSED;
    }

    static int dismissalRequestCode(String updateKey, BreakReminderProjection.Stage stage) {
        return deadlineRequestCode(updateKey) + (stage == BreakReminderProjection.Stage.REMINDER ? 2 : 1);
    }

    static String dismissalDataForStage(String updateKey, BreakReminderProjection.Stage stage) {
        String name = stage == BreakReminderProjection.Stage.REMINDER ? "reminder" : "countdown";
        try {
            String encodedKey = URLEncoder.encode(updateKey == null ? "" : updateKey, "UTF-8").replace("+", "%20");
            return "blockcolc://break-dismiss/" + name + "/" + encodedKey;
        } catch (java.io.UnsupportedEncodingException impossible) {
            throw new AssertionError("UTF-8 is required by the Java runtime", impossible);
        }
    }

    private static Intent dismissalIntent(Context context, String updateKey, BreakReminderProjection.Stage stage) {
        return deadlineIntent(context, dismissalActionForStage(stage), updateKey)
            .setData(Uri.parse(dismissalDataForStage(updateKey, stage)));
    }

    private static void cancelBreakDismissIntent(Context context, String updateKey) {
        if (updateKey == null || updateKey.isEmpty()) return;
        cancelBreakDismissIntent(context, updateKey, BreakReminderProjection.Stage.PENDING, false);
        cancelBreakDismissIntent(context, updateKey, BreakReminderProjection.Stage.REMINDER, false);
        // Cancel the original shared identity so an in-flight pre-upgrade
        // token cannot survive a new authorization or explicit revocation.
        cancelBreakDismissIntent(context, updateKey, null, true);
    }

    private static void cancelBreakDismissIntent(
        Context context, String updateKey, BreakReminderProjection.Stage stage, boolean legacy
    ) {
        String action = legacy ? ACTION_BREAK_DISMISSED : dismissalActionForStage(stage);
        int requestCode = legacy ? deadlineRequestCode(updateKey) + 1 : dismissalRequestCode(updateKey, stage);
        PendingIntent pending = PendingIntent.getBroadcast(
            context,
            requestCode,
            legacy ? deadlineIntent(context, action, updateKey) : dismissalIntent(context, updateKey, stage),
            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE
        );
        if (pending != null) pending.cancel();
    }

    static void onBreakDeadline(Context context, Intent intent) {
        synchronized (TIMER_LOCK) {
            onBreakDeadlineLocked(context, intent);
        }
    }

    private static void onBreakDeadlineLocked(Context context, Intent intent) {
        if (intent == null) return;
        String updateKey = cleanUpdateKey(intent.getStringExtra(EXTRA_UPDATE_KEY));
        String dismissalAction = intent.getAction();
        if (ACTION_BREAK_COUNTDOWN_DISMISSED.equals(dismissalAction)
            || ACTION_BREAK_REMINDER_DISMISSED.equals(dismissalAction)
            || ACTION_BREAK_DISMISSED.equals(dismissalAction)) {
            BreakReminderProjection projection = readBreakProjection(breakPresentationPreferences(context), updateKey);
            long requestedEndsAt = intent.getLongExtra(EXTRA_ENDS_AT_EPOCH_MS, 0L);
            long now = System.currentTimeMillis();
            boolean accepted = projection != null && (ACTION_BREAK_REMINDER_DISMISSED.equals(dismissalAction)
                ? projection.acceptsReminderDismissal(requestedEndsAt)
                : projection.acceptsCountdownDismissal(requestedEndsAt, now));
            if (accepted) {
                revokeBreakProjection(context, updateKey);
            }
            return;
        }
        if (!ACTION_BREAK_DEADLINE.equals(intent.getAction()) || updateKey.isEmpty()) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        SharedPreferences preferences = breakPresentationPreferences(context);
        BreakReminderProjection projection = readBreakProjection(preferences, updateKey);
        long endsAt = intent.getLongExtra(EXTRA_ENDS_AT_EPOCH_MS, 0L);
        if (projection == null) {
            StatusBarNotification active = activeTimerNotification(manager, updateKey);
            if (active == null) {
                cancelBreakDeadline(context, updateKey);
                return;
            }
            Bundle extras = active.getNotification().extras;
            if (!KIND_BREAK.equals(extras.getString(EXTRA_KIND))) {
                cancelBreakDeadline(context, updateKey);
                return;
            }
            boolean returnToFocus = extras.getBoolean(EXTRA_RETURN_TO_FOCUS, false);
            endsAt = extras.getLong(EXTRA_ENDS_AT_EPOCH_MS, endsAt);
            if (!returnToFocus) {
                if (!deadlineReached(endsAt, System.currentTimeMillis())) {
                    scheduleBreakDeadline(context, updateKey, endsAt, false);
                    return;
                }
                cancelBreakDeadline(context, updateKey);
                manager.cancel(timerTag(updateKey), NOTIFICATION_ID);
                return;
            }
            projection = BreakReminderProjection.pending(endsAt);
            if (!persistBreakProjection(context, updateKey, projection)) return;
        }
        if (projection.stage == BreakReminderProjection.Stage.DISMISSED) return;
        if (endsAt <= 0L) endsAt = projection.endsAtEpochMs;
        if (endsAt != projection.endsAtEpochMs) return; // Stale alarm after replacement/revocation.
        long now = System.currentTimeMillis();
        if (projection.stage == BreakReminderProjection.Stage.REMINDER) {
            cancelBreakDeadline(context, updateKey);
            presentBreakReminderLocked(context, updateKey, projection, now);
            return;
        }
        if (!deadlineReached(endsAt, now)) {
            // A wake-up can arrive a little early on some OEMs. Keep the same
            // absolute deadline and re-arm instead of presenting prematurely.
            scheduleBreakDeadline(context, updateKey, endsAt, true);
            return;
        }
        cancelBreakDeadline(context, updateKey);
        presentBreakReminderLocked(context, updateKey, projection, now);
    }

    private static Notification buildBreakDeadlineReminder(
        Context context,
        String updateKey,
        long endsAtEpochMs,
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
        extras.putLong(EXTRA_ENDS_AT_EPOCH_MS, endsAtEpochMs);
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
        PendingIntent dismissPendingIntent = breakReminderDismissPendingIntent(context, updateKey, endsAtEpochMs);
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
