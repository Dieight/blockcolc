import { describe, expect, it } from 'vitest';
import type { ResourcePackManifest } from '@blockcolc/resource-pack';
import type { ResourcePackRepository, ResourcePackSelectionMetadata, StoredResourcePack } from '@blockcolc/resource-pack-indexeddb';
import { resolveSelectedResourcePack, resolveSelectedResourcePackState } from './resource-pack-selection';

function stored(id: string, textureIds: string[]): StoredResourcePack {
  const manifest: ResourcePackManifest = {
    schemaVersion: 1,
    pack: { packFormat: 97, description: id },
    textures: textureIds.map(resourceId => ({ resourceId, namespace: 'minecraft', texturePath: resourceId,
      archivePath: `assets/minecraft/textures/${resourceId}.png`, width: 16, height: 16, png: new Uint8Array([1]) })),
    blockStates: [], models: [],
    summary: { archiveFileCount: textureIds.length, candidateTextureCount: textureIds.length,
      acceptedTextureCount: textureIds.length, rejectedTextureCount: 0, ignoredFileCount: 0,
      namespaces: ['minecraft'], issues: [] },
  };
  return { schemaVersion: 1, id, name: id, importedAt: '2026-09-24T00:00:00.000Z',
    archive: new Uint8Array([1]), manifest };
}

function selected(active?: StoredResourcePack, base?: StoredResourcePack): ResourcePackRepository {
  return { getActive: async () => active, getBase: async () => base } as ResourcePackRepository;
}

describe('selected resource-pack layers', () => {
  it('returns original material mode only when both roles are empty', async () => {
    expect(await resolveSelectedResourcePack(selected())).toBeNull();
  });

  it('can render a user-supplied base alone, without an active overlay', async () => {
    const base = stored('base', ['minecraft:block/stone']);
    expect(await resolveSelectedResourcePack(selected(undefined, base))).toMatchObject({ id: 'base', manifest: base.manifest });
  });

  it('lets the active pack override base textures and inherit missing textures', async () => {
    const base = stored('base', ['minecraft:block/stone', 'minecraft:block/dirt']);
    const active = stored('active', ['minecraft:block/stone']);
    const resolved = await resolveSelectedResourcePack(selected(active, base));
    expect(resolved?.id).toBe('layer:base:active');
    expect(resolved?.manifest.textures.map(texture => texture.resourceId)).toEqual([
      'minecraft:block/dirt', 'minecraft:block/stone',
    ]);
    expect(resolved?.manifest.textures.find(texture => texture.resourceId === 'minecraft:block/stone')?.png)
      .toBe(active.manifest.textures[0]?.png);
  });

  it('does not double-layer a pack selected in both roles', async () => {
    const pack = stored('same', ['minecraft:block/stone']);
    expect((await resolveSelectedResourcePack(selected(pack, pack)))?.id).toBe('same');
  });
});

