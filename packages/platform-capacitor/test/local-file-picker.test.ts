import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_NATIVE_RESOURCE_PACK_MAX_BYTES,
  decodeBase64,
  pickBinaryWithPlugin,
  pickNativeResourcePackFile,
  pickResourcePackWithPlugin,
  pickWithPlugin,
  type NativeFilePickerPlugin,
} from '../src/local-file-picker.js';

describe('native local file picker adapter', () => {
  it('decodes native content URI bytes without relying on WebView File.arrayBuffer', async () => {
    const plugin: NativeFilePickerPlugin = {
      pickFile: vi.fn(async () => ({ cancelled: false, name: 'sample.litematic', mimeType: 'application/octet-stream', base64Data: 'H4sIAA==' })),
    };
    const picked = await pickWithPlugin(plugin, 1024);
    expect(picked).toEqual({
      name: 'sample.litematic', mimeType: 'application/octet-stream', bytes: new Uint8Array([0x1f, 0x8b, 0x08, 0x00]),
    });
    expect(plugin.pickFile).toHaveBeenCalledWith({ maxBytes: 1024 });
  });

  it('returns null for a cancelled document picker', async () => {
    await expect(pickWithPlugin({ pickFile: async () => ({ cancelled: true }) }, 1024)).resolves.toBeNull();
  });

  it('provides a generic resource-pack ZIP contract while Web remains a no-op', async () => {
    expect(DEFAULT_NATIVE_RESOURCE_PACK_MAX_BYTES).toBe(32 * 1024 * 1024);
    const plugin: NativeFilePickerPlugin = {
      pickFile: vi.fn(async () => ({ cancelled: true })),
      pickResourcePack: vi.fn(async () => ({ cancelled: false, name: 'Faithful 16x.zip', mimeType: 'application/zip', base64Data: 'UEsDBA==' })),
    };
    await expect(pickResourcePackWithPlugin(plugin, 2048)).resolves.toEqual({
      name: 'Faithful 16x.zip', mimeType: 'application/zip', bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    });
    expect(plugin.pickResourcePack).toHaveBeenCalledWith({ maxBytes: 2048 });
    expect(plugin.pickFile).not.toHaveBeenCalled();
    await expect(pickNativeResourcePackFile()).resolves.toBeNull();
  });

  it('reassembles resource-pack bytes through bounded native chunks and always releases the cache file', async () => {
    const readResourcePackChunk = vi.fn(async ({ offset }: { offset: number }) => offset === 0
      ? { offset: 0, byteLength: 7, base64Data: 'AQIDBA==', done: false }
      : { offset: 4, byteLength: 7, base64Data: 'BQYH', done: true });
    const releaseResourcePack = vi.fn(async () => ({ released: true }));
    const plugin: NativeFilePickerPlugin = {
      pickFile: vi.fn(async () => ({ cancelled: true })),
      pickResourcePack: vi.fn(async () => ({
        cancelled: false,
        name: 'large-16x.zip',
        mimeType: 'application/zip',
        transport: 'chunked-base64' as const,
        transferId: '12345678-1234-1234-1234-123456789012',
        byteLength: 7,
        chunkBytes: 4,
      })),
      readResourcePackChunk,
      releaseResourcePack,
    };

    await expect(pickResourcePackWithPlugin(plugin, 8)).resolves.toEqual({
      name: 'large-16x.zip', mimeType: 'application/zip', bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7]),
    });
    expect(readResourcePackChunk).toHaveBeenNthCalledWith(1, {
      transferId: '12345678-1234-1234-1234-123456789012', offset: 0, maxBytes: 4,
    });
    expect(readResourcePackChunk).toHaveBeenNthCalledWith(2, {
      transferId: '12345678-1234-1234-1234-123456789012', offset: 4, maxBytes: 3,
    });
    expect(releaseResourcePack).toHaveBeenCalledOnce();
  });

  it('rejects inconsistent chunk streams and releases them after failure', async () => {
    const releaseResourcePack = vi.fn(async () => ({ released: true }));
    const plugin: NativeFilePickerPlugin = {
      pickFile: vi.fn(async () => ({ cancelled: true })),
      pickResourcePack: vi.fn(async () => ({
        cancelled: false,
        transport: 'chunked-base64' as const,
        transferId: 'transfer',
        byteLength: 3,
        chunkBytes: 3,
      })),
      readResourcePackChunk: vi.fn(async () => ({ offset: 1, byteLength: 3, base64Data: 'AQID', done: true })),
      releaseResourcePack,
    };
    await expect(pickResourcePackWithPlugin(plugin, 3)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(releaseResourcePack).toHaveBeenCalledOnce();
  });

  it('never falls back to the Litematic method when native resource-pack support is absent', async () => {
    const pickFile = vi.fn(async () => ({ cancelled: true }));
    await expect(pickResourcePackWithPlugin({ pickFile }, 2048)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(pickFile).not.toHaveBeenCalled();
  });

  it('uses kind-specific fallback names and preserves null MIME metadata', async () => {
    await expect(pickBinaryWithPlugin(
      { pickFile: async () => ({ cancelled: false, name: '   ', mimeType: null, base64Data: 'AQID' }) },
      { maxBytes: 4, fallbackName: 'resource-pack.zip' },
    )).resolves.toEqual({ name: 'resource-pack.zip', mimeType: null, bytes: new Uint8Array([1, 2, 3]) });
  });

  it('rejects malformed base64 and oversized native results', async () => {
    expect(() => decodeBase64('%%%')).toThrow('invalid base64');
    expect(() => decodeBase64('AQI')).toThrow('invalid base64');
    expect(() => decodeBase64('AQ I=')).toThrow('invalid base64');
    await expect(pickWithPlugin({ pickFile: async () => ({ cancelled: false, base64Data: 'AQID' }) }, 2)).rejects.toThrow('larger');
    await expect(pickWithPlugin({ pickFile: async () => ({ cancelled: false, base64Data: 'AAAAAA==' }) }, 3)).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });

  it('rejects invalid limits, native response shapes, and malformed metadata', async () => {
    await expect(pickBinaryWithPlugin(
      { pickFile: async () => ({ cancelled: true }) },
      { maxBytes: 0, fallbackName: 'resource-pack.zip' },
    )).rejects.toMatchObject({ code: 'INVALID_LIMIT' });
    await expect(pickBinaryWithPlugin(
      { pickFile: async () => ({ cancelled: 'no' } as never) },
      { maxBytes: 10, fallbackName: 'resource-pack.zip' },
    )).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(pickBinaryWithPlugin(
      { pickFile: async () => ({ cancelled: false, name: 12 as never, base64Data: 'AQID' }) },
      { maxBytes: 10, fallbackName: 'resource-pack.zip' },
    )).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
