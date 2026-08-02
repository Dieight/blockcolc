package com.blockcolc.app;

import android.os.SystemClock;
import android.view.Choreographer;
import android.view.MotionEvent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeInput")
public class NativeInputPlugin extends Plugin {
    private static float lastX;
    private static float lastY;
    private static float pendingDx;
    private static float pendingDy;
    private static boolean active;
    private static boolean frameScheduled;
    private static long sequence;
    private static long lastInputEventUptimeMs;
    private static NativeInputPlugin instance;

    private static final Choreographer.FrameCallback FRAME_CALLBACK = frameTimeNanos -> dispatchFrame();

    @Override
    public void load() {
        synchronized (NativeInputPlugin.class) {
            instance = this;
        }
    }

    static synchronized void record(MotionEvent event) {
        int action = event.getActionMasked();
        lastInputEventUptimeMs = event.getEventTime();
        if (event.getPointerCount() != 1) {
            active = false;
            pendingDx = 0; pendingDy = 0;
            scheduleFrameLocked();
            return;
        }
        if (action == MotionEvent.ACTION_DOWN) {
            lastX = event.getX(); lastY = event.getY(); pendingDx = 0; pendingDy = 0; active = true;
        } else if (action == MotionEvent.ACTION_MOVE && active) {
            for (int index = 0; index < event.getHistorySize(); index += 1) {
                float x = event.getHistoricalX(index); float y = event.getHistoricalY(index);
                pendingDx += x - lastX; pendingDy += y - lastY; lastX = x; lastY = y;
            }
            pendingDx += event.getX() - lastX; pendingDy += event.getY() - lastY;
            lastX = event.getX(); lastY = event.getY();
        } else if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) active = false;
        scheduleFrameLocked();
    }

    private static void scheduleFrameLocked() {
        if (frameScheduled || instance == null) return;
        frameScheduled = true;
        Choreographer.getInstance().postFrameCallback(FRAME_CALLBACK);
    }

    private static void dispatchFrame() {
        NativeInputPlugin plugin;
        JSObject result = new JSObject();
        synchronized (NativeInputPlugin.class) {
            frameScheduled = false;
            plugin = instance;
            if (plugin == null) return;
            float density = plugin.getContext().getResources().getDisplayMetrics().density;
            result.put("active", active);
            result.put("dx", pendingDx / density);
            result.put("dy", pendingDy / density);
            result.put("sequence", ++sequence);
            result.put("nativeInputUptimeMs", lastInputEventUptimeMs);
            long dispatchUptimeMs = SystemClock.uptimeMillis();
            result.put("nativeDispatchUptimeMs", dispatchUptimeMs);
            pendingDx = 0; pendingDy = 0;
            if (active) scheduleFrameLocked();
        }
        plugin.notifyListeners("inputFrame", result, false);
    }
}
