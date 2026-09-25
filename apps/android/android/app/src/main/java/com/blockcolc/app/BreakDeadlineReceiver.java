package com.blockcolc.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Process-independent deadline receiver for break reminders and opted-in
 * automatic continuation. Automatic deadlines are durably queued before a
 * Capacitor event is sent; only the shared WebView/application layer can
 * validate plans and change focus/domain state.
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
        if (BreakLiveUpdatePlugin.ACTION_BOOT_COMPLETED.equals(action)
            || BreakLiveUpdatePlugin.ACTION_PACKAGE_REPLACED.equals(action)) {
            BreakLiveUpdatePlugin.restoreAutomaticContinuations(context);
            return;
        }
        BreakLiveUpdatePlugin.onBreakDeadline(context, intent);
    }
}
