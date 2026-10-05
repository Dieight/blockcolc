import type { WorldWeatherView } from './use-world-weather';

interface InitialEnvironmentPorts {
  pending(): boolean; current(): boolean; visible(): boolean;
  now(): number; wait(ms: number): Promise<void>;
}

export function initialEnvironmentPending(enabled: boolean, view: WorldWeatherView): boolean {
  return enabled && (view.syncState === 'not_synced' || view.syncState === 'syncing'
    || view.astronomySyncState === 'not_synced' || view.astronomySyncState === 'syncing');
}

/** Initial provider reads share the loader; an offline request cannot hold it forever. */
export async function waitForInitialEnvironment(ports: InitialEnvironmentPorts, budgetMs = 8_000): Promise<'ready' | 'timeout' | 'hidden' | 'obsolete'> {
  const deadline = ports.now() + budgetMs;
  while (ports.current()) {
    if (!ports.visible()) return 'hidden';
    if (!ports.pending()) return 'ready';
    const remaining = deadline - ports.now();
    if (remaining <= 0) return 'timeout';
    await ports.wait(Math.min(100, remaining));
  }
  return 'obsolete';
}

/** Fetch code while the provider is pending; adopt latest inputs only after
 * both settle. Waiting stays bounded, without showing an incorrect first sky. */
export async function prepareInitialEnvironmentAndModule<T>(ports:InitialEnvironmentPorts, load:()=>Promise<T>) {
  const started=ports.now();
  let moduleMs=0,environmentMs=0;
  const module=load().then(value=>{moduleMs=ports.now()-started;return value;});
  const environment=waitForInitialEnvironment(ports).then(result=>{environmentMs=ports.now()-started;return result;});
  const [value,result]=await Promise.all([module,environment]);
  return {module:value,result,moduleMs,environmentMs,totalMs:ports.now()-started};
}
