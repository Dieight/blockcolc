package com.blockcolc.app;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.IOException;
import java.security.MessageDigest;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** System-owned background transfer; this plugin never installs without a tap. */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private static final String PRIVATE_FLAG = "com.blockcolc.PRIVATE_RELAY";
    private String verifiedToken = null;
    private long verifiedModified = -1;

    private SharedPreferences store() { return getContext().getSharedPreferences("blockcolc-app-update", Context.MODE_PRIVATE); }
    private DownloadManager manager() { return (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE); }
    private boolean privateChannel() throws Exception {
        ApplicationInfo info = getContext().getPackageManager().getApplicationInfo(getContext().getPackageName(), PackageManager.GET_META_DATA);
        return info.metaData != null && info.metaData.getBoolean(PRIVATE_FLAG, false);
    }
    private boolean canInstall() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls();
    }
    private File ownedFile(String token) throws IOException {
        if (token == null || !token.matches("[a-f0-9]{32}")) throw new IOException("更新文件记录无效。");
        File directory = getContext().getExternalFilesDir("updates");
        if (directory == null) throw new IOException("更新存储暂不可用。");
        return new File(directory, token + ".apk");
    }
    private interface Operation { void run() throws Exception; }
    private void perform(PluginCall call, Operation operation) {
        worker.execute(() -> {
            try { operation.run(); }
            catch (Exception error) {
                String message = error instanceof IllegalArgumentException || error instanceof IOException
                    ? error.getMessage() : "暂时无法处理更新，请重试。";
                call.reject(message);
            }
        });
    }
    private JSObject base() throws Exception {
        JSObject result = new JSObject(); result.put("native", true);
        result.put("channel", privateChannel() ? "private" : "standard");
        result.put("canInstall", canInstall()); result.put("phase", "idle");
        return result;
    }
    private void clearOwnedJob() {
        SharedPreferences prefs = store(); long id = prefs.getLong("id", 0);
        try { if (id > 0 && manager() != null) manager().remove(id); } catch (RuntimeException ignored) { }
        try { File file = ownedFile(prefs.getString("token", null)); if (file.isFile()) file.delete(); } catch (IOException ignored) { }
        prefs.edit().clear().commit(); verifiedToken = null; verifiedModified = -1;
    }

    @PluginMethod public void status(PluginCall call) { perform(call, () -> call.resolve(snapshot())); }

    private JSObject snapshot() throws Exception {
        JSObject result = base(); SharedPreferences prefs = store(); long id = prefs.getLong("id", 0);
        if (id <= 0) return result;
        if (privateChannel()) { clearOwnedJob(); return result; }
        String version = prefs.getString("version", "");
        // Installation completed, or this saved candidate was superseded by a manual upgrade.
        if (AppUpdatePolicy.compareVersions(version, BuildConfig.VERSION_NAME) <= 0) { clearOwnedJob(); return result; }
        result.put("version", version); result.put("totalBytes", prefs.getLong("size", 0));
        String failure = prefs.getString("failure", "");
        if (!failure.isEmpty()) { result.put("phase", "failed"); result.put("message", failure); return result; }
        if (manager() == null) throw new IOException("系统下载服务不可用。");
        try (Cursor cursor = manager().query(new DownloadManager.Query().setFilterById(id))) {
            if (cursor == null || !cursor.moveToFirst()) return fail(result, "下载记录已失效，请重新下载。");
            int state = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            long bytes = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
            result.put("receivedBytes", Math.max(0, bytes));
            if (bytes > prefs.getLong("size", 0)) return fail(result, "更新文件大小不匹配，请重新下载。");
            if (state == DownloadManager.STATUS_FAILED) return fail(result, "下载未完成，请检查网络和存储后重试。");
            if (state == DownloadManager.STATUS_SUCCESSFUL) {
                try { verifyCandidate(false); result.put("phase", "ready"); }
                catch (Exception error) { return fail(result, safeVerificationMessage(error)); }
            } else result.put("phase", state == DownloadManager.STATUS_PAUSED ? "paused" : "downloading");
        }
        return result;
    }
    private String safeVerificationMessage(Exception error) {
        return error instanceof IllegalArgumentException || error instanceof IOException ? error.getMessage() : "更新文件无法验证，请重新下载。";
    }
    private JSObject fail(JSObject result, String message) {
        long id = store().getLong("id", 0);
        try { if (id > 0 && manager() != null) manager().remove(id); } catch (RuntimeException ignored) { }
        try { File file = ownedFile(store().getString("token", null)); if (file.isFile()) file.delete(); } catch (IOException ignored) { }
        store().edit().putString("failure", message).commit();
        verifiedToken = null; result.put("phase", "failed"); result.put("message", message); return result;
    }

    @PluginMethod public void start(PluginCall call) {
        perform(call, () -> {
            AppUpdatePolicy.requirePublicChannel(privateChannel());
            String version = call.getString("version"), url = call.getString("url"), sha256 = call.getString("sha256");
            Long size = call.getLong("size");
            AppUpdatePolicy.validateDownload(version, url, size == null ? 0 : size, sha256);
            if (AppUpdatePolicy.compareVersions(version, BuildConfig.VERSION_NAME) <= 0) throw new IllegalArgumentException("此更新版本不高于当前版本。");
            SharedPreferences prefs = store();
            if (version.equals(prefs.getString("version", null)) && sha256.equalsIgnoreCase(prefs.getString("sha256", "")) && prefs.getLong("id", 0) > 0 && prefs.getString("failure", "").isEmpty()) {
                call.resolve(snapshot()); return;
            }
            if (manager() == null) throw new IOException("系统下载服务不可用。");
            clearOwnedJob();
            String token = UUID.randomUUID().toString().replace("-", ""); ownedFile(token);
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle("方块钟 " + version); request.setDescription("正在下载更新；安装仍需你确认");
            request.setMimeType("application/vnd.android.package-archive");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
            request.setAllowedOverMetered(true); request.setAllowedOverRoaming(false);
            request.setDestinationInExternalFilesDir(getContext(), "updates", token + ".apk");
            long id = manager().enqueue(request);
            if (!prefs.edit().putLong("id", id).putString("token", token).putString("version", version)
                .putString("url", url).putString("sha256", sha256).putLong("size", size).commit()) {
                manager().remove(id); throw new IOException("未能保存下载记录，请重试。");
            }
            call.resolve(snapshot());
        });
    }

    @SuppressWarnings("deprecation")
    private String[] signerDigests(PackageInfo info) throws Exception {
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) signatures = info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners();
        else signatures = info.signatures;
        if (signatures == null) return null;
        String[] result = new String[signatures.length];
        for (int i = 0; i < signatures.length; i++) result[i] = AppUpdatePolicy.hex(MessageDigest.getInstance("SHA-256").digest(signatures[i].toByteArray()));
        return result;
    }
    @SuppressWarnings("deprecation")
    private File verifyCandidate(boolean force) throws Exception {
        AppUpdatePolicy.requirePublicChannel(privateChannel());
        SharedPreferences prefs = store(); String token = prefs.getString("token", null);
        File file = ownedFile(token);
        String version = prefs.getString("version", ""); long size = prefs.getLong("size", 0);
        AppUpdatePolicy.validateDownload(version, prefs.getString("url", ""), size, prefs.getString("sha256", ""));
        if (!force && token.equals(verifiedToken) && file.isFile() && file.length() == size && file.lastModified() == verifiedModified) return file;
        AppUpdatePolicy.verifyFile(file, size, prefs.getString("sha256", ""));
        PackageManager pm = getContext().getPackageManager();
        int flags = PackageManager.GET_META_DATA | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES);
        PackageInfo candidate = pm.getPackageArchiveInfo(file.getAbsolutePath(), flags);
        PackageInfo installed = pm.getPackageInfo(getContext().getPackageName(), flags);
        if (candidate == null) throw new IOException("更新文件不是可安装的应用。");
        boolean privateApk = candidate.applicationInfo != null && candidate.applicationInfo.metaData != null && candidate.applicationInfo.metaData.getBoolean(PRIVATE_FLAG, false);
        long candidateCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? candidate.getLongVersionCode() : candidate.versionCode;
        long installedCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? installed.getLongVersionCode() : installed.versionCode;
        AppUpdatePolicy.validateIdentity(candidate.packageName, installed.packageName, candidate.versionName, version,
            candidateCode, installedCode, signerDigests(candidate), signerDigests(installed), privateApk);
        verifiedToken = token; verifiedModified = file.lastModified(); return file;
    }

    @PluginMethod public void cancel(PluginCall call) { perform(call, () -> { clearOwnedJob(); call.resolve(base()); }); }

    @PluginMethod public void allowInstall(PluginCall call) {
        perform(call, () -> {
            AppUpdatePolicy.requirePublicChannel(privateChannel());
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !canInstall()) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); getContext().startActivity(intent);
            }
            call.resolve();
        });
    }
    @PluginMethod public void install(PluginCall call) {
        perform(call, () -> {
            JSObject state = snapshot();
            if (!"ready".equals(state.getString("phase"))) throw new IllegalArgumentException("更新尚未下载并验证完成。");
            if (!canInstall()) throw new IllegalArgumentException("请先允许方块钟安装此来源的应用。");
            File file;
            try { file = verifyCandidate(true); }
            catch (Exception error) { fail(state, safeVerificationMessage(error)); throw error; }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent); call.resolve();
        });
    }
    @Override protected void handleOnDestroy() { worker.shutdown(); }
}
