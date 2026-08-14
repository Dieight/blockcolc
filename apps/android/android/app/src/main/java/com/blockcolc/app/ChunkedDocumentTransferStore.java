package com.blockcolc.app;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

final class ChunkedDocumentTransferStore {
    private final File directory;
    private final int maximumChunkBytes;
    private final Map<String, TransferMetadata> transfers = new HashMap<>();

    ChunkedDocumentTransferStore(File directory, int maximumChunkBytes) {
        if (directory == null) throw new IllegalArgumentException("directory is required");
        if (maximumChunkBytes <= 0) throw new IllegalArgumentException("maximumChunkBytes must be positive");
        this.directory = directory;
        this.maximumChunkBytes = maximumChunkBytes;
    }

    synchronized TransferMetadata prepare(InputStream input, int maxBytes)
        throws IOException, SafeDocumentReader.FileTooLargeException {
        clear();
        if (!directory.exists() && !directory.mkdirs()) throw new IOException("Could not create transfer directory");
        String transferId = UUID.randomUUID().toString();
        File file = new File(directory, transferId + ".bin");
        try (FileOutputStream output = new FileOutputStream(file)) {
            int byteLength = SafeDocumentReader.copyBounded(input, output, maxBytes);
            TransferMetadata metadata = new TransferMetadata(transferId, file, byteLength);
            transfers.put(transferId, metadata);
            return metadata;
        } catch (IOException | SafeDocumentReader.FileTooLargeException error) {
            file.delete();
            throw error;
        }
    }

    synchronized Chunk read(String transferId, int offset, int requestedBytes) throws IOException {
        TransferMetadata metadata = transfers.get(transferId);
        if (metadata == null) throw new TransferNotFoundException();
        if (offset < 0 || offset > metadata.byteLength) throw new IllegalArgumentException("offset is outside the transfer");
        if (requestedBytes <= 0 || requestedBytes > maximumChunkBytes) {
            throw new IllegalArgumentException("requestedBytes is outside the chunk limit");
        }
        int count = Math.min(requestedBytes, metadata.byteLength - offset);
        byte[] bytes = new byte[count];
        try (RandomAccessFile input = new RandomAccessFile(metadata.file, "r")) {
            input.seek(offset);
            input.readFully(bytes);
        }
        return new Chunk(offset, metadata.byteLength, bytes);
    }

    synchronized boolean release(String transferId) {
        TransferMetadata metadata = transfers.remove(transferId);
        return metadata != null && (!metadata.file.exists() || metadata.file.delete());
    }

    synchronized void clear() {
        for (TransferMetadata metadata : transfers.values()) metadata.file.delete();
        transfers.clear();
        if (!directory.isDirectory()) return;
        File[] staleFiles = directory.listFiles((ignored, name) -> name.endsWith(".bin"));
        if (staleFiles != null) for (File staleFile : staleFiles) staleFile.delete();
    }

    int maximumChunkBytes() {
        return maximumChunkBytes;
    }

    static final class TransferMetadata {
        final String transferId;
        final File file;
        final int byteLength;

        TransferMetadata(String transferId, File file, int byteLength) {
            this.transferId = transferId;
            this.file = file;
            this.byteLength = byteLength;
        }
    }

    static final class Chunk {
        final int offset;
        final int byteLength;
        final byte[] bytes;

        Chunk(int offset, int byteLength, byte[] bytes) {
            this.offset = offset;
            this.byteLength = byteLength;
            this.bytes = bytes;
        }

        boolean done() {
            return offset + bytes.length == byteLength;
        }
    }

    static final class TransferNotFoundException extends IOException {
        private static final long serialVersionUID = 1L;
    }
}
