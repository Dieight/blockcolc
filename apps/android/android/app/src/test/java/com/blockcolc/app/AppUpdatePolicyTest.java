package com.blockcolc.app;

import org.junit.Test;
import java.io.File;
import java.nio.file.Files;
import java.security.MessageDigest;
import static org.junit.Assert.*;

public class AppUpdatePolicyTest {
    private static final String VERSION = "2.6.0";
    private static final String URL = "https://github.com/Dieight/blockcolc/releases/download/v2.6.0/Blockcolc-v2.6.0.apk";
    private static final String HASH = new String(new char[64]).replace('\0', 'a');

    @Test public void privateBuildNeverDownloadsThePublicChannel() {
        AppUpdatePolicy.requirePublicChannel(false);
        assertThrows(IllegalArgumentException.class, () -> AppUpdatePolicy.requirePublicChannel(true));
    }
    @Test public void acceptsBoundedTrustedReleaseDescriptorsOnly() {
        AppUpdatePolicy.validateDownload(VERSION, URL, 5000000, HASH);
        AppUpdatePolicy.validateDownload(VERSION, URL.replace("/v2.6.0/", "/2.6.0/"), AppUpdatePolicy.MAX_APK_BYTES, HASH);
        for (String url : new String[]{URL.replace("github.com", "github.com.evil.invalid"), URL + "?url=elsewhere", URL.replace("Blockcolc-v", "Blockcolc-private-v"), URL.replace("2.6.0.apk", "2.5.6.apk"), URL.replace("https:", "http:")}) {
            assertThrows(IllegalArgumentException.class, () -> AppUpdatePolicy.validateDownload(VERSION, url, 1, HASH));
        }
    }
    @Test public void rejectsMalformedAndOversizedAssets() {
        for (long size : new long[]{-1, 0, AppUpdatePolicy.MAX_APK_BYTES + 1}) assertThrows(IllegalArgumentException.class, () -> AppUpdatePolicy.validateDownload(VERSION, URL, size, HASH));
        for (String version : new String[]{"../2.6.0", "02.6.0", "2.6.0-rc.1", "9999999.0.0"}) assertThrows(IllegalArgumentException.class, () -> AppUpdatePolicy.validateDownload(version, URL, 1, HASH));
        assertThrows(IllegalArgumentException.class, () -> AppUpdatePolicy.validateDownload(VERSION, URL, 1, "sha256:" + HASH));
    }
    @Test public void versionComparisonIsNumeric() {
        assertTrue(AppUpdatePolicy.compareVersions("2.10.0", "2.9.9") > 0);
        assertEquals(0, AppUpdatePolicy.compareVersions(VERSION, VERSION));
        assertTrue(AppUpdatePolicy.compareVersions("2.5.6", VERSION) < 0);
    }
    @Test public void verifiesSizeAndHashAndDetectsTampering() throws Exception {
        File file = File.createTempFile("blockcolc-update-test", ".apk");
        try {
            byte[] data = new byte[]{1, 2, 3, 4}; Files.write(file.toPath(), data);
            String sha = AppUpdatePolicy.hex(MessageDigest.getInstance("SHA-256").digest(data));
            AppUpdatePolicy.verifyFile(file, 4, sha.toUpperCase());
            assertThrows(Exception.class, () -> AppUpdatePolicy.verifyFile(file, 3, sha));
            Files.write(file.toPath(), new byte[]{1, 2, 3, 5});
            assertThrows(Exception.class, () -> AppUpdatePolicy.verifyFile(file, 4, sha));
        } finally { file.delete(); }
    }
    private void identity(String name, String version, long code, String[] signatures, boolean privateApk) {
        AppUpdatePolicy.validateIdentity(name, "com.blockcolc.app", version, VERSION, code, 55, signatures, new String[]{"a", "b"}, privateApk);
    }
    @Test public void sameSignerSetCanBeUnordered() { identity("com.blockcolc.app", VERSION, 56, new String[]{"b", "a"}, false); }
    @Test public void cannotInstallAnotherAppOrChannelOrVersion() {
        assertThrows(IllegalArgumentException.class, () -> identity("com.evil.app", VERSION, 56, new String[]{"a", "b"}, false));
        assertThrows(IllegalArgumentException.class, () -> identity("com.blockcolc.app", "2.7.0", 56, new String[]{"a", "b"}, false));
        assertThrows(IllegalArgumentException.class, () -> identity("com.blockcolc.app", VERSION, 55, new String[]{"a", "b"}, false));
        assertThrows(IllegalArgumentException.class, () -> identity("com.blockcolc.app", VERSION, 56, new String[]{"a", "b"}, true));
    }
    @Test public void signatureMismatchOrMissingSignersFailsClosed() {
        for (String[] signatures : new String[][]{null, {}, {"a"}, {"a", "c"}}) assertThrows(IllegalArgumentException.class, () -> identity("com.blockcolc.app", VERSION, 56, signatures, false));
    }
}
