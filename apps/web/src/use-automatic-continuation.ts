import { useEffect, useMemo, useRef } from 'react';
import type { ApplicationService } from '@tomato-clock/application';
import type { FocusPreferences } from './app-types';
import {
  createAutomaticContinuationCoordinator,
  type AutomaticContinuationCoordinatorPorts,
  type AutomaticContinuationDeadlineEvent,
  type AutomaticContinuationDeadlinePort,
} from './automatic-continuation';
import { newAutomaticContinuationAuthorizationId, type RoundPlan } from './round-plan';

export interface UseAutomaticContinuationOptions {
  service: ApplicationService;
  preferences: FocusPreferences;
  readPlan: () => RoundPlan | null;
  writePlan: (plan: RoundPlan | null) => void;
  refresh?: () => void;
  newAuthorizationId?: () => string;
}

const nativeDeadlinePort: AutomaticContinuationDeadlinePort = {
  async schedule(event) {
    const platform = await import('@tomato-clock/platform-capacitor');
    return platform.scheduleAutomaticContinuation(event);
  },
  async cancel(eventId) {
    const platform = await import('@tomato-clock/platform-capacitor');
    await platform.cancelAutomaticContinuation(eventId);
  },
  async cancelAuthorization(authorizationId) {
    const platform = await import('@tomato-clock/platform-capacitor');
    await platform.cancelAutomaticContinuations(authorizationId);
  },
  async pending() {
    const platform = await import('@tomato-clock/platform-capacitor');
    return platform.getPendingAutomaticContinuations();
  },
  async acknowledge(eventId) {
    const platform = await import('@tomato-clock/platform-capacitor');
    await platform.acknowledgeAutomaticContinuation(eventId);
  },
  async listen(listener: (event: AutomaticContinuationDeadlineEvent) => void) {
    const platform = await import('@tomato-clock/platform-capacitor');
    const handle = await platform.addAutomaticContinuationListener(listener);
    return () => handle.remove();
  },
};

/**
 * Owns the WebView-side subscription and lifecycle bridge for automatic focus.
 * The Android alarm is durable, but only this JS coordinator can call the
 * domain application service; after process death it catches up on resume.
 */
export function useAutomaticContinuation(options: UseAutomaticContinuationOptions) {
  const latest = useRef(options);
  latest.current = options;
  const coordinator = useMemo(() => {
    const ports: AutomaticContinuationCoordinatorPorts = {
      service: {
        snapshot: () => latest.current.service.snapshot(),
        resume: () => latest.current.service.resume(),
        startScheduledFocus: (command, reservation) => latest.current.service.startScheduledFocus(command, reservation),
        subscribeCommitted: listener => latest.current.service.subscribeCommitted(listener),
      },
      deadlines: nativeDeadlinePort,
      readPlan: () => latest.current.readPlan(),
      writePlan: plan => latest.current.writePlan(plan),
      preferences: () => ({
        autoContinueFocus: latest.current.preferences.autoContinueFocus === true,
        focusMinutes: latest.current.preferences.focusMinutes,
        habitFocusMinutes: latest.current.preferences.habitFocusMinutes,
        breakMinutes: latest.current.preferences.breakMinutes,
      }),
      refresh: () => latest.current.refresh?.(),
      newAuthorizationId: () => latest.current.newAuthorizationId?.() ?? newAutomaticContinuationAuthorizationId(),
    };
    return createAutomaticContinuationCoordinator(ports);
  }, [options.service]);

  useEffect(() => {
    void coordinator.start();
    return () => { void coordinator.stop(); };
  }, [coordinator]);

  useEffect(() => {
    void coordinator.reconcile();
  }, [coordinator, options.preferences.autoContinueFocus, options.preferences.focusMinutes,
    options.preferences.habitFocusMinutes, options.preferences.breakMinutes]);

  return {
    onResume: coordinator.onResume,
    retry: coordinator.retry,
    reconcile: coordinator.reconcile,
    handleDeadline: coordinator.handleDeadline,
    get lastResult() { return coordinator.lastResult; },
  };
}
