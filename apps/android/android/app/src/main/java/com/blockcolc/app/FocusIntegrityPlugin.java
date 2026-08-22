package com.blockcolc.app;

import android.app.Activity;
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
    private static volatile boolean lastBackgroundWasMultiWindow = false;

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
        // V22: a stop while the activity still belongs to a multi-window surface
        // (split screen, freeform, OEM floating window) keeps the timer visible,
        // so the web layer exempts it from app-switch counting.
        lastBackgroundWasMultiWindow = context instanceof Activity
            && android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.N
            && ((Activity) context).isInMultiWindowMode();
    }

    @PluginMethod
    public void getLastBackgroundContext(PluginCall call) {
        JSObject result = new JSObject();
        result.put("screenInteractive", lastScreenInteractive);
        result.put("keyguardLocked", lastKeyguardLocked);
        result.put("backgroundedAtEpochMs", lastBackgroundAtEpochMs);
        result.put("productSystemUi", lastBackgroundWasProductSystemUi);
        result.put("multiWindow", lastBackgroundWasMultiWindow);
        call.resolve(result);
    }

    @PluginMethod
    public void setProductSystemUiOpen(PluginCall call) {
        setProductSystemUiOpen(call.getBoolean("open", false));
        call.resolve();
    }
}
