import { useEffect, useRef, useState } from 'react';
import { checkAppUpdate, compareVersions, type AppRelease } from './app-update';

/** One background request per enabled launch; errors and up-to-date results stay silent. */
export function useAutoUpdateCheck(enabled: boolean, ready: boolean, version: string, onAvailable: (release: AppRelease) => void) {
  const [available, setAvailable] = useState<AppRelease | null>(null);
  const completed = useRef(false);
  const deliver = useRef(onAvailable); deliver.current = onAvailable;
  useEffect(() => {
    if (!enabled || completed.current) return;
    const controller = new AbortController();
    // A cancelled mount (including StrictMode's probe) must not send a request.
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      const release = await checkAppUpdate(controller.signal);
      if (controller.signal.aborted) return;
      completed.current = true;
      if (compareVersions(release.version, version) > 0) setAvailable(release);
    }).catch(() => { if (!controller.signal.aborted) completed.current = true; });
    return () => controller.abort();
  }, [enabled, version]);
  useEffect(() => {
    if (!enabled || !ready || !available) return;
    const notify = () => {
      if (document.visibilityState !== 'visible') return;
      setAvailable(null); deliver.current(available);
    };
    document.addEventListener('visibilitychange', notify); notify();
    return () => document.removeEventListener('visibilitychange', notify);
  }, [enabled, ready, available]);
}
