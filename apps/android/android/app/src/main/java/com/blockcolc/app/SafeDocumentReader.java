package com.blockcolc.app;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;

final class SafeDocumentReader {
    static final int BUFFER_BYTES = 8192;
    static final int MAX_DISPLAY_NAME_CHARS = 255;
    static final int MAX_MIME_CHARS = 127;

    private SafeDocumentReader() {}

    static byte[] readBounded(InputStream input, int maxBytes) throws IOException, FileTooLargeException {
        if (input == null) throw new IllegalArgumentException("input is required");
        if (maxBytes <= 0) throw new IllegalArgumentException("maxBytes must be positive");
        ByteArrayOutputStream output = new ByteArrayOutputStream(Math.min(maxBytes, BUFFER_BYTES));
        byte[] buffer = new byte[BUFFER_BYTES];
        int total = 0;
        while (true) {
            int count = input.read(buffer);
            if (count == -1) break;
            if (count == 0) {
                int single = input.read();
                if (single == -1) break;
                if (total == maxBytes) throw new FileTooLargeException();
                output.write(single);
                total += 1;
                continue;
            }
            if (count > maxBytes - total) throw new FileTooLargeException();
            output.write(buffer, 0, count);
            total += count;
        }
        return output.toByteArray();
    }

    static int clampRequestedMax(Integer requested, int hardMaximum) {
        if (hardMaximum <= 0) throw new IllegalArgumentException("hardMaximum must be positive");
        if (requested == null || requested <= 0) return hardMaximum;
        return Math.min(requested, hardMaximum);
    }

    static boolean isCancelledResult(boolean resultOk, boolean hasDocumentUri) {
        return !resultOk || !hasDocumentUri;
    }

    static String safeDisplayName(String providerName, String uriTail, String fallbackName) {
        String candidate = firstNonBlank(providerName, uriTail, fallbackName);
        candidate = candidate.replace('\\', '/');
        int separator = candidate.lastIndexOf('/');
        if (separator >= 0) candidate = candidate.substring(separator + 1);
        StringBuilder safe = new StringBuilder(Math.min(candidate.length(), MAX_DISPLAY_NAME_CHARS));
        for (int index = 0; index < candidate.length() && safe.length() < MAX_DISPLAY_NAME_CHARS; index += 1) {
            char value = candidate.charAt(index);
            if (!Character.isISOControl(value)) safe.append(value);
        }
        String result = safe.toString().trim();
        return result.isEmpty() || result.equals(".") || result.equals("..") ? fallbackName : result;
    }

    static String safeMimeType(String providerMime) {
        if (providerMime == null) return "application/octet-stream";
        String value = providerMime.trim().toLowerCase(Locale.ROOT);
        if (value.isEmpty() || value.length() > MAX_MIME_CHARS || value.indexOf('/') <= 0) {
            return "application/octet-stream";
        }
        for (int index = 0; index < value.length(); index += 1) {
            char character = value.charAt(index);
            if (Character.isISOControl(character) || Character.isWhitespace(character)) return "application/octet-stream";
        }
        return value;
    }

    private static String firstNonBlank(String first, String second, String fallback) {
        if (first != null && !first.isBlank()) return first;
        if (second != null && !second.isBlank()) return second;
        return fallback;
    }

    static final class FileTooLargeException extends Exception {
        private static final long serialVersionUID = 1L;
    }
}
