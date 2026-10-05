import { addLocalDays, localDateOf } from '@blockcolc/domain';

export interface DailyBackupCoordinatorPorts {
  now(): Date;
  timeZone(): string;
  visible(): boolean;
  capture(date: string): Promise<unknown>;
  changed(error: string | null): void;
}

/** Dates belong to the application calendar, never the debug world clock. */
export function createDailyBackupCoordinator(ports: DailyBackupCoordinatorPorts) {
  let completedDate = '', running = false, retryAt = 0, generation = 0, stopped = false;
  return {
    invalidate() { completedDate = ''; retryAt = 0; generation++; },
    stop() { stopped = true; },
    async check() {
      if (stopped || running || !ports.visible() || ports.now().getTime() < retryAt) return;
      const target = addLocalDays(localDateOf(ports.now(), ports.timeZone()), -1);
      if (completedDate === target) return;
      const owner = generation;
      running = true;
      try {
        await ports.capture(target);
        if (!stopped && owner === generation) { completedDate = target; ports.changed(null); }
      } catch {
        retryAt = ports.now().getTime() + 60_000;
        if (!stopped) ports.changed('每日留档未完成，稍后重试。');
      } finally { running = false; }
    },
  };
}
