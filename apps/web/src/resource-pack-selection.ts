import type { ResourcePackManifest } from '@tomato-clock/resource-pack';
import type { ResourcePackRepository, StoredResourcePack } from '@tomato-clock/resource-pack-indexeddb';

export interface ResolvedResourcePack {
  id: string;
  name: string;
  manifest: ResourcePackManifest;
}

/** The active pack has Minecraft's upper-layer priority. A user-supplied base
 * fills resources absent from that pack; neither archive is rewritten. */
export async function resolveSelectedResourcePack(repository: ResourcePackRepository): Promise<ResolvedResourcePack | null> {
  const [active, base] = await Promise.all([repository.getActive(), repository.getBase()]);
  if (!active && !base) return null;
  if (!active || !base || active.id === base.id) return fromStoredPack(active ?? base!);
  const { layerResourcePackManifests } = await import('@tomato-clock/resource-pack');
  return {
    id: `layer:${base.id}:${active.id}`,
    name: `${active.name}（基础：${base.name}）`,
    manifest: layerResourcePackManifests(base.manifest, active.manifest),
  };
}

function fromStoredPack(pack: StoredResourcePack): ResolvedResourcePack {
  return { id: pack.id, name: pack.name, manifest: pack.manifest };
}
