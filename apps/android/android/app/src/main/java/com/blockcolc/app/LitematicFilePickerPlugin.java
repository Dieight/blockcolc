package com.blockcolc.app;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.InputStream;

@CapacitorPlugin(name = "LitematicFilePicker")
public class LitematicFilePickerPlugin extends Plugin {
    private static final int LITEMATIC_MAX_BYTES = 10 * 1024 * 1024;
    private static final int RESOURCE_PACK_MAX_BYTES = 32 * 1024 * 1024;
    private static final String METHOD_RESOURCE_PACK = "pickResourcePack";

    @PluginMethod
    public void pickFile(PluginCall call) {
        openPicker(call, PickerKind.LITEMATIC);
    }

    @PluginMethod
    public void pickResourcePack(PluginCall call) {
        openPicker(call, PickerKind.RESOURCE_PACK);
    }

    private void openPicker(PluginCall call, PickerKind kind) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        // Document providers report both Litematic and ZIP files inconsistently. Content parsers
        // remain authoritative, so MIME hints must not hide an otherwise valid local file.
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, kind.mimeHints);
        FocusIntegrityPlugin.setProductSystemUiOpen(true);
        try {
            startActivityForResult(call, intent, "filePicked");
        } catch (RuntimeException error) {
            FocusIntegrityPlugin.setProductSystemUiOpen(false);
            call.reject("Could not open the Android document picker", "PICKER_UNAVAILABLE", error);
        }
    }

    @ActivityCallback
    private void filePicked(PluginCall call, ActivityResult activityResult) {
        FocusIntegrityPlugin.setProductSystemUiOpen(false);
        Intent data = activityResult.getData();
        Uri uri = data == null ? null : data.getData();
        if (SafeDocumentReader.isCancelledResult(activityResult.getResultCode() == Activity.RESULT_OK, uri != null)) {
            JSObject result = new JSObject();
            result.put("cancelled", true);
            call.resolve(result);
            return;
        }
        PickerKind kind = METHOD_RESOURCE_PACK.equals(call.getMethodName()) ? PickerKind.RESOURCE_PACK : PickerKind.LITEMATIC;
        int maxBytes = SafeDocumentReader.clampRequestedMax(call.getInt("maxBytes"), kind.hardMaximumBytes);
        bridge.execute(() -> readContentUri(call, uri, maxBytes, kind));
    }

    private void readContentUri(PluginCall call, Uri uri, int maxBytes, PickerKind kind) {
        DocumentMetadata metadata = documentMetadata(uri, kind.fallbackName);
        if (metadata.declaredSize > maxBytes) {
            call.reject("Selected file exceeds the import limit", "FILE_TOO_LARGE");
            return;
        }
        try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
            if (input == null) {
                call.reject("Android returned an unreadable document URI", "FILE_UNREADABLE");
                return;
            }
            byte[] content = SafeDocumentReader.readBounded(input, maxBytes);
            JSObject result = new JSObject();
            result.put("cancelled", false);
            result.put("name", metadata.name);
            result.put("mimeType", SafeDocumentReader.safeMimeType(getContext().getContentResolver().getType(uri)));
            result.put("base64Data", Base64.encodeToString(content, Base64.NO_WRAP));
            call.resolve(result);
        } catch (SafeDocumentReader.FileTooLargeException error) {
            call.reject("Selected file exceeds the import limit", "FILE_TOO_LARGE");
        } catch (IOException | SecurityException | IllegalArgumentException error) {
            call.reject("Could not read the selected Android document", "FILE_UNREADABLE", error);
        }
    }

    private DocumentMetadata documentMetadata(Uri uri, String fallbackName) {
        String providerName = null;
        long declaredSize = -1;
        try (Cursor cursor = getContext().getContentResolver().query(
            uri,
            new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE },
            null,
            null,
            null
        )) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (nameIndex >= 0 && !cursor.isNull(nameIndex)) providerName = cursor.getString(nameIndex);
                int sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) declaredSize = cursor.getLong(sizeIndex);
            }
        } catch (RuntimeException ignored) {
            // The URI tail is still useful when a provider does not expose metadata.
        }
        String tail = uri.getLastPathSegment();
        return new DocumentMetadata(SafeDocumentReader.safeDisplayName(providerName, tail, fallbackName), declaredSize);
    }

    private enum PickerKind {
        LITEMATIC(LITEMATIC_MAX_BYTES, "import.litematic", new String[] {
            "application/octet-stream", "application/gzip", "application/x-gzip"
        }),
        RESOURCE_PACK(RESOURCE_PACK_MAX_BYTES, "resource-pack.zip", new String[] {
            "application/zip", "application/x-zip-compressed", "application/octet-stream"
        });

        final int hardMaximumBytes;
        final String fallbackName;
        final String[] mimeHints;

        PickerKind(int hardMaximumBytes, String fallbackName, String[] mimeHints) {
            this.hardMaximumBytes = hardMaximumBytes;
            this.fallbackName = fallbackName;
            this.mimeHints = mimeHints;
        }
    }

    private static final class DocumentMetadata {
        final String name;
        final long declaredSize;

        DocumentMetadata(String name, long declaredSize) {
            this.name = name;
            this.declaredSize = declaredSize;
        }
    }
}
