import { useEffect } from 'react';
import type { ApplicationService } from '@blockcolc/application';
import { createDailyBackupCoordinator } from './daily-backup-coordinator';

export const DAILY_BACKUP_CHANGED = 'blockcolc-daily-backup-changed';
export function useDailyBackup(service: ApplicationService) {
  useEffect(() => {
    const coordinator = createDailyBackupCoordinator({
      now: () => new Date(), timeZone: () => service.snapshot().calendar.timeZone,
      visible: () => document.visibilityState === 'visible', capture: date => service.createDailyBackup(date),
      changed: error => window.dispatchEvent(new CustomEvent(DAILY_BACKUP_CHANGED, { detail: { error } })),
    });
    let idle: number | null = null, fallback: number | null = null;
    const schedule = () => {
      if (idle !== null || fallback !== null || document.hidden) return;
      const check = () => { idle = null; fallback = null; void coordinator.check(); };
      // No startup/world rendering or actor command waits for history hashing.
      if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(check, { timeout: 10_000 });
      else fallback = window.setTimeout(check, 1_000);
    };
    const unsubscribe = service.subscribeCommitted(event => { if (event.replacement) coordinator.invalidate(); schedule(); });
    const timer = window.setInterval(schedule, 60_000);
    document.addEventListener('visibilitychange', schedule);
    window.addEventListener('focus', schedule);
    schedule();
    return () => {
      coordinator.stop(); unsubscribe(); window.clearInterval(timer);
      if (idle !== null) window.cancelIdleCallback(idle);
      if (fallback !== null) window.clearTimeout(fallback);
      document.removeEventListener('visibilitychange', schedule); window.removeEventListener('focus', schedule);
    };
  }, [service]);
}
