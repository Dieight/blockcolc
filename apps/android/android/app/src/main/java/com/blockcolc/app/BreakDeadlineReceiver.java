package com.blockcolc.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Process-independent receiver for timer cleanup and authorized automatic
 * continuation projections. Due round events are durable before publication;
 * only the shared WebView/application layer changes focus/domain state.
 */
public final class BreakDeadlineReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (BreakLiveUpdatePlugin.ACTION_AUTO_CONTINUATION_DEADLINE.equals(action)) {
            BreakLiveUpdatePlugin.onAutomaticContinuationDeadline(context, intent);
            return;
        }
        if (BreakLiveUpdatePlugin.ACTION_AUTO_TIMELINE_BOUNDARY.equals(action)) {
            BreakLiveUpdatePlugin.onAutomaticTimelineBoundary(context, intent);
            return;
        }
        if (BreakLiveUpdatePlugin.ACTION_BOOT_COMPLETED.equals(action)
            || BreakLiveUpdatePlugin.ACTION_PACKAGE_REPLACED.equals(action)) {
            BreakLiveUpdatePlugin.restoreAutomaticContinuations(context);
            BreakLiveUpdatePlugin.restoreBreakReminderProjections(context);
            return;
        }
        BreakLiveUpdatePlugin.onBreakDeadline(context, intent);
    }
}
