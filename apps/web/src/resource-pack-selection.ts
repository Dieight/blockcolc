import type { ResourcePackManifest } from '@blockcolc/resource-pack';
import type { ResourcePackRepository, ResourcePackSelectionMetadata, StoredResourcePack } from '@blockcolc/resource-pack-indexeddb';
import { qualityLifecycleProbeEnabled, recordQualityLifecyclePhase } from './quality-lifecycle-performance';

export interface ResolvedResourcePack {
  id: string;
  name: string;
  manifest: ResourcePackManifest;
}

export interface ResolvedResourcePackState {
  pack: ResolvedResourcePack | null;
  metadata: ResourcePackSelectionMetadata | null;
  unchanged: boolean;
}

/** Uses small durable selection identity to dedupe only an already-adopted pack.
 * Any change is still resolved through the strict full-record path, then checked
 * against a second identity read so a stale async selection cannot be adopted. */
export async function resolveSelectedResourcePackState(
  repository: ResourcePackRepository,
  adoptedMetadata: ResourcePackSelectionMetadata | null,
  forceFullValidation = false,
): Promise<ResolvedResourcePackState> {
  if (!repository.getSelectionMetadata) {
    return { pack: await resolveSelectedResourcePack(repository), metadata: null, unchanged: false };
  }
  let current: ResourcePackSelectionMetadata | null = null;
  try {
    current = await readSelectionMetadata(repository);
  } catch {
    return { pack: await resolveSelectedResourcePack(repository), metadata: null, unchanged: false };
  }
  if (!forceFullValidation && adoptedMetadata && isValidSelectionMetadata(adoptedMetadata)
    && isValidSelectionMetadata(current) && sameSelectionMetadata(adoptedMetadata, current)) {
    return { pack: null, metadata: current, unchanged: true };
  }
  if (!isValidSelectionMetadata(current)) {
    return { pack: await resolveSelectedResourcePack(repository), metadata: null, unchanged: false };
  }
  let before = current;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const pack = await resolveSelectedResourcePack(repository);
    let after: ResourcePackSelectionMetadata;
    try {
      after = await readSelectionMetadata(repository);
    } catch {
      return { pack, metadata: null, unchanged: false };
    }
    if (!isValidSelectionMetadata(after)) return { pack, metadata: null, unchanged: false };
    if (sameSelectionMetadata(before, after)) return { pack, metadata: after, unchanged: false };
    before = after;
  }
  throw new Error('Resource-pack selection changed repeatedly while it was being validated.');
}

export async function readSelectionMetadata(repository: ResourcePackRepository): Promise<ResourcePackSelectionMetadata> {
  if (!repository.getSelectionMetadata) throw new Error('Selection metadata capability is unavailable.');
  const measureLifecycle = qualityLifecycleProbeEnabled();
  const startedAt = measureLifecycle ? performance.now() : 0;
  try {
    const metadata = await repository.getSelectionMetadata();
    recordQualityLifecyclePhase('selection-metadata-read-end', {
      durationMs: measureLifecycle ? performance.now() - startedAt : undefined,
      status: 'ok',
    });
    return metadata;
  } catch (error) {
    recordQualityLifecyclePhase('selection-metadata-read-end', {
      durationMs: measureLifecycle ? performance.now() - startedAt : undefined,
      status: 'failed',
    });
    throw error;
  }
}

export function sameSelectionMetadata(left: ResourcePackSelectionMetadata, right: ResourcePackSelectionMetadata): boolean {
  return left.revision === right.revision && left.activeId === right.activeId && left.baseId === right.baseId;
}

function isValidSelectionMetadata(value: unknown): value is ResourcePackSelectionMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const metadata = value as Record<string, unknown>;
  return typeof metadata.revision === 'string' && metadata.revision.length > 0
    && (metadata.activeId === null || typeof metadata.activeId === 'string')
    && (metadata.baseId === null || typeof metadata.baseId === 'string');
}

/** The active pack has Minecraft's upper-layer priority. A user-supplied base
 * fills resources absent from that pack; neither archive is rewritten. */
export async function resolveSelectedResourcePack(repository: ResourcePackRepository): Promise<ResolvedResourcePack | null> {
  const measureLifecycle = qualityLifecycleProbeEnabled();
  const readStartedAt = measureLifecycle ? performance.now() : 0;
  let active: StoredResourcePack | null | undefined;
  let base: StoredResourcePack | null | undefined;
  try {
    [active, base] = await Promise.all([repository.getActive(), repository.getBase()]);
  } catch (error) {
    recordQualityLifecyclePhase('selection-read-end', { durationMs: measureLifecycle ? performance.now() - readStartedAt : undefined, status: 'failed' });
    throw error;
  }
  recordQualityLifecyclePhase('selection-read-end', { durationMs: measureLifecycle ? performance.now() - readStartedAt : undefined, status: 'ok' });
  if (!active && !base) return null;
  if (!active || !base || active.id === base.id) return fromStoredPack(active ?? base!);
  const layerStartedAt = measureLifecycle ? performance.now() : 0;
  try {
    const { layerResourcePackManifests } = await import('@blockcolc/resource-pack');
    const manifest = layerResourcePackManifests(base.manifest, active.manifest);
    recordQualityLifecyclePhase('manifest-layer-end', { durationMs: measureLifecycle ? performance.now() - layerStartedAt : undefined, status: 'ok' });
    return {
      id: `layer:${base.id}:${active.id}`,
      name: `${active.name}（基础：${base.name}）`,
      manifest,
    };
  } catch (error) {
    recordQualityLifecyclePhase('manifest-layer-end', { durationMs: measureLifecycle ? performance.now() - layerStartedAt : undefined, status: 'failed' });
    throw error;
  }
}

function fromStoredPack(pack: StoredResourcePack): ResolvedResourcePack {
  return { id: pack.id, name: pack.name, manifest: pack.manifest };
}
