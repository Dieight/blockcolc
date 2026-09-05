package com.blockcolc.app;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.service.notification.StatusBarNotification;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Locale;

@CapacitorPlugin(name = "BreakLiveUpdate")
public class BreakLiveUpdatePlugin extends Plugin {
    static final int NOTIFICATION_ID = 42002;
    private static final String TAG = "BreakLiveUpdate";
    private static final String CHANNEL_ID = "blockcolc_break_live_v1";
    private static final String EXTRA_REQUEST_PROMOTED_ONGOING = "android.requestPromotedOngoing";
    private static final String EXTRA_OPLUS_SMALL_ICON_USE_APP_ICON = "oplus_smallicon_use_app_icon";
    private static final String EXTRA_UPDATE_KEY = "com.blockcolc.app.extra.LIVE_UPDATE_KEY";
    private static final String EXTRA_KIND = "com.blockcolc.app.extra.LIVE_UPDATE_KIND";
    private static final String KIND_FOCUS = "focus";
    private static final String KIND_BREAK = "break";
    private static final String ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS = "android.settings.APP_NOTIFICATION_PROMOTION_SETTINGS";
    private static final int FLAG_PROMOTED_ONGOING = 0x00040000;

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void show(PluginCall call) {
        Long endsAtEpochMs = call.getLong("endsAtEpochMs");
        if (endsAtEpochMs == null || endsAtEpochMs <= System.currentTimeMillis()) {
            cancelNotification(getContext());
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
            call.resolve(capabilityResult(context, manager, null, false));
            return;
        }
        ensureChannel(manager);

        String kind = cleanKind(call.getString("kind"));
        String updateKey = cleanUpdateKey(call.getString("updateKey"));
        StatusBarNotification matching = activeTimerNotification(manager, updateKey);
        if (matching != null) {
            Notification active = matching.getNotification();
            boolean promoted = isPromoted(active);
            Log.i(TAG, "show skipped=same-" + kind + " promoted=" + promoted);
            call.resolve(capabilityResult(context, manager, active, promoted));
            return;
        }
        // ColorOS/OxygenOS caches the AOD Fluid Cloud by StatusBarNotification
        // identity more aggressively than the shade. Keep retries for one timer
        // stable, but give every new focus/break timer a fresh tag so its icon,
        // copy and `when` countdown cannot be inherited from an older session.
        cancelStaleTimerNotifications(manager);

        int completedRounds = boundedRound(call.getInt("completedRounds"));
        int totalRounds = boundedRound(call.getInt("totalRounds"));
        String nextTaskTitle = cleanTitle(call.getString("nextTaskTitle"));
        String projectTitle = cleanTitle(call.getString("projectTitle"));
        String taskTitle = cleanTitle(call.getString("taskTitle"));
        boolean marathon = Boolean.TRUE.equals(call.getBoolean("marathon"));
        boolean focus = KIND_FOCUS.equals(kind);

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
            summary = nextTaskTitle.isEmpty() ? roundText : roundText + " · 下一项 " + nextTaskTitle;
            details = nextTaskTitle.isEmpty() ? roundText : roundText + "\n下一项 · " + nextTaskTitle;
            subText = summary;
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
            .setTimeoutAfter(Math.max(1L, endsAtEpochMs - System.currentTimeMillis()))
            .addExtras(liveUpdateExtras);
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
        Notification notification = builder.build();
        try {
            boolean promotableCharacteristics = hasPromotableCharacteristics(notification);
            boolean canPostPromotedNotifications = canPostPromotedNotifications(manager);
            manager.notify(timerTag(updateKey), NOTIFICATION_ID, notification);
            boolean promoted = isActiveNotificationPromoted(manager);
            JSObject result = capabilityResult(context, manager, notification, promoted);
            Log.i(TAG, "show requested=true promotable=" + promotableCharacteristics
                + " allowed=" + canPostPromotedNotifications + " promoted=" + promoted
                + " tag=" + timerTag(updateKey) + " when=" + notification.when
                + " icon=" + notification.getSmallIcon());
            call.resolve(result);
        } catch (SecurityException error) {
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
        call.resolve(capabilityResult(context, manager, null, false));
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
        cancelNotification(getContext());
        call.resolve();
    }

    @PluginMethod
    public void cancelKind(PluginCall call) {
        String requestedKind = cleanKind(call.getString("kind"));
        NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            StatusBarNotification active = activeTimerNotification(manager, null);
            if (active != null && sameKind(active.getNotification().extras.getString(EXTRA_KIND), requestedKind)) {
                cancelTimerNotification(manager, active);
            }
        }
        call.resolve();
    }

    static void cancelNotification(Context context) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        cancelStaleTimerNotifications(manager);
        // Upgrade cleanup for the original untagged notification.
        manager.cancel(NOTIFICATION_ID);
    }

    private static JSObject capabilityResult(
        Context context,
        NotificationManager manager,
        Notification notification,
        boolean promoted
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

    private static void cancelStaleTimerNotifications(NotificationManager manager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            manager.cancel(NOTIFICATION_ID);
            return;
        }
        try {
            for (StatusBarNotification active : manager.getActiveNotifications()) {
                if (active.getId() != NOTIFICATION_ID) continue;
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
