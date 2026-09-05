package com.blockcolc.app;

import android.os.Bundle;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.content.Intent;
import android.webkit.WebView;
import android.view.View;
import android.view.WindowManager;
import android.util.Log;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.util.Locale;

public class MainActivity extends BridgeActivity {
    static final String ACTION_SKIP_BREAK = "com.blockcolc.app.action.SKIP_BREAK";
    private boolean pendingSkipBreak = false;
    private final long nativeCreatedAtMs = SystemClock.elapsedRealtime();
    private Insets latestSafeInsets = Insets.NONE;
    private boolean miniWindowActive = false;
    private final Runnable miniWindowCheck = this::checkMiniWindowFallback;
    private final AttentionStateMachine attentionState = new AttentionStateMachine();
    private void applyAttentionTransition(AttentionStateMachine.Transition transition, String source) {
        if (transition == AttentionStateMachine.Transition.NONE) return;
        boolean background = transition == AttentionStateMachine.Transition.BACKGROUND;
        Log.i("BlockcolcLifecycle", "source=" + source + " transition=" + (background ? "background" : "foreground"));
        pushAttentionSignal(background);
    }
    // V22 follow-up: OEM side-rail floating windows (ColorOS smart sidebar) hide
    // the host activity without a reliable onStop or multi-window callback, so
    // three compensating channels exist: onPause/onResume signals, a 1-second
    // window-area poll, and the standard onMultiWindowModeChanged callback. The
    // domain layer deduplicates every path (one pending background per session).
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable miniWindowPoll = new Runnable() {
        @Override
        public void run() {
            if (isFinishing() || isDestroyed()) return;
            checkMiniWindowFallback();
            if (!isFinishing() && !isDestroyed()) mainHandler.postDelayed(this, 1000);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        captureBreakAction(getIntent());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attributes = getWindow().getAttributes();
            attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(attributes);
        }
        registerPlugin(FocusIntegrityPlugin.class);
        registerPlugin(LitematicFilePickerPlugin.class);
        registerPlugin(NativeInputPlugin.class);
        registerPlugin(SettingsPlugin.class);
        registerPlugin(BreakLiveUpdatePlugin.class);
        bridgeBuilder.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView webView) {
                Log.i("BlockcolcStartup", "page-loaded durationMs=" + (SystemClock.elapsedRealtime() - nativeCreatedAtMs));
                captureWebDiagnostics(webView, 20);
                publishSafeAreaInsets(latestSafeInsets);
                dispatchPendingBreakAction();
            }
        });
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        super.onCreate(savedInstanceState);
        View content = findViewById(android.R.id.content);
        content.setBackgroundColor(0xFFF3F5F2);
        WebView webView = getBridge().getWebView();
        webView.setBackgroundColor(0xFFF3F5F2);
        webView.addJavascriptInterface(new NativeInputBridge(), "BlockcolcNativeInput");
        webView.setOnTouchListener((view, event) -> { NativeInputPlugin.record(event); return false; });
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
            Insets cutout = windowInsets.getInsets(WindowInsetsCompat.Type.displayCutout());
            latestSafeInsets = Insets.of(
                Math.max(bars.left, cutout.left),
                Math.max(bars.top, cutout.top),
                Math.max(bars.right, cutout.right),
                Math.max(bars.bottom, cutout.bottom)
            );
            view.setPadding(0, 0, 0, 0);
            publishSafeAreaInsets(latestSafeInsets);
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(content);
        getWindow().getDecorView().addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
            view.removeCallbacks(miniWindowCheck);
            view.postDelayed(miniWindowCheck, 700);
        });
        mainHandler.postDelayed(miniWindowPoll, 500);
    }

    private void captureWebDiagnostics(WebView webView, int attemptsRemaining) {
        if (webView == null || isFinishing() || isDestroyed()) return;
        webView.evaluateJavascript(
            "(function(){" +
                "var root=document.documentElement&&document.documentElement.dataset;" +
                "var canvas=document.querySelector('canvas[aria-label=\"项目建筑世界\"]');" +
                "if(!root||!root.bootstrapDurationMs||!root.appShellFrameMs||!canvas||" +
                    "!canvas.dataset.firstNonemptyFrameMs)return null;" +
                "return {" +
                    "bootstrapDurationMs:Number(root.bootstrapDurationMs)," +
                    "appShellFrameMs:Number(root.appShellFrameMs)," +
                    "firstNonemptyFrameMs:Number(canvas.dataset.firstNonemptyFrameMs)," +
                    "worldRebuildCount:Number(canvas.dataset.worldRebuildCount||0)," +
                    "worldRebuildLastMs:Number(canvas.dataset.worldRebuildLastMs||0)," +
                    "nativeBridgeReady:typeof window.BlockcolcNativeInput==='object'" +
                "};" +
            "})()",
            value -> {
                if (value != null && !"null".equals(value)) {
                    Log.i("BlockcolcRender", "web-diagnostics=" + value);
                } else if (attemptsRemaining > 0 && !isFinishing() && !isDestroyed()) {
                    webView.postDelayed(() -> captureWebDiagnostics(webView, attemptsRemaining - 1), 500);
                }
            }
        );
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureBreakAction(intent);
        dispatchPendingBreakAction();
    }

    private void captureBreakAction(Intent intent) {
        if (intent == null || !ACTION_SKIP_BREAK.equals(intent.getAction())) return;
        pendingSkipBreak = true;
        BreakLiveUpdatePlugin.cancelNotification(this);
        intent.setAction(null);
    }

    private void dispatchPendingBreakAction() {
        if (!pendingSkipBreak || getBridge() == null || getBridge().getWebView() == null) return;
        pendingSkipBreak = false;
        getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(
            "localStorage.setItem('blockcolc-skip-break-request-v1','1');" +
                "window.dispatchEvent(new Event('blockcolc-skip-break'));",
            null
        ));
    }

    private void pushAttentionSignal(boolean background) {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        // The timestamp is the instant attention was actually lost. Recording
        // it again on foreground used to overwrite a real multi-second absence
        // with the return time, causing app switches to count as zero.
        if (background) FocusIntegrityPlugin.recordBackgroundContext(this);
        getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('blockcolc-native-attention',{detail:{background:" + background + "}}));",
            null
        ));
    }

    private void checkMiniWindowFallback() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        View decor = getWindow().getDecorView();
        int width = decor.getWidth();
        int height = decor.getHeight();
        android.graphics.Point size = new android.graphics.Point();
        getWindowManager().getDefaultDisplay().getSize(size);
        if (width <= 0 || height <= 0 || size.x <= 0 || size.y <= 0) return;
        // Floating windows and split panes shrink the visible area well below a
        // keyboard or gesture bar (which keep width and leave area above 55%).
        boolean mini = ((float) width * (float) height) / ((float) size.x * (float) size.y) < 0.55f;
        if (mini == miniWindowActive) return;
        miniWindowActive = mini;
        applyAttentionTransition(attentionState.onMiniWindowChanged(mini), "window-area");
    }

    private void publishSafeAreaInsets(Insets insets) {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        WebView webView = getBridge().getWebView();
        webView.post(() -> {
            int[] location = new int[2];
            webView.getLocationInWindow(location);
            View content = findViewById(android.R.id.content);
            int windowWidth = content.getWidth();
            int windowHeight = content.getHeight();
            int rightGap = Math.max(0, windowWidth - (location[0] + webView.getWidth()));
            int bottomGap = Math.max(0, windowHeight - (location[1] + webView.getHeight()));
            Insets remaining = Insets.of(
                Math.max(0, insets.left - location[0]),
                Math.max(0, insets.top - location[1]),
                Math.max(0, insets.right - rightGap),
                Math.max(0, insets.bottom - bottomGap)
            );
            float density = getResources().getDisplayMetrics().density;
            String script = String.format(
                Locale.US,
                "document.documentElement.style.setProperty('--native-safe-area-inset-left','%.2fpx');" +
                    "document.documentElement.style.setProperty('--native-safe-area-inset-top','%.2fpx');" +
                    "document.documentElement.style.setProperty('--native-safe-area-inset-right','%.2fpx');" +
                    "document.documentElement.style.setProperty('--native-safe-area-inset-bottom','%.2fpx');",
                remaining.left / density,
                remaining.top / density,
                remaining.right / density,
                remaining.bottom / density
            );
            webView.evaluateJavascript(script, null);
        });
    }

    @Override
    public void onStop() {
        super.onStop();
    }

    @Override
    public void onPause() {
        super.onPause();
        // A floating window typically pauses the host without stopping it;
        // report the pause as a potential leave (the 3 s grace absorbs quick
        // system overlays). Repeated leave channels are deduplicated by the
        // attention state machine.
        applyAttentionTransition(attentionState.onPause(), "pause");
    }

    @Override
    public void onResume() {
        super.onResume();
        applyAttentionTransition(attentionState.onResume(), "resume");
    }

    @Override
    @android.annotation.TargetApi(24)
    public void onMultiWindowModeChanged(boolean isInMultiWindowMode) {
        super.onMultiWindowModeChanged(isInMultiWindowMode);
        applyAttentionTransition(attentionState.onMultiWindowModeChanged(isInMultiWindowMode), "multi-window");
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (getBridge() == null || getBridge().getWebView() == null) return;
        if (hasFocus) {
            // Returning focus settles a pending focus-leave; the domain grace
            // absorbs quick overlays (notification shade, edge panel).
            applyAttentionTransition(attentionState.onWindowFocusChanged(true), "window-focus");
            getBridge().getWebView().postDelayed(() -> getBridge().getWebView().evaluateJavascript(
                "window.dispatchEvent(new Event('blockcolc-window-focus'));", null
            ), 180);
        } else {
            // Splitting attention to ANY other window (a floating window of
            // another app, the notification shade, the recents overview) loses
            // focus without any lifecycle callback; treat it like a leave and
            // let the 3 s grace separate glances from actual slacking.
            applyAttentionTransition(attentionState.onWindowFocusChanged(false), "window-focus");
        }
    }
}
