import { describe, expect, it, vi } from 'vitest';
import { startRendererGeneration } from './renderer-generation';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function fixture() {
  const module = deferred<string>();
  const pack = deferred<void>();
  const instance = { dispose: vi.fn() };
  const commitPack = vi.fn();
  const ports = {
    schedule: (begin: () => void) => { begin(); return vi.fn(); },
    load: vi.fn(() => module.promise),
    create: vi.fn(() => instance),
    initialize: vi.fn(async (_: typeof instance, isCurrent: () => boolean) => {
      await pack.promise;
      if (isCurrent()) commitPack();
    }),
    ready: vi.fn(), error: vi.fn(), release: vi.fn(),
  };
  return { module, pack, instance, commitPack, ports, dispose: startRendererGeneration(ports) };
}

describe('renderer generation ownership', () => {
  it('creates once, becomes ready after initialization, and disposes exactly once', async () => {
    const f = fixture();
    f.module.resolve('module'); await flush();
    expect(f.ports.create).toHaveBeenCalledTimes(1);
    expect(f.ports.ready).not.toHaveBeenCalled();
    f.pack.resolve(); await flush();
    expect(f.commitPack).toHaveBeenCalledTimes(1);
    expect(f.ports.ready).toHaveBeenCalledTimes(1);
    f.dispose(); f.dispose();
    expect(f.instance.dispose).toHaveBeenCalledTimes(1);
    expect(f.ports.release).toHaveBeenCalledWith(f.instance);
  });
  it('does not create after disposal while the module is loading', async () => {
    const f = fixture();
    f.dispose(); f.module.resolve('module'); await flush();
    expect(f.ports.create).not.toHaveBeenCalled();
    expect(f.ports.ready).not.toHaveBeenCalled();
  });
  it('old pack completion cannot write cache or readiness in the next generation', async () => {
    const old = fixture();
    old.module.resolve('old'); await flush(); old.dispose();
    const next = fixture();
    next.module.resolve('new'); next.pack.resolve(); await flush();
    old.pack.resolve(); await flush();
    expect(old.commitPack).not.toHaveBeenCalled();
    expect(old.ports.ready).not.toHaveBeenCalled();
    expect(next.commitPack).toHaveBeenCalledTimes(1);
    expect(next.instance.dispose).not.toHaveBeenCalled();
    next.dispose();
  });
  it.each(['module', 'pack'] as const)('exits loading on active %s failure', async stage => {
    const f = fixture();
    if (stage === 'module') f.module.reject(new Error('load'));
    else { f.module.resolve('module'); await flush(); f.pack.reject(new Error('pack')); }
    await flush();
    expect(f.ports.error).toHaveBeenCalledTimes(1);
    expect(f.ports.ready).toHaveBeenCalledTimes(1);
    f.dispose();
  });
  it('ignores rejected initialization after disposal', async () => {
    const f = fixture();
    f.module.resolve('module'); await flush(); f.dispose();
    f.pack.reject(new Error('old')); await flush();
    expect(f.ports.error).not.toHaveBeenCalled();
    expect(f.ports.ready).not.toHaveBeenCalled();
  });
  it('cancels deferred start and releases ownership even if dispose throws', async () => {
    const f = fixture();
    f.module.resolve('module'); await flush();
    f.instance.dispose.mockImplementation(() => { throw new Error('dispose'); });
    expect(f.dispose).toThrow('dispose');
    expect(f.ports.release).toHaveBeenCalledWith(f.instance);
    expect(f.dispose).not.toThrow();
    let begin = () => {};
    const cancel = vi.fn();
    const load = vi.fn(async () => 'module');
    const stop = startRendererGeneration({ ...f.ports, load, schedule: cb => { begin = cb; return cancel; } });
    stop(); begin(); await flush();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(f.ports.create).toHaveBeenCalledTimes(1);
  });
});
