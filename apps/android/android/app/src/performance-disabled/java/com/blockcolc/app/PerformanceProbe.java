package com.blockcolc.app;

import android.app.Activity;
import android.content.Intent;
import android.webkit.WebView;

/** Inert compile-time facade. No bridge, observer, lease, handler or logging. */
final class PerformanceProbe {
    PerformanceProbe(Activity activity, long createdAt) {}
    void attach(WebView value) {}
    void pageLoaded() {}
    void resume() {}
    void pause() {}
    void destroy() {}
    void receive(Intent intent) {}
}
