import { beforeEach, expect, test, vi } from 'vitest';
import { StatusBar } from '@capacitor/status-bar';

const mockStatusBar = vi.hoisted(() => ({
  getInfo: vi.fn(),
  setOverlaysWebView: vi.fn().mockResolvedValue(undefined),
  setStyle: vi.fn().mockResolvedValue(undefined),
  setBackgroundColor: vi.fn().mockResolvedValue(undefined),
  hide: vi.fn().mockResolvedValue(undefined),
  show: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@capacitor/status-bar', () => ({
  Style: { Light: 'LIGHT' },
  StatusBar: mockStatusBar,
}));
vi.mock('../src/notification-port', () => ({ isCapacitorNative: () => true }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

test('shade return only mutates the Android window if the status bar actually reappeared', async () => {
  const { setNativeFocusImmersive } = await import('../src/system-bars');
  vi.mocked(StatusBar.getInfo).mockResolvedValue({ visible: false } as Awaited<ReturnType<typeof StatusBar.getInfo>>);

  await setNativeFocusImmersive(true);
  expect(StatusBar.hide).toHaveBeenCalledTimes(1);
  await setNativeFocusImmersive(true, true);
  expect(StatusBar.getInfo).toHaveBeenCalledTimes(1);
  expect(StatusBar.setOverlaysWebView).toHaveBeenCalledTimes(1);
  expect(StatusBar.hide).toHaveBeenCalledTimes(1);

  vi.mocked(StatusBar.getInfo).mockResolvedValue({ visible: true } as Awaited<ReturnType<typeof StatusBar.getInfo>>);
  await setNativeFocusImmersive(true, true);
  expect(StatusBar.setOverlaysWebView).toHaveBeenCalledTimes(2);
  expect(StatusBar.hide).toHaveBeenCalledTimes(2);
});

test('overlapping mode changes are serialized in request order', async () => {
  const { setNativeFocusImmersive } = await import('../src/system-bars');
  await Promise.all([setNativeFocusImmersive(false), setNativeFocusImmersive(true)]);
  expect(StatusBar.show).toHaveBeenCalledTimes(1);
  expect(StatusBar.hide).toHaveBeenCalledTimes(1);
  expect(vi.mocked(StatusBar.show).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(StatusBar.hide).mock.invocationCallOrder[0]!,
  );
});
