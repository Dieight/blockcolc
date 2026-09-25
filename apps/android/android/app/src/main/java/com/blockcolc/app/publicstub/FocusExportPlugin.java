package com.blockcolc.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Public-build implementation of the optional private relay port.
 *
 * The private Gradle source overlay replaces this class with the uploader.
 * Keeping a real, inert Capacitor plugin in the common source tree means the
 * Web bundle has one stable native API while a standard APK never creates a
 * projection cache, schedules work, or contains private relay configuration.
 */
@CapacitorPlugin(name = "FocusExport")
public final class FocusExportPlugin extends Plugin {
    @PluginMethod public void availability(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", false);
        call.resolve(result);
    }

    @PluginMethod public void publish(PluginCall call) {
        // A direct call from a stale Web bundle is harmless in the standard
        // build.  The coordinator gates all normal calls on availability().
        call.resolve();
    }
}
