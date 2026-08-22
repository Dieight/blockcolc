package com.blockcolc.app;

import android.os.Bundle;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import android.view.View;
import android.view.WindowManager;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.util.Locale;

public class MainActivity extends BridgeActivity {
    private Insets latestSafeInsets = Insets.NONE;
    private boolean miniWindowActive = false;
    private final Runnable miniWindowCheck = this::checkMiniWindowFallback;
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
        bridgeBuilder.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView webView) {
                publishSafeAreaInsets(latestSafeInsets);
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

    private void pushMiniWindowSignal(boolean active) {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        FocusIntegrityPlugin.recordBackgroundContext(this);
        getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('blockcolc-multi-window',{detail:{active:" + active + "}}));",
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
        FocusIntegrityPlugin.recordBackgroundContext(this);
        getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('blockcolc-multi-window',{detail:{active:" + mini + "}}));",
            null
        ));
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
        FocusIntegrityPlugin.recordBackgroundContext(this);
        super.onStop();
    }

    @Override
    public void onPause() {
        super.onPause();
        // A floating window typically pauses the host without stopping it;
        // report the pause as a potential leave (the 3 s grace absorbs quick
        // system overlays) and let the domain layer deduplicate with onStop.
        pushMiniWindowSignal(true);
    }

    @Override
    public void onResume() {
        super.onResume();
        pushMiniWindowSignal(false);
    }

    @Override
    @android.annotation.TargetApi(24)
    public void onMultiWindowModeChanged(boolean isInMultiWindowMode) {
        super.onMultiWindowModeChanged(isInMultiWindowMode);
        pushMiniWindowSignal(isInMultiWindowMode);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (getBridge() == null || getBridge().getWebView() == null) return;
        if (hasFocus) {
            // Returning focus settles a pending focus-leave; the domain grace
            // absorbs quick overlays (notification shade, edge panel).
            pushMiniWindowSignal(false);
            getBridge().getWebView().postDelayed(() -> getBridge().getWebView().evaluateJavascript(
                "window.dispatchEvent(new Event('blockcolc-window-focus'));", null
            ), 180);
        } else {
            // Splitting attention to ANY other window (a floating window of
            // another app, the notification shade, the recents overview) loses
            // focus without any lifecycle callback; treat it like a leave and
            // let the 3 s grace separate glances from actual slacking.
            pushMiniWindowSignal(true);
        }
    }
}
