package com.milonfinance.app;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import com.getcapacitor.JSObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;

/** Reads a receipt the person chose. Nothing here is logged. */
final class MilonPickedFile {

    static final int MAX_BYTES = 20 * 1024 * 1024;

    static final String[] DOCUMENT_MIME_TYPES = {
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/heic",
        "image/heif"
    };

    private MilonPickedFile() {}

    static JSObject cancelled() {
        JSObject result = new JSObject();
        result.put("cancelled", true);
        return result;
    }

    static JSObject error(String message) {
        JSObject result = new JSObject();
        result.put("cancelled", false);
        result.put("error", message);
        return result;
    }

    static JSObject fromBytes(String name, String mime, byte[] bytes) {
        if (bytes == null || bytes.length == 0) return error("This file is empty.");
        if (bytes.length > MAX_BYTES) return error("This file is over 20 MB.");
        JSObject result = new JSObject();
        result.put("cancelled", false);
        result.put("name", safeName(name));
        result.put("mime", mime == null ? "" : mime);
        result.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
        return result;
    }

    static byte[] readCapped(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int total = 0;
        int n;
        while ((n = in.read(buf)) >= 0) {
            total += n;
            if (total > MAX_BYTES) {
                throw new IOException("file too large");
            }
            out.write(buf, 0, n);
        }
        return out.toByteArray();
    }

    static String displayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) {
                    String name = cursor.getString(idx);
                    if (name != null && !name.trim().isEmpty()) return safeName(name);
                }
            }
        } catch (RuntimeException ignored) {
            /* fall through to a generic name */
        }
        return "upload";
    }

    static String safeName(String name) {
        if (name == null) return "upload";
        String trimmed = name.trim();
        int slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
        if (slash >= 0 && slash + 1 < trimmed.length()) trimmed = trimmed.substring(slash + 1);
        if (trimmed.isEmpty()) return "upload";
        return trimmed;
    }

    static String extension(String name) {
        int dot = name.lastIndexOf('.');
        if (dot < 0 || dot + 1 >= name.length()) return "";
        return name.substring(dot + 1).toLowerCase(Locale.US);
    }
}
