import { useEffect } from 'react';
import type { ApplicationService } from '@blockcolc/application';
import { createDailyBackupCoordinator } from './daily-backup-coordinator';
import { queueIdleWork } from './idle-work';

export const DAILY_BACKUP_CHANGED = 'blockcolc-daily-backup-changed';
export function useDailyBackup(service: ApplicationService) {
  useEffect(() => {
    const coordinator = createDailyBackupCoordinator({
      now: () => new Date(), timeZone: () => service.snapshot().calendar.timeZone,
      visible: () => document.visibilityState === 'visible', capture: date => service.createDailyBackup(date),
      changed: error => window.dispatchEvent(new CustomEvent(DAILY_BACKUP_CHANGED, { detail: { error } })),
    });
    let pending:false|(()=>void)=false;
    const schedule = () => {
      if (pending || document.hidden) return;
      pending=queueIdleWork('daily-backup',async()=>{pending=false;await coordinator.check();});
    };
    const unsubscribe = service.subscribeCommitted(event => { if (event.replacement) coordinator.invalidate(); schedule(); });
    const timer = window.setInterval(schedule, 60_000);
    document.addEventListener('visibilitychange', schedule);
    window.addEventListener('focus', schedule);
    schedule();
    return () => {
      coordinator.stop(); unsubscribe(); window.clearInterval(timer);
      if(pending)pending();
      document.removeEventListener('visibilitychange', schedule); window.removeEventListener('focus', schedule);
    };
  }, [service]);
}
