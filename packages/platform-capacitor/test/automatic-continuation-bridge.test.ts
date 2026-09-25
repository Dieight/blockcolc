import { beforeEach, describe, expect, it, vi } from 'vitest';

const nativePlugin = vi.hoisted(() => ({
  scheduleAutomaticContinuation: vi.fn(),
  cancelAutomaticContinuation: vi.fn(),
  cancelAutomaticContinuations: vi.fn(),
  getPendingAutomaticContinuations: vi.fn(),
  acknowledgeAutomaticContinuation: vi.fn(),
  addListener: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
  registerPlugin: () => nativePlugin,
}));

import {
  acknowledgeAutomaticContinuation,
  addAutomaticContinuationListener,
  cancelAutomaticContinuation,
  cancelAutomaticContinuations,
  getPendingAutomaticContinuations,
  scheduleAutomaticContinuation,
} from '../src/break-live-update';

describe('automatic continuation native bridge', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registers an absolute deadline and returns its native scheduling result', async () => {
    const event = { eventId: 'authorization-a:round:2', authorizationId: 'authorization-a', scheduledAtEpochMs: 1234 };
    nativePlugin.scheduleAutomaticContinuation.mockResolvedValue({ scheduled: true, exact: false, due: false });
    await expect(scheduleAutomaticContinuation(event)).resolves.toEqual({ scheduled: true, exact: false, due: false });
    expect(nativePlugin.scheduleAutomaticContinuation).toHaveBeenCalledWith(event);
  });

  it('drains durable due events and supports event and authorization cancellation', async () => {
    const event = { eventId: 'authorization-a:round:2', authorizationId: 'authorization-a', scheduledAtEpochMs: 1234 };
    const events = [event];
    nativePlugin.getPendingAutomaticContinuations.mockResolvedValue({ events });
    await expect(getPendingAutomaticContinuations()).resolves.toEqual(events);
    await cancelAutomaticContinuation(event.eventId);
    await cancelAutomaticContinuations(event.authorizationId);
    await acknowledgeAutomaticContinuation(event.eventId);
    expect(nativePlugin.cancelAutomaticContinuation).toHaveBeenCalledWith({ eventId: event.eventId });
    expect(nativePlugin.cancelAutomaticContinuations).toHaveBeenCalledWith({ authorizationId: event.authorizationId });
    expect(nativePlugin.acknowledgeAutomaticContinuation).toHaveBeenCalledWith({ eventId: event.eventId });
  });

  it('subscribes to the native due event', async () => {
    const handle = { remove: vi.fn().mockResolvedValue(undefined) };
    const callback = vi.fn();
    nativePlugin.addListener.mockResolvedValue(handle);
    await expect(addAutomaticContinuationListener(callback)).resolves.toBe(handle);
    expect(nativePlugin.addListener).toHaveBeenCalledWith('automaticContinuationDue', callback);
  });
});
