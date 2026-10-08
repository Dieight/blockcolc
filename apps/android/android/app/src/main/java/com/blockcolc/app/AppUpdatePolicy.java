package com.blockcolc.app;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Locale;

/** Download descriptors and APK identity are checked independently of the UI. */
final class AppUpdatePolicy {
    static final long MAX_APK_BYTES = 100L * 1024 * 1024;
    private static final String VERSION = "(?:0|[1-9][0-9]{0,5})\\.(?:0|[1-9][0-9]{0,5})\\.(?:0|[1-9][0-9]{0,5})";

    static void requirePublicChannel(boolean privateChannel) {
        if (privateChannel) throw new IllegalArgumentException("私人版仅提示更新，不下载公开包。");
    }

    static void validateDownload(String version, String url, long size, String sha256) {
        if (version == null || !version.matches(VERSION) || size <= 0 || size > MAX_APK_BYTES
            || sha256 == null || !sha256.matches("[a-fA-F0-9]{64}")) {
            throw new IllegalArgumentException("更新文件信息无效，请重新检查更新。");
        }
        String prefix = "https://github.com/Dieight/blockcolc/releases/download/";
        String suffix = "/Blockcolc-v" + version + ".apk";
        if (!(prefix + "v" + version + suffix).equals(url) && !(prefix + version + suffix).equals(url)) {
            throw new IllegalArgumentException("更新文件来源不匹配。");
        }
    }

    static int compareVersions(String left, String right) {
        if (left == null || right == null || !left.matches(VERSION) || !right.matches(VERSION)) {
            throw new IllegalArgumentException("更新版本无效。");
        }
        String[] a = left.split("\\."), b = right.split("\\.");
        for (int i = 0; i < 3; i++) {
            int result = Integer.compare(Integer.parseInt(a[i]), Integer.parseInt(b[i]));
            if (result != 0) return result;
        }
        return 0;
    }

    static void verifyFile(File file, long expectedSize, String expectedSha256) throws Exception {
        if (!file.isFile() || file.length() != expectedSize || expectedSize <= 0 || expectedSize > MAX_APK_BYTES) {
            throw new IOException("更新文件不完整，请重新下载。");
        }
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[64 * 1024];
        try (FileInputStream stream = new FileInputStream(file)) {
            int length;
            while ((length = stream.read(buffer)) != -1) digest.update(buffer, 0, length);
        }
        if (!hex(digest.digest()).equalsIgnoreCase(expectedSha256)) {
            throw new IOException("更新文件校验失败，请重新下载。");
        }
    }

    static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        return result.toString();
    }

    static void validateIdentity(String packageName, String installedPackageName, String version, String expectedVersion,
        long versionCode, long installedVersionCode, String[] signers, String[] installedSigners, boolean privateApk) {
        if (!installedPackageName.equals(packageName) || !expectedVersion.equals(version) || versionCode <= installedVersionCode || privateApk) {
            throw new IllegalArgumentException("更新包的应用、版本或通道不匹配。");
        }
        if (signers == null || installedSigners == null || signers.length == 0 || installedSigners.length == 0) {
            throw new IllegalArgumentException("无法确认更新包签名。");
        }
        String[] a = signers.clone(), b = installedSigners.clone(); Arrays.sort(a); Arrays.sort(b);
        if (!Arrays.equals(a, b)) throw new IllegalArgumentException("更新包签名不匹配。");
    }
}
