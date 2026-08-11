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
