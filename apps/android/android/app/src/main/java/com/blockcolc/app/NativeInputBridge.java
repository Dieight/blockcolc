package com.blockcolc.app;

import android.webkit.JavascriptInterface;
import android.util.Log;

/** Narrow synchronous snapshot bridge for the high-frequency camera input path. */
public final class NativeInputBridge {
    @JavascriptInterface
    public String readSnapshot() {
        return NativeInputPlugin.readSnapshotJson();
    }

    @JavascriptInterface
    public void logRenderDiagnostic(String message) {
        if (message == null || message.length() > 4096) return;
        Log.i("BlockcolcRender", message);
    }
}
