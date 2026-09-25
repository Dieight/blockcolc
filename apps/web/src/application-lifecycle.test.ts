import { describe, expect, it, vi } from 'vitest';
import { APPLICATION_STATE_CHANGED_EVENT, bindApplicationLifecycle, shouldPublishLifecycleRefresh, type ApplicationStateChangedDetail } from './application-lifecycle';

const detail: ApplicationStateChangedDetail = { lifecycleType: 'foreground', sessionId: 'r', excursionRecorded: true, effectiveExcursions: 1, maxEffectiveExcursions: 3 };
const receipt = (value = detail) => Object.assign(new Event(APPLICATION_STATE_CHANGED_EVENT), { detail: value });
const pageshow = (persisted: boolean) => Object.assign(new Event('pageshow'), { persisted });
function fixture() {
  const target = new EventTarget();
  const ports = { resume: vi.fn(async () => {}), refresh: vi.fn(), record: vi.fn() };
  return { target, ports, dispose: bindApplicationLifecycle(target, ports) };
}
describe('processed application lifecycle consumer', () => {
  it('publishes a newer revision even when active session facts are unchanged', () => {
    expect(shouldPublishLifecycleRefresh({ lifecycleType: 'foreground', ok: true, events: [], activeFactsChanged: false, revisionChanged: true })).toBe(true);
    expect(shouldPublishLifecycleRefresh({ lifecycleType: 'foreground', ok: true, events: [], activeFactsChanged: false, revisionChanged: false })).toBe(false);
    expect(shouldPublishLifecycleRefresh({ lifecycleType: 'foreground', ok: true, events: [], activeFactsChanged: true, revisionChanged: false })).toBe(true);
  });
  it('persists background integrity without refreshing the covered page, but publishes meaningful foreground work', () => {
    expect(shouldPublishLifecycleRefresh({
      lifecycleType: 'background', ok: true, events: [{ type: 'FocusBackgrounded' }],
      activeFactsChanged: true, revisionChanged: true,
    })).toBe(false);
    expect(shouldPublishLifecycleRefresh({
      lifecycleType: 'foreground', ok: true, events: [{ type: 'FocusExcursionRecorded' }],
      activeFactsChanged: true, revisionChanged: true,
    })).toBe(true);
    expect(shouldPublishLifecycleRefresh({
      lifecycleType: 'background', ok: true, events: [{ type: 'FocusCompleted' }],
      activeFactsChanged: true, revisionChanged: true,
    })).toBe(true);
  });
  it('records a receipt before refreshing without issuing another domain resume', () => {
    const { target, ports } = fixture();
    ports.refresh.mockImplementation(() => expect(ports.record).toHaveBeenCalledWith({ sessionId: 'r', count: 1, max: 3 }));
    target.dispatchEvent(receipt());
    expect(ports.resume).not.toHaveBeenCalled();
  });
  it('accepts the limit receipt without depending on an active session snapshot', () => {
    const { target, ports } = fixture();
    target.dispatchEvent(receipt({ ...detail, effectiveExcursions: 3 }));
    expect(ports.record).toHaveBeenCalledWith({ sessionId: 'r', count: 3, max: 3 });
  });
  it('ordinary background/foreground refresh does not replay an excursion', () => {
    const { target, ports } = fixture();
    target.dispatchEvent(receipt({ ...detail, excursionRecorded: false }));
    target.dispatchEvent(receipt({ ...detail, lifecycleType: 'background', excursionRecorded: false }));
    expect(ports.record).not.toHaveBeenCalled();
    expect(ports.refresh).toHaveBeenCalledTimes(2);
  });
  it('only persisted pageshow resumes; disposal suppresses pending completion', async () => {
    const { target, ports, dispose } = fixture();
    let finish!: () => void;
    ports.resume.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    target.dispatchEvent(pageshow(false));
    expect(ports.resume).not.toHaveBeenCalled();
    target.dispatchEvent(pageshow(true));
    expect(ports.resume).toHaveBeenCalledTimes(1);
    dispose();
    finish();
    await Promise.resolve();
    expect(ports.refresh).not.toHaveBeenCalled();
  });
  it('cleans up idempotently and replacement listeners receive exactly one event', () => {
    const { target, ports, dispose } = fixture();
    dispose(); dispose();
    const replacement = { resume: vi.fn(async () => {}), refresh: vi.fn(), record: vi.fn() };
    bindApplicationLifecycle(target, replacement);
    target.dispatchEvent(receipt());
    expect(ports.refresh).not.toHaveBeenCalled();
    expect(replacement.record).toHaveBeenCalledTimes(1);
  });
});
