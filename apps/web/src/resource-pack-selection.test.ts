import { describe, expect, it } from 'vitest';
import type { ResourcePackManifest } from '@tomato-clock/resource-pack';
import type { ResourcePackRepository, StoredResourcePack } from '@tomato-clock/resource-pack-indexeddb';
import { resolveSelectedResourcePack } from './resource-pack-selection';

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
