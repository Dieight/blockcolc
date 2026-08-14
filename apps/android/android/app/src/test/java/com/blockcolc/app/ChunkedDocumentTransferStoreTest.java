package com.blockcolc.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.nio.file.Files;
import org.junit.Test;

public class ChunkedDocumentTransferStoreTest {
    @Test
    public void streamsAndReassemblesBoundedChunksWithoutExposingAPath() throws Exception {
        File directory = Files.createTempDirectory("tomato-resource-pack").toFile();
        ChunkedDocumentTransferStore store = new ChunkedDocumentTransferStore(directory, 4);
        byte[] source = new byte[] { 1, 2, 3, 4, 5, 6, 7 };
        ChunkedDocumentTransferStore.TransferMetadata transfer = store.prepare(new ByteArrayInputStream(source), 7);

        assertEquals(7, transfer.byteLength);
        assertEquals(36, transfer.transferId.length());
        ChunkedDocumentTransferStore.Chunk first = store.read(transfer.transferId, 0, 4);
        ChunkedDocumentTransferStore.Chunk second = store.read(transfer.transferId, 4, 4);
        assertArrayEquals(new byte[] { 1, 2, 3, 4 }, first.bytes);
        assertArrayEquals(new byte[] { 5, 6, 7 }, second.bytes);
        assertFalse(first.done());
        assertTrue(second.done());
        assertTrue(store.release(transfer.transferId));
        assertThrows(ChunkedDocumentTransferStore.TransferNotFoundException.class, () -> store.read(transfer.transferId, 0, 1));
        directory.delete();
    }

    @Test
    public void rejectsOversizedSourcesAndChunkRequests() throws Exception {
        File directory = Files.createTempDirectory("tomato-resource-pack-limit").toFile();
        ChunkedDocumentTransferStore store = new ChunkedDocumentTransferStore(directory, 4);
        assertThrows(
            SafeDocumentReader.FileTooLargeException.class,
            () -> store.prepare(new ByteArrayInputStream(new byte[] { 1, 2, 3 }), 2)
        );
        ChunkedDocumentTransferStore.TransferMetadata transfer = store.prepare(new ByteArrayInputStream(new byte[] { 1 }), 1);
        assertThrows(IllegalArgumentException.class, () -> store.read(transfer.transferId, 0, 5));
        store.clear();
        directory.delete();
    }
}