describe('light selection identity', () => {
  it('skips full archive reads only for an already adopted unchanged identity', async () => {
    const metadata = { revision: 'r1', activeId: null, baseId: 'base' };
    const repository = {
      getSelectionMetadata: async () => metadata,
      getActive: async () => { throw new Error('full active read must be skipped'); },
      getBase: async () => { throw new Error('full base read must be skipped'); },
    } as unknown as ResourcePackRepository;
    await expect(resolveSelectedResourcePackState(repository, metadata)).resolves.toMatchObject({
      pack: null, metadata, unchanged: true,
    });
  });

  it('forces strict reads for cold bootstrap and adopts only a stable metadata snapshot', async () => {
    const base = stored('base', ['minecraft:block/stone']);
    const snapshots = [
      { revision: 'r1', activeId: null, baseId: 'base' },
      { revision: 'r1', activeId: null, baseId: 'base' },
    ];
    let fullReads = 0;
    const repository = {
      getSelectionMetadata: async () => snapshots.shift()!,
      getActive: async () => { fullReads += 1; return undefined; },
      getBase: async () => { fullReads += 1; return base; },
    } as unknown as ResourcePackRepository;
    const result = await resolveSelectedResourcePackState(repository, null);
    expect(result).toMatchObject({ pack: { id: 'base' }, metadata: { revision: 'r1' }, unchanged: false });
    expect(fullReads).toBe(2);
  });

  it('retries a full read when the selection changes during validation', async () => {
    const base = stored('base', ['minecraft:block/stone']);
    const other = stored('other', ['minecraft:block/dirt']);
    const snapshots = [
      { revision: 'r1', activeId: null, baseId: 'base' },
      { revision: 'r2', activeId: null, baseId: 'other' },
      { revision: 'r2', activeId: null, baseId: 'other' },
      { revision: 'r2', activeId: null, baseId: 'other' },
    ];
    let fullReads = 0;
    const repository = {
      getSelectionMetadata: async () => snapshots.shift()!,
      getActive: async () => { fullReads += 1; return undefined; },
      getBase: async () => { fullReads += 1; return fullReads <= 2 ? base : other; },
    } as unknown as ResourcePackRepository;
    const result = await resolveSelectedResourcePackState(repository, null);
    expect(result.pack?.id).toBe('other');
    expect(result.metadata?.revision).toBe('r2');
    expect(fullReads).toBe(4);
  });

  it('preserves full-read behavior for adapters without metadata support', async () => {
    const base = stored('base', ['minecraft:block/stone']);
    let fullReads = 0;
    const repository = {
      getActive: async () => { fullReads += 1; return undefined; },
      getBase: async () => { fullReads += 1; return base; },
    } as unknown as ResourcePackRepository;
    const result = await resolveSelectedResourcePackState(repository, null);
    expect(result.pack?.id).toBe('base');
    expect(result.metadata).toBeNull();
    expect(fullReads).toBe(2);
  });

  it('falls back to strict validation when metadata throws or is malformed', async () => {
    const base = stored('base', ['minecraft:block/stone']);
    for (const getSelectionMetadata of [
      async () => { throw new Error('metadata unavailable'); },
      async () => ({ revision: '', activeId: null, baseId: 'base' }),
    ]) {
      let fullReads = 0;
      const repository = {
        getSelectionMetadata,
        getActive: async () => { fullReads += 1; return undefined; },
        getBase: async () => { fullReads += 1; return base; },
      } as unknown as ResourcePackRepository;
      const result = await resolveSelectedResourcePackState(repository, {
        revision: 'old', activeId: null, baseId: 'base',
      });
      expect(result.pack?.id).toBe('base');
      expect(result.metadata).toBeNull();
      expect(result.unchanged).toBe(false);
      expect(fullReads).toBe(2);
    }
  });

  it('strictly validates undefined, null, arrays, and primitive metadata on cold and adopted reads', async () => {
    const base = stored('base', ['minecraft:block/stone']);
    const malformed: unknown[] = [undefined, null, [], 'metadata', 7, false,
      { revision: 'r1', activeId: 0, baseId: 'base' }];
    for (const bad of malformed) {
      for (const adoptedMetadata of [null, { revision: 'old', activeId: null, baseId: 'base' }]) {
        let call = 0;
        let fullReads = 0;
        const repository = {
          getSelectionMetadata: async () => { call += 1; return bad; },
          getActive: async () => { fullReads += 1; return undefined; },
          getBase: async () => { fullReads += 1; return base; },
        } as unknown as ResourcePackRepository;
        const result = await resolveSelectedResourcePackState(repository, adoptedMetadata as ResourcePackSelectionMetadata | null);
        expect(result).toMatchObject({ pack: { id: 'base' }, metadata: null, unchanged: false });
        expect(fullReads).toBe(2);
        expect(call).toBe(1);
      }
    }
  });

  it('does not cache-hit or skip strict reads when the second metadata read throws or is malformed', async () => {
    const base = stored('base', ['minecraft:block/stone']);
    for (const second of [
      async () => { throw new Error('second metadata read unavailable'); },
      async () => undefined,
      async () => null,
      async () => [],
      async () => 'bad',
    ]) {
      let metadataCalls = 0;
      let fullReads = 0;
      const repository = {
        getSelectionMetadata: async () => {
          metadataCalls += 1;
          return metadataCalls === 1 ? { revision: 'r1', activeId: null, baseId: 'base' } : second();
        },
        getActive: async () => { fullReads += 1; return undefined; },
        getBase: async () => { fullReads += 1; return base; },
      } as unknown as ResourcePackRepository;
      const result = await resolveSelectedResourcePackState(repository, {
        revision: 'previous', activeId: null, baseId: 'base',
      });
      expect(result).toMatchObject({ pack: { id: 'base' }, metadata: null, unchanged: false });
      expect(metadataCalls).toBe(2);
      expect(fullReads).toBe(2);
    }
  });

  it('does not let malformed adopted metadata create a cache hit', async () => {
    const base = stored('base', ['minecraft:block/stone']);
    const repository = {
      getSelectionMetadata: async () => ({ revision: 'r1', activeId: null, baseId: 'base' }),
      getActive: async () => undefined,
      getBase: async () => base,
    } as unknown as ResourcePackRepository;
    const result = await resolveSelectedResourcePackState(repository, {
      revision: '', activeId: null, baseId: 'base',
    });
    expect(result.unchanged).toBe(false);
    expect(result.pack?.id).toBe('base');
  });
});
