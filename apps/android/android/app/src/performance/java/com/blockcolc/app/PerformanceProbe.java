package com.blockcolc.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import org.json.JSONObject;

/** Compiled only when the explicit diagnostic build switch is enabled. */
final class PerformanceProbe {
    static final String ACTION = "com.blockcolc.app.action.PERFORMANCE";
    private final Activity activity;
    private final long createdAt;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable expire = this::stop;
    private WebView webView;
    private volatile boolean active;
    private volatile boolean progressiveStartup;
    private volatile long deadline;
    private volatile String runId = "none", requestId = "boot";
    private boolean resumed, ownsScreenFlag, fullyDrawn;
    private long pageLoadedMs = -1;
    private long sampleSequence;

    PerformanceProbe(Activity activity, long createdAt) { this.activity = activity; this.createdAt = createdAt; }
    void attach(WebView value) {
        // This source set is excluded from normal APKs. Authorized ADB CPU
        // profiling needs DevTools; no production WebView enables it here.
        WebView.setWebContentsDebuggingEnabled(true);
        webView = value; value.addJavascriptInterface(this, "BlockcolcPerformance");
    }
    void pageLoaded() { pageLoadedMs = SystemClock.elapsedRealtime() - createdAt; }
    void resume() { resumed = true; updateScreenFlag(); }
    void pause() { resumed = false; updateScreenFlag(); }
    void destroy() { stop(); if (webView != null) webView.removeJavascriptInterface("BlockcolcPerformance"); webView = null; }

