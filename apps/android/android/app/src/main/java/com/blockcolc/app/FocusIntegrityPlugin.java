package com.blockcolc.app;

import android.app.KeyguardManager;
import android.content.Context;
import android.os.PowerManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "FocusIntegrity")
public class FocusIntegrityPlugin extends Plugin {
    private static volatile boolean lastScreenInteractive = true;
    private static volatile boolean lastKeyguardLocked = false;
    private static volatile long lastBackgroundAtEpochMs = 0L;
    private static volatile boolean productSystemUiOpen = false;
    private static volatile boolean lastBackgroundWasProductSystemUi = false;

    static void setProductSystemUiOpen(boolean open) {
        productSystemUiOpen = open;
    }

    static void recordBackgroundContext(Context context) {
        PowerManager powerManager = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        KeyguardManager keyguardManager = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
        lastScreenInteractive = powerManager == null || powerManager.isInteractive();
        lastKeyguardLocked = keyguardManager != null && keyguardManager.isKeyguardLocked();
        lastBackgroundAtEpochMs = System.currentTimeMillis();
        lastBackgroundWasProductSystemUi = productSystemUiOpen;
    }

    @PluginMethod
    public void getLastBackgroundContext(PluginCall call) {
        JSObject result = new JSObject();
        result.put("screenInteractive", lastScreenInteractive);
        result.put("keyguardLocked", lastKeyguardLocked);
        result.put("backgroundedAtEpochMs", lastBackgroundAtEpochMs);
        result.put("productSystemUi", lastBackgroundWasProductSystemUi);
        call.resolve(result);
    }
}
