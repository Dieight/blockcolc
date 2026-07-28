package com.blockcolc.app;

import android.os.Bundle;
import android.webkit.WebView;
import android.view.View;
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
        registerPlugin(FocusIntegrityPlugin.class);
        registerPlugin(LitematicFilePickerPlugin.class);
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
        getBridge().getWebView().setBackgroundColor(0xFFF3F5F2);
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
        float density = getResources().getDisplayMetrics().density;
        String script = String.format(
            Locale.US,
            "document.documentElement.style.setProperty('--native-safe-area-inset-left','%.2fpx');" +
                "document.documentElement.style.setProperty('--native-safe-area-inset-top','%.2fpx');" +
                "document.documentElement.style.setProperty('--native-safe-area-inset-right','%.2fpx');" +
                "document.documentElement.style.setProperty('--native-safe-area-inset-bottom','%.2fpx');",
            insets.left / density,
            insets.top / density,
            insets.right / density,
            insets.bottom / density
        );
        getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(script, null));
    }

    @Override
    public void onStop() {
        FocusIntegrityPlugin.recordBackgroundContext(this);
        super.onStop();
    }
}
