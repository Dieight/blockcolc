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

        int completedRounds = boundedRound(call.getInt("completedRounds"));
        int totalRounds = boundedRound(call.getInt("totalRounds"));
        String nextTaskTitle = cleanTitle(call.getString("nextTaskTitle"));
        String roundText = completedRounds > 0 && totalRounds >= completedRounds
            ? String.format(Locale.SIMPLIFIED_CHINESE, "第 %d / %d 轮", completedRounds, totalRounds)
            : "本轮休息";
        String summary = nextTaskTitle.isEmpty() ? roundText : roundText + " · 下一项 " + nextTaskTitle;
        String details = nextTaskTitle.isEmpty() ? roundText : roundText + "\n下一项 · " + nextTaskTitle;

        Intent openIntent = new Intent(context, MainActivity.class)
            .setAction("com.blockcolc.app.action.OPEN_BREAK")
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPendingIntent = PendingIntent.getActivity(
            context,
            NOTIFICATION_ID,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        Intent skipIntent = new Intent(context, MainActivity.class)
            .setAction(MainActivity.ACTION_SKIP_BREAK)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent skipPendingIntent = PendingIntent.getActivity(
            context,
            NOTIFICATION_ID + 1,
            skipIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Bundle liveUpdateExtras = new Bundle();
        liveUpdateExtras.putBoolean(EXTRA_REQUEST_PROMOTED_ONGOING, true);
        Notification notification = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_blockcolc)
            .setContentTitle("休息中")
            .setContentText(summary)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(details))
            // ColorOS maps subText to the Fluid Cloud card's third line.
            .setSubText(summary)
            .setContentIntent(openPendingIntent)
            .addAction(0, "跳过休息", skipPendingIntent)
            .setWhen(endsAtEpochMs)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setTimeoutAfter(Math.max(1L, endsAtEpochMs - System.currentTimeMillis()))
            .addExtras(liveUpdateExtras)
            .build();
        try {
            boolean promotableCharacteristics = hasPromotableCharacteristics(notification);
            boolean canPostPromotedNotifications = canPostPromotedNotifications(manager);
            manager.notify(NOTIFICATION_ID, notification);
            boolean promoted = isActiveNotificationPromoted(manager);
            JSObject result = capabilityResult(context, manager, notification, promoted);
            Log.i(TAG, "show requested=true promotable=" + promotableCharacteristics
                + " allowed=" + canPostPromotedNotifications + " promoted=" + promoted);
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

    static void cancelNotification(Context context) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.cancel(NOTIFICATION_ID);
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
                && (active.getNotification().flags & FLAG_PROMOTED_ONGOING) != 0) return true;
        }
        return false;
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

    private static void ensureChannel(NotificationManager manager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel existing = manager.getNotificationChannel(CHANNEL_ID);
        if (existing != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "休息倒计时", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("多轮专注之间的实时休息倒计时");
        channel.setSound(null, null);
        channel.enableVibration(false);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(channel);
    }
}
