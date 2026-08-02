package com.blockcolc.app;

import android.os.SystemClock;
import android.view.Choreographer;
import android.view.MotionEvent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Locale;

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
    private static boolean directBridgeAttached;
    private static float latestDx;
    private static float latestDy;
    private static boolean latestActive;
    private static long latestSequence;
    private static long latestInputUptimeMs;
    private static long latestDispatchUptimeMs;

    private static final Choreographer.FrameCallback FRAME_CALLBACK = frameTimeNanos -> dispatchFrame();

    @Override
    public void load() {
        synchronized (NativeInputPlugin.class) {
            instance = this;
        }
    }

    static synchronized void record(MotionEvent event) {
        // Keep the WebView's standard pointer path completely idle unless the
        // synchronous native snapshot transport was explicitly selected.
        if (!directBridgeAttached) return;
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

    static synchronized String readSnapshotJson() {
        directBridgeAttached = true;
        float snapshotDx = latestDx;
        float snapshotDy = latestDy;
        latestDx = 0;
        latestDy = 0;
        return String.format(
            Locale.US,
            "{\"active\":%s,\"dx\":%.4f,\"dy\":%.4f,\"sequence\":%d,\"nativeInputUptimeMs\":%d,\"nativeDispatchUptimeMs\":%d}",
            latestActive,
            snapshotDx,
            snapshotDy,
            latestSequence,
            latestInputUptimeMs,
            latestDispatchUptimeMs
        );
    }

    private static void scheduleFrameLocked() {
        if (frameScheduled || instance == null) return;
        frameScheduled = true;
        Choreographer.getInstance().postFrameCallback(FRAME_CALLBACK);
    }

    private static void dispatchFrame() {
        NativeInputPlugin plugin;
        boolean notifyCapacitor;
        boolean frameActive;
        float frameDx;
        float frameDy;
        long frameSequence;
        long frameInputUptimeMs;
        long frameDispatchUptimeMs;
        synchronized (NativeInputPlugin.class) {
            frameScheduled = false;
            plugin = instance;
            float density = plugin == null ? 1f : plugin.getContext().getResources().getDisplayMetrics().density;
            frameActive = active;
            frameDx = pendingDx / density;
            frameDy = pendingDy / density;
            frameDispatchUptimeMs = SystemClock.uptimeMillis();
            latestActive = active;
            latestDx += frameDx;
            latestDy += frameDy;
            frameSequence = ++sequence;
            frameInputUptimeMs = lastInputEventUptimeMs;
            latestSequence = frameSequence;
            latestInputUptimeMs = frameInputUptimeMs;
            latestDispatchUptimeMs = frameDispatchUptimeMs;
            pendingDx = 0; pendingDy = 0;
            if (active) scheduleFrameLocked();
            notifyCapacitor = !directBridgeAttached;
        }
        if (notifyCapacitor && plugin != null) {
            JSObject result = new JSObject();
            result.put("active", frameActive);
            result.put("dx", frameDx);
            result.put("dy", frameDy);
            result.put("sequence", frameSequence);
            result.put("nativeInputUptimeMs", frameInputUptimeMs);
            result.put("nativeDispatchUptimeMs", frameDispatchUptimeMs);
            plugin.notifyListeners("inputFrame", result, false);
        }
    }
}
