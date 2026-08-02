package com.blockcolc.app;

import android.os.Bundle;
import android.os.Build;
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
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (!hasFocus || getBridge() == null || getBridge().getWebView() == null) return;
        getBridge().getWebView().postDelayed(() -> getBridge().getWebView().evaluateJavascript(
            "window.dispatchEvent(new Event('blockcolc-window-focus'));", null
        ), 180);
    }
}
