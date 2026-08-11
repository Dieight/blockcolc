import { afterEach, describe, expect, it, vi } from 'vitest';
import { readBrowserFileBytes } from './browser-adapters.js';

const originalFileReader = globalThis.FileReader;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalFileReader === undefined) Reflect.deleteProperty(globalThis, 'FileReader');
  else globalThis.FileReader = originalFileReader;
});

describe('browser binary file input', () => {
  it('reads a normal browser File through arrayBuffer', async () => {
    const file = { size: 4, arrayBuffer: async () => new Uint8Array([0x1f, 0x8b, 0x08, 0x00]).buffer } as unknown as File;
    await expect(readBrowserFileBytes(file, 4)).resolves.toEqual(new Uint8Array([0x1f, 0x8b, 0x08, 0x00]));
  });

  it('falls back to FileReader when WebView File.arrayBuffer rejects', async () => {
    class FakeFileReader {
      result: ArrayBuffer | null = null;
      error: DOMException | null = null;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      readAsArrayBuffer() {
        this.result = new Uint8Array([1, 2, 3]).buffer;
        this.onload?.();
      }
    }
    globalThis.FileReader = FakeFileReader as unknown as typeof FileReader;
    const file = { size: 3, arrayBuffer: async () => { throw new Error('provider URI unavailable'); } } as unknown as File;
    await expect(readBrowserFileBytes(file, 3)).resolves.toEqual(new Uint8Array([1, 2, 3]));
  });

  it('rejects declared and actual content beyond the configured limit', async () => {
    const declaredLarge = { size: 5, arrayBuffer: vi.fn() } as unknown as File;
    await expect(readBrowserFileBytes(declaredLarge, 4)).rejects.toMatchObject({ code: 'INPUT_TOO_LARGE' });
    expect(declaredLarge.arrayBuffer).not.toHaveBeenCalled();

    const actualLarge = { size: 1, arrayBuffer: async () => new Uint8Array(5).buffer } as unknown as File;
    await expect(readBrowserFileBytes(actualLarge, 4)).rejects.toMatchObject({ code: 'INPUT_TOO_LARGE' });
  });
});