    void receive(Intent intent) {
        if (intent == null || !ACTION.equals(intent.getAction())) return;
        String operation = intent.getStringExtra("probeOperation");
        String request = intent.getStringExtra("probeRequestId");
        if (!PerformanceProbePolicy.validId(request)) return;
        if ("arm".equals(operation)) {
            String run = intent.getStringExtra("probeRunId");
            if (!PerformanceProbePolicy.validId(run)) return;
            runId = run; active = true; deadline = SystemClock.elapsedRealtime() + PerformanceProbePolicy.MAX_RUN_MS;
            progressiveStartup = intent.getBooleanExtra("probeProgressiveStartup", false);
            handler.removeCallbacks(expire); handler.postDelayed(expire, PerformanceProbePolicy.MAX_RUN_MS);
            updateScreenFlag(); requestId = request;
            invoke("start()");
        } else if (!isEnabled()) return;
        requestId = request;
        if ("snapshot".equals(operation)) invoke("snapshot()");
        else if ("window".equals(operation)) {
            String label = intent.getStringExtra("probeWindow");
            if (!PerformanceProbePolicy.WINDOWS.contains(label)) return;
            invoke("beginWindow(" + JSONObject.quote(label) + ")");
        } else if ("target".equals(operation)) {
            String target = intent.getStringExtra("probeTarget");
            if (!PerformanceProbePolicy.TARGETS.contains(target)) return;
            invoke("target(" + JSONObject.quote(target) + ")");
        } else if ("zoom".equals(operation)) {
            String direction = intent.getStringExtra("probeZoom");
            if (!"in".equals(direction) && !"out".equals(direction)) return;
            invoke("zoom(" + JSONObject.quote(direction) + ")");
        } else if ("stop".equals(operation)) stop();
        Log.i("BlockcolcPerf", "event=ack run=" + runId + " request=" + request);
    }
    private void invoke(String call) {
        if (webView != null) webView.post(() -> webView.evaluateJavascript(
            "window.__blockcolcPerformanceProbe&&window.__blockcolcPerformanceProbe." + call, null));
    }
    private void stop() {
        invoke("stop()"); active = false; handler.removeCallbacks(expire); updateScreenFlag();
    }
    private void updateScreenFlag() {
        boolean keep = PerformanceProbePolicy.canKeepScreenOn(active, resumed, SystemClock.elapsedRealtime(), deadline);
        if (keep && !ownsScreenFlag && (activity.getWindow().getAttributes().flags & WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) == 0) {
            activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); ownsScreenFlag = true;
        } else if (!keep && ownsScreenFlag) {
            activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); ownsScreenFlag = false;
        }
    }
    @JavascriptInterface public boolean isEnabled() { return active && SystemClock.elapsedRealtime() < deadline; }
    @JavascriptInterface public boolean startupProgressiveOverride() { return isEnabled() && progressiveStartup; }
    /** Only fixed phase labels and timestamps from synthetic authorized plans. */
    @JavascriptInterface public String timerProjection() {
        if(!isEnabled())return "{}";
        try {
            JSONObject result=new JSONObject();long now=System.currentTimeMillis();result.put("now",now);
            org.json.JSONArray timelines=new org.json.JSONArray();
            for(java.util.Map.Entry<String,?> entry:activity.getSharedPreferences("blockcolc_automatic_continuation_v1",Activity.MODE_PRIVATE).getAll().entrySet()){
                if(!entry.getKey().startsWith("authorization:diagnostic-")||!(entry.getValue() instanceof String))continue;
                JSONObject raw=new JSONObject((String)entry.getValue()),item=new JSONObject();
                org.json.JSONArray phases=raw.optJSONArray("phases");if(phases==null)continue;
                item.put("phases",phases.length());
                for(int i=0;i<phases.length();i++){
                    JSONObject phase=phases.getJSONObject(i);long start=phase.optLong("startsAtEpochMs"),end=phase.optLong("endsAtEpochMs");
                    if(start<=now&&now<end){item.put("kind",phase.optString("kind"));item.put("round",phase.optInt("round"));item.put("end",end);}
                }
                timelines.put(item);
            }
            result.put("timelines",timelines);
            result.put("events",new org.json.JSONArray(activity.getSharedPreferences("blockcolc_diagnostic_timer",Activity.MODE_PRIVATE).getString("events","[]")));
            return result.toString();
        }catch(Exception ignored){return "{}";}
    }
    @JavascriptInterface public void publish(String payload) {
        if (!isEnabled() || payload == null || payload.length() > PerformanceProbePolicy.MAX_PAYLOAD_CHARS) return;
        final JSONObject sample;
        try { sample = new JSONObject(payload); if (!validObject(sample, 0)) return; }
        catch (Exception ignored) { return; }
        final String run = runId, request = requestId;
        handler.post(() -> {
            if (!isEnabled() || !run.equals(runId)) return;
            if (sample.optBoolean("worldReady") && !fullyDrawn) { activity.reportFullyDrawn(); fullyDrawn = true; }
            try {
                JSONObject nativeSample = new JSONObject();
                nativeSample.put("activityAgeMs", SystemClock.elapsedRealtime() - createdAt);
                nativeSample.put("pageLoadedMs", pageLoadedMs);
                nativeSample.put("keepScreenOn", ownsScreenFlag);
                nativeSample.put("webViewWidth", webView == null ? 0 : webView.getWidth());
                nativeSample.put("webViewHeight", webView == null ? 0 : webView.getHeight());
                int[] location = new int[2]; if (webView != null) webView.getLocationOnScreen(location);
                nativeSample.put("webViewX", location[0]); nativeSample.put("webViewY", location[1]);
                sample.put("native", nativeSample);
                String encoded = Base64.encodeToString(sample.toString().getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
                int chunkSize = 2400, count = (encoded.length() + chunkSize - 1) / chunkSize;
                long sequence = ++sampleSequence;
                for (int part = 0; part < count; part++) {
                    Log.i("BlockcolcPerf", "event=sample run=" + run + " request=" + request + " sample=" + sequence + " part=" + part + "/" + count
                        + " data=" + encoded.substring(part * chunkSize, Math.min(encoded.length(), (part + 1) * chunkSize)));
                }
            } catch (Exception ignored) { /* Diagnostics must never fail application work. */ }
        });
    }
    private static boolean validObject(JSONObject value, int depth) throws Exception {
        if (depth > 4 || value.length() > 96) return false;
        Iterator<String> keys = value.keys();
        while (keys.hasNext()) {
            String key = keys.next(); if (!PerformanceProbePolicy.KEYS.contains(key)) return false;
            Object field = value.get(key);
            if (field instanceof JSONObject) { if (!validObject((JSONObject) field, depth + 1)) return false; }
            else if (field instanceof Number) { if (!PerformanceProbePolicy.validNumber(((Number) field).doubleValue())) return false; }
            else if (field instanceof String) {
                if (!PerformanceProbePolicy.validString(key, (String) field)) return false;
            } else if (field != JSONObject.NULL && !(field instanceof Boolean)) return false;
        }
        return true;
    }
}
