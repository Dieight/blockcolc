import { useSyncExternalStore } from 'react';
import { appUpdater } from './app-updater';

export function useAppUpdateState() {
  return useSyncExternalStore(appUpdater.subscribe, appUpdater.snapshot, appUpdater.snapshot);
}
