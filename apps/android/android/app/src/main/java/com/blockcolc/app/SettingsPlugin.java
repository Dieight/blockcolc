package com.blockcolc.app;

import android.content.Intent;
import android.provider.Settings;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SettingsPlugin")
public class SettingsPlugin extends Plugin {
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
