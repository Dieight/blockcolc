package com.blockcolc.app;

import android.content.Intent;
import android.content.Context;
import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SettingsPlugin")
public class SettingsPlugin extends Plugin {
    @PluginMethod
    public void getBackgroundHealth(PluginCall call) {
        JSObject result = new JSObject();
        PowerManager power = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        result.put("batteryOptimizationsIgnored", power != null && power.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        result.put("powerSaveMode", power != null && power.isPowerSaveMode());
        result.put("manufacturer", Build.MANUFACTURER);
        result.put("apiLevel", Build.VERSION.SDK_INT);
        JSArray history = new JSArray();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                ActivityManager manager = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
                if (manager != null) for (ApplicationExitInfo info : manager.getHistoricalProcessExitReasons(null, 0, 6)) {
                    // No crash traces, process descriptions, user content or device IDs.
                    JSObject item = new JSObject();
                    item.put("timestampMs", info.getTimestamp());
                    item.put("reason", info.getReason());
                    item.put("importance", info.getImportance());
                    item.put("pssKb", info.getPss());
                    item.put("rssKb", info.getRss());
                    item.put("process", getContext().getPackageName().equals(info.getProcessName()) ? "app" : "other");
                    history.put(item);
                }
            } catch (RuntimeException ignored) { /* OEMs may not retain or expose exit history. */ }
        }
        result.put("exitHistory", history);
        result.put("rendererExitAtMs", getContext().getSharedPreferences("blockcolc-runtime-health", Context.MODE_PRIVATE).getLong("rendererExitAtMs", 0));
        result.put("rendererCrashed", getContext().getSharedPreferences("blockcolc-runtime-health", Context.MODE_PRIVATE).getBoolean("rendererCrashed", false));
        call.resolve(result);
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { getContext().startActivity(intent); call.resolve(); }
        catch (Exception error) { call.reject("Unable to open system battery settings"); }
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
        intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("Unable to open system notification settings: " + error.getMessage());
        }
    }
}
