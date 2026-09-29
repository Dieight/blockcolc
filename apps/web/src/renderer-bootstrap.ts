/**
 * Coordinates the one-time world+atlas adoption for a renderer generation.
 * Snapshot updates are retained while initialization is pending and applied
 * only if their stable owner key differs from the snapshot adopted at boot.
 */
export interface KeyedWorldSnapshot<T> {
  key: string;
  worlds: T;
}

export interface RendererWorldSnapshotPort<T> {
  setWorlds(worlds: T): void;
}

export interface RendererWorldSnapshotOwner<T> {
  latest(): KeyedWorldSnapshot<T>;
  observe(snapshot: KeyedWorldSnapshot<T>): void;
  prepared(adoptedSnapshotKey: string): void;
  dispose(): void;
}

export function createRendererWorldSnapshotCoordinator<
  TWorlds,
  TRenderer extends RendererWorldSnapshotPort<TWorlds>,
>(renderer: TRenderer, initial: KeyedWorldSnapshot<TWorlds>, onWorldsRebuildRequested?: (snapshot: KeyedWorldSnapshot<TWorlds>) => void): RendererWorldSnapshotOwner<TWorlds> {
  let latest = initial;
  let adoptedKey: string | null = null;
  let phase: 'initializing' | 'prepared' | 'disposed' = 'initializing';

  const applyLatestIfChanged = (): void => {
    if (phase !== 'prepared' || adoptedKey === latest.key) return;
    onWorldsRebuildRequested?.(latest);
    renderer.setWorlds(latest.worlds);
    adoptedKey = latest.key;
  };

  return {
    latest(): KeyedWorldSnapshot<TWorlds> {
      return latest;
    },
    observe(snapshot: KeyedWorldSnapshot<TWorlds>): void {
      if (phase === 'disposed') return;
      latest = snapshot;
      applyLatestIfChanged();
    },
    prepared(adoptedSnapshotKey: string): void {
      if (phase === 'disposed') return;
      if (phase === 'prepared') {
        applyLatestIfChanged();
        return;
      }
      phase = 'prepared';
      adoptedKey = adoptedSnapshotKey;
      applyLatestIfChanged();
    },
    dispose(): void {
      phase = 'disposed';
    },
  };
}

export interface InitializeRendererWorldsPorts<TWorlds, TPack> {
  isCurrent(): boolean;
  latestSnapshot(): KeyedWorldSnapshot<TWorlds>;
  resolvePack(): Promise<TPack | null>;
  initializeWorlds(worlds: TWorlds, pack: TPack | null): Promise<void>;
  onWorldsInitializationRequested?(snapshot: KeyedWorldSnapshot<TWorlds>): void;
  onError(error: unknown): void;
  onPrepared(snapshotKey: string, pack: TPack | null, requestedPack: TPack | null, packReadFailed: boolean): void;
}

/**
 * Resolve the selected pack, then sample the latest world snapshot immediately
 * before the renderer's atomic initialization. If a selected pack cannot be
 * read or adopted, retain the error and retry with the latest worlds untextured.
 * A stale generation never falls back, reports, or marks itself prepared.
 */
export async function initializeRendererWorlds<TWorlds, TPack>(
  ports: InitializeRendererWorldsPorts<TWorlds, TPack>,
): Promise<'prepared' | 'stale'> {
  let pack: TPack | null = null;
  let packFailure: unknown;
  let packFailed = false;
  try {
    pack = await ports.resolvePack();
  } catch (error) {
    if (!ports.isCurrent()) return 'stale';
    packFailure = error;
    packFailed = true;
  }
  if (!ports.isCurrent()) return 'stale';
  if (packFailed) ports.onError(packFailure);
  const requestedPack = packFailed ? null : pack;

  let snapshot = ports.latestSnapshot();
  if (ports.isCurrent()) {
    try {
      ports.onWorldsInitializationRequested?.(snapshot);
      await ports.initializeWorlds(snapshot.worlds, packFailed ? null : pack);
      if (!ports.isCurrent()) return 'stale';
      ports.onPrepared(snapshot.key, packFailed ? null : pack, requestedPack, packFailed);
      return 'prepared';
    } catch (error) {
      if (!ports.isCurrent()) return 'stale';
      if (pack === null || packFailed) throw error;
      ports.onError(error);
      pack = null;
    }
  } else {
    return 'stale';
  }

  // The world snapshot may have advanced during the failed atlas attempt.
  // Adopt that newest snapshot in the safe no-pack fallback.
  snapshot = ports.latestSnapshot();
  ports.onWorldsInitializationRequested?.(snapshot);
  await ports.initializeWorlds(snapshot.worlds, null);
  if (!ports.isCurrent()) return 'stale';
  ports.onPrepared(snapshot.key, null, requestedPack, false);
  return 'prepared';
}
