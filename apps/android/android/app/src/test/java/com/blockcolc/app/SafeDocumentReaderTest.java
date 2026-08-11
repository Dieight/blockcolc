package com.blockcolc.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import org.junit.Test;

public class SafeDocumentReaderTest {
    @Test
    public void readsAtExactBoundaryAndRejectsOneByteOver() throws Exception {
        byte[] exact = new byte[] { 1, 2, 3, 4 };
        assertArrayEquals(exact, SafeDocumentReader.readBounded(new ByteArrayInputStream(exact), 4));
        assertThrows(
            SafeDocumentReader.FileTooLargeException.class,
            () -> SafeDocumentReader.readBounded(new ByteArrayInputStream(new byte[] { 1, 2, 3, 4, 5 }), 4)
        );
    }

    @Test
    public void handlesShortAndZeroLengthReadsWithoutLosingBytes() throws Exception {
        InputStream unusual = new InputStream() {
            private final byte[] data = new byte[] { 9, 8, 7 };
            private int offset;
            private boolean returnedZero;

            @Override
            public int read(byte[] buffer, int start, int length) {
                if (!returnedZero) {
                    returnedZero = true;
                    return 0;
                }
                if (offset >= data.length) return -1;
                buffer[start] = data[offset++];
                return 1;
            }

            @Override
            public int read() {
                return offset >= data.length ? -1 : data[offset++];
            }
        };
        assertArrayEquals(new byte[] { 9, 8, 7 }, SafeDocumentReader.readBounded(unusual, 3));
    }

    @Test
    public void propagatesUnreadableStreamFailures() {
        InputStream broken = new InputStream() {
            @Override
            public int read() throws IOException {
                throw new IOException("provider disconnected");
            }

            @Override
            public int read(byte[] buffer, int offset, int length) throws IOException {
                throw new IOException("provider disconnected");
            }
        };
        assertThrows(IOException.class, () -> SafeDocumentReader.readBounded(broken, 10));
    }

    @Test
    public void clampsCallerLimitsToEachPluginHardMaximum() {
        assertEquals(100, SafeDocumentReader.clampRequestedMax(100, 1000));
        assertEquals(1000, SafeDocumentReader.clampRequestedMax(2000, 1000));
        assertEquals(1000, SafeDocumentReader.clampRequestedMax(0, 1000));
        assertEquals(1000, SafeDocumentReader.clampRequestedMax(null, 1000));
    }

    @Test
    public void treatsNonOkResultsOrMissingUrisAsCancellation() {
        assertEquals(false, SafeDocumentReader.isCancelledResult(true, true));
        assertEquals(true, SafeDocumentReader.isCancelledResult(false, true));
        assertEquals(true, SafeDocumentReader.isCancelledResult(true, false));
        assertEquals(true, SafeDocumentReader.isCancelledResult(false, false));
    }

    @Test
    public void sanitizesProviderNamesAndUsesStableFallbacks() {
        assertEquals("pack.zip", SafeDocumentReader.safeDisplayName("../../pack.zip", "ignored", "resource-pack.zip"));
        assertEquals("blueprint.litematic", SafeDocumentReader.safeDisplayName("blue\u0000print.litematic", null, "import.litematic"));
        assertEquals("resource-pack.zip", SafeDocumentReader.safeDisplayName("..", null, "resource-pack.zip"));
        assertEquals("uri-file.zip", SafeDocumentReader.safeDisplayName(null, "folder/uri-file.zip", "resource-pack.zip"));
    }

    @Test
    public void normalizesMimeWithoutTrustingMalformedProviderMetadata() {
        assertEquals("application/zip", SafeDocumentReader.safeMimeType(" Application/ZIP "));
        assertEquals("application/octet-stream", SafeDocumentReader.safeMimeType(null));
        assertEquals("application/octet-stream", SafeDocumentReader.safeMimeType("not-a-mime"));
        assertEquals("application/octet-stream", SafeDocumentReader.safeMimeType("application/zip\ntext/plain"));
    }
}
