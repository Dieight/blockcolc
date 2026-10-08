import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationService } from '@blockcolc/application';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });
describe('opt-in native performance collector', () => {
  it('normal builds install no observer, loop, transport or global API', async () => {
    vi.stubEnv('VITE_BLOCKCOLC_PERFORMANCE_DIAGNOSTICS', 'false');
    const raf = vi.fn(); const publish = vi.fn();
    vi.stubGlobal('window', {}); vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('BlockcolcPerformance', { isEnabled: () => true, publish });
    const probe = await import('./performance-probe.ts'); probe.installPerformanceProbe();
    expect(raf).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
    expect(window).not.toHaveProperty('__blockcolcPerformanceProbe');
    expect(probe.performanceProbeFrameCallback()).toBeUndefined();
  });
  it('requires the native opt-in bridge even in a diagnostic web build', async () => {
    vi.stubEnv('VITE_BLOCKCOLC_PERFORMANCE_DIAGNOSTICS', 'true');
    vi.stubGlobal('BlockcolcPerformance', undefined); vi.stubGlobal('window', {});
    const probe = await import('./performance-probe.ts'); probe.installPerformanceProbe();
    expect(window).not.toHaveProperty('__blockcolcPerformanceProbe');
  });
  it('captures counts only and does not make native calls on every frame', async () => {
    vi.stubEnv('VITE_BLOCKCOLC_PERFORMANCE_DIAGNOSTICS', 'true');
    const isEnabled = vi.fn(() => true), publish = vi.fn();
    vi.stubGlobal('BlockcolcPerformance', { isEnabled, publish });
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), querySelector: () => null, documentElement: { dataset: {} } });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('localStorage', { getItem: () => null });
    vi.stubGlobal('innerWidth', 360); vi.stubGlobal('innerHeight', 800); vi.stubGlobal('devicePixelRatio', 3);
    const probe = await import('./performance-probe.ts'); probe.installPerformanceProbe();
    probe.bindPerformanceApplication({
      snapshot: () => ({ activeFocusSession: null, projects: [{ title: 'secret task', status: 'active' }], focusHistory: [], progressReports: [], habitBuildings: [], buildingBlueprintResources: [] }),
      activeProjectProjection: () => ({ unreportedCompletedSessions: [] }),
    } as unknown as ApplicationService);
    const frame = probe.performanceProbeFrameCallback()!; frame(10); frame(15);
    expect(isEnabled).toHaveBeenCalledTimes(1);
    const api = (window as unknown as { __blockcolcPerformanceProbe: { snapshot(): void; stop(): void } }).__blockcolcPerformanceProbe;
    api.snapshot();
    const payload = publish.mock.calls[0]![0];
    expect(payload).not.toContain('secret task'); expect(payload).not.toContain('title');
    expect(JSON.parse(payload)).toMatchObject({ safety: { known: true, idle: true, projectCount: 1 }, rendererCpu: { count: 2, p95Ms: 15 } });
    api.stop();
  });
});
