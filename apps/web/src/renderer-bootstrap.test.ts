import { describe, expect, it, vi } from 'vitest';
import { createRendererWorldSnapshotCoordinator, initializeRendererWorlds } from './renderer-bootstrap';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

describe('renderer bootstrap world ownership', () => {
  it.each([null, { id: 'selected-pack' }])('adopts worlds and the selected pack in one initialization (%s)', async pack => {
    const initializeWorlds = vi.fn(async () => {});
    const onWorldsInitializationRequested = vi.fn();
    const onPrepared = vi.fn();
    const result = await initializeRendererWorlds({
      isCurrent: () => true,
      latestSnapshot: () => ({ key: 'latest', worlds: ['world-latest'] }),
      resolvePack: async () => pack,
      initializeWorlds,
      onWorldsInitializationRequested,
      onError: vi.fn(),
      onPrepared,
    });
    expect(result).toBe('prepared');
    expect(initializeWorlds).toHaveBeenCalledTimes(1);
    expect(initializeWorlds).toHaveBeenCalledWith(['world-latest'], pack);
    expect(onWorldsInitializationRequested).toHaveBeenCalledWith({ key: 'latest', worlds: ['world-latest'] });
    expect(onPrepared).toHaveBeenCalledWith('latest', pack, pack, false);
  });

  it('uses the newest snapshot after selected-pack resolution settles', async () => {
    const pack = deferred<{ id: string } | null>();
    let current = { key: 'first', worlds: ['first'] };
    const initializeWorlds = vi.fn(async () => {});
    const pending = initializeRendererWorlds({
      isCurrent: () => true,
      latestSnapshot: () => current,
      resolvePack: () => pack.promise,
      initializeWorlds,
      onError: vi.fn(),
      onPrepared: vi.fn(),
    });
    current = { key: 'newest', worlds: ['newest'] };
    pack.resolve({ id: 'pack' });
    await pending;
    expect(initializeWorlds).toHaveBeenCalledTimes(1);
    expect(initializeWorlds).toHaveBeenCalledWith(['newest'], { id: 'pack' });
  });

  it('falls back without a pack when selected-pack reading fails and retains the error', async () => {
    const error = new Error('pack read failed');
    const initializeWorlds = vi.fn(async () => {});
    const onError = vi.fn();
    const onPrepared = vi.fn();
    await expect(initializeRendererWorlds({
      isCurrent: () => true,
      latestSnapshot: () => ({ key: 'current', worlds: ['current-worlds'] }),
      resolvePack: async () => { throw error; },
      initializeWorlds,
      onError,
      onPrepared,
    })).resolves.toBe('prepared');
    expect(onError).toHaveBeenCalledWith(error);
    expect(initializeWorlds).toHaveBeenCalledTimes(1);
    expect(initializeWorlds).toHaveBeenCalledWith(['current-worlds'], null);
    expect(onPrepared).toHaveBeenCalledWith('current', null, null, true);
  });

  it('does not mark prepared when the no-pack world initialization itself fails', async () => {
    const fatal = new Error('default-world rebuild failed');
    const onPrepared = vi.fn();
    await expect(initializeRendererWorlds({
      isCurrent: () => true,
      latestSnapshot: () => ({ key: 'current', worlds: ['current-worlds'] }),
      resolvePack: async () => null,
      initializeWorlds: async () => { throw fatal; },
      onError: vi.fn(),
      onPrepared,
    })).rejects.toBe(fatal);
    expect(onPrepared).not.toHaveBeenCalled();
  });

  it('retries latest worlds without a pack after atlas initialization fails', async () => {
    const atlasError = new Error('atlas failed');
    const atlas = deferred<void>();
    let current = { key: 'before-atlas', worlds: ['before'] };
    const initializeWorlds = vi.fn()
      .mockReturnValueOnce(atlas.promise)
      .mockResolvedValueOnce(undefined);
    const onError = vi.fn();
    const onPrepared = vi.fn();
    const pending = initializeRendererWorlds({
      isCurrent: () => true,
      latestSnapshot: () => current,
      resolvePack: async () => ({ id: 'pack' }),
      initializeWorlds,
      onError,
      onPrepared,
    });
    await flush();
    current = { key: 'after-atlas', worlds: ['after'] };
    atlas.reject(atlasError);
    await expect(pending).resolves.toBe('prepared');
    expect(onError).toHaveBeenCalledWith(atlasError);
    expect(initializeWorlds).toHaveBeenNthCalledWith(1, ['before'], { id: 'pack' });
    expect(initializeWorlds).toHaveBeenNthCalledWith(2, ['after'], null);
    expect(onPrepared).toHaveBeenCalledWith('after-atlas', null, { id: 'pack' }, false);
  });

  it('does not initialize or fall back after a generation becomes stale', async () => {
    const packRead = deferred<{ id: string } | null>();
    let active = true;
    const initializeWorlds = vi.fn(async () => {});
    const pending = initializeRendererWorlds({
      isCurrent: () => active,
      latestSnapshot: () => ({ key: 'worlds', worlds: ['worlds'] }),
      resolvePack: () => packRead.promise,
      initializeWorlds,
      onError: vi.fn(),
      onPrepared: vi.fn(),
    });
    active = false;
    packRead.resolve({ id: 'old-pack' });
    await expect(pending).resolves.toBe('stale');
    expect(initializeWorlds).not.toHaveBeenCalled();
  });

  it('does not fallback after an atlas rejection completes on a stale generation', async () => {
    const atlas = deferred<void>();
    let active = true;
    const initializeWorlds = vi.fn(() => atlas.promise);
    const onError = vi.fn();
    const pending = initializeRendererWorlds({
      isCurrent: () => active,
      latestSnapshot: () => ({ key: 'worlds', worlds: ['worlds'] }),
      resolvePack: async () => ({ id: 'pack' }),
      initializeWorlds,
      onError,
      onPrepared: vi.fn(),
    });
    await flush();
    active = false;
    atlas.reject(new Error('old atlas failure'));
    await expect(pending).resolves.toBe('stale');
    expect(initializeWorlds).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('buffers snapshots while initializing, applies only a changed key once, and dedupes ready rerenders', () => {
    const renderer = { setWorlds: vi.fn() };
    const requested = vi.fn();
    const owner = createRendererWorldSnapshotCoordinator(renderer, { key: 'initial', worlds: ['initial'] }, requested);
    owner.observe({ key: 'initial', worlds: ['same-key-recreated-object'] });
    owner.observe({ key: 'newest', worlds: ['newest'] });
    expect(renderer.setWorlds).not.toHaveBeenCalled();
    owner.prepared('initial');
    expect(renderer.setWorlds).toHaveBeenCalledTimes(1);
    expect(renderer.setWorlds).toHaveBeenCalledWith(['newest']);
    expect(requested).toHaveBeenCalledTimes(1);
    expect(requested).toHaveBeenCalledWith({ key: 'newest', worlds: ['newest'] });
    owner.prepared('initial');
    owner.observe({ key: 'newest', worlds: ['newest-same-key'] });
    expect(renderer.setWorlds).toHaveBeenCalledTimes(1);
    owner.observe({ key: 'next', worlds: ['next'] });
    expect(renderer.setWorlds).toHaveBeenCalledTimes(2);
    expect(requested).toHaveBeenCalledTimes(2);
    owner.dispose();
    owner.observe({ key: 'after-dispose', worlds: ['ignored'] });
    expect(renderer.setWorlds).toHaveBeenCalledTimes(2);
  });

  it('does not replay the initialization snapshot when ready fires', () => {
    const renderer = { setWorlds: vi.fn() };
    const owner = createRendererWorldSnapshotCoordinator(renderer, { key: 'same', worlds: ['same'] });
    owner.prepared('same');
    owner.observe({ key: 'same', worlds: ['same'] });
    expect(renderer.setWorlds).not.toHaveBeenCalled();
  });
});
