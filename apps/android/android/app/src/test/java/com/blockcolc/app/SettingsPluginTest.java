package com.blockcolc.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import org.junit.Test;

public class SettingsPluginTest {
    @Test public void colorOsUsesAppDetailsWithoutGuessingPrivateOemComponents() {
        assertTrue(SettingsPlugin.prefersAppBatteryDetails("OnePlus"));
        assertTrue(SettingsPlugin.prefersAppBatteryDetails("OPPO"));
        assertTrue(SettingsPlugin.prefersAppBatteryDetails(" realme "));
        assertFalse(SettingsPlugin.prefersAppBatteryDetails("Google"));
        assertFalse(SettingsPlugin.prefersAppBatteryDetails("Samsung"));
        assertFalse(SettingsPlugin.prefersAppBatteryDetails("NotOnePlus"));
        assertFalse(SettingsPlugin.prefersAppBatteryDetails(null));
    }
}
