package com.blockcolc.app;

import android.app.NotificationManager;
import android.app.Notification;
import android.app.PendingIntent;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.Bundle;
import android.service.notification.StatusBarNotification;
import java.util.Locale;

/** Official SuperX local template adapter. No ADB, push tokens or private
 * permissions are requested. Scene authorization remains owned by OriginOS. */
final class OriginOsTimerSurface {
    private OriginOsTimerSurface() {}
    static boolean isOriginOs() {
        String manufacturer = Build.MANUFACTURER.toLowerCase(Locale.ROOT);
        return manufacturer.contains("vivo") || manufacturer.contains("iqoo");
    }
    static String scene(Context context) {
        try {
            ApplicationInfo info = context.getPackageManager().getApplicationInfo(context.getPackageName(), PackageManager.GET_META_DATA);
            return info.metaData == null ? "BLOCKCOLC_FOCUS" : info.metaData.getString("com.blockcolc.ORIGINOS_SCENE", "BLOCKCOLC_FOCUS");
        } catch (PackageManager.NameNotFoundException ignored) { return "BLOCKCOLC_FOCUS"; }
    }
    static boolean allowed(Context context) {
        if (!isOriginOs()) return false;
        try {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            try {
                // switchType 0 is Atomic Notification (not a user/profile id).
                return Boolean.TRUE.equals(manager.getClass().getMethod("getSceneStatus", String.class, String.class, int.class)
                    .invoke(manager, context.getPackageName(), scene(context), 0));
            } catch (NoSuchMethodException olderFirmware) {
                return Boolean.TRUE.equals(manager.getClass().getMethod("getSceneStatus", String.class, String.class)
                    .invoke(manager, context.getPackageName(), scene(context)));
            }
        } catch (ReflectiveOperationException | RuntimeException ignored) { return false; }
    }
    static boolean ownsTag(String tag,String expected) {
        return expected.equals(tag) || "VIVO_SUPERX_TAG".equals(tag);
    }
    static void end(NotificationManager manager, StatusBarNotification active) {
        Bundle previous=active.getNotification().extras;
        if(!isOriginOs()||previous==null||!previous.containsKey("notification.superx.scene")||!previous.containsKey("notification.superx.template"))return;
        // Newer firmware still routes END through scene/template validation.
        // Retain both, then retire the actual rewritten identity as well.
        Notification ended=active.getNotification().clone();ended.extras=new Bundle(previous);
        ended.extras.putInt("notification.superx.operation",2);
        ended.extras.putInt("notification.superx.keepDuration",0);
        try {manager.notify(active.getTag(),active.getId(),ended);}catch(RuntimeException ignored){}
    }
    static Bundle extras(Context context, PendingIntent open, String title, String content, String round) {
        Bundle extras = new Bundle();
        if (!allowed(context) || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return extras;
        Icon icon = Icon.createWithResource(context, R.drawable.ic_stat_tomato_outline);
        extras.putInt("notification.superx.operation", 0);
        extras.putBoolean("notification.superx.showNotify", true);
        extras.putBoolean("notification.superx.sound", false);
        extras.putBoolean("notification.superx.dismissWhenKill", false);
        extras.putInt("notification.superx.template", 4);
        extras.putString("notification.superx.scene", scene(context));
        extras.putParcelable("notification.superx.clickResp", open);
        Bundle base = new Bundle();
        base.putParcelable("notification.superx.baseInfos.icon", icon);
        base.putCharSequence("notification.superx.baseInfos.title", title);
        base.putCharSequence("notification.superx.baseInfos.content", content);
        base.putInt("notification.superx.baseInfos.subInfo", 1);
        base.putString("notification.superx.baseInfos.subText", round);
        extras.putBundle("notification.superx.baseInfos", base);
        extras.putBundle("notification.superx.infos", new Bundle());
        Bundle small = new Bundle();
        small.putParcelable("notification.superx.shortInfos.image", icon);
        small.putParcelable("notification.superx.shortInfos.imageClickResp", open);
        small.putString("notification.superx.shortInfos.describeShort", title);
        small.putString("notification.superx.shortInfos.coreInfoShort", content);
        extras.putBundle("notification.superx.shortInfos", small);
        Bundle capsule = new Bundle();
        capsule.putInt("notification.superx.capsule.state", 1);
        capsule.putParcelable("notification.superx.capsule.icon", icon);
        capsule.putString("notification.superx.capsule.content", title);
        extras.putBundle("notification.superx.capsule", capsule);
        Bundle island = new Bundle(), left = new Bundle(), right = new Bundle();
        island.putInt("island.superx.leftTemplate", 1);
        left.putParcelable("island.superx.leftInfo.icon", icon);
        left.putCharSequence("island.superx.leftInfo.content", title);
        island.putBundle("island.superx.leftInfo", left);
        island.putInt("island.superx.rightTemplate", 4);
        right.putCharSequence("island.superx.rightInfo.content", round);
        island.putBundle("island.superx.rightInfo", right);
        island.putParcelable("island.superx.clickResp", open);
        extras.putBundle("notification.superx.island", island);
        return extras;
    }
}
