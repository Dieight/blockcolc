import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  native: true,
  setOverlaysWebView: vi.fn(),
  setStyle: vi.fn(),
  setBackgroundColor: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
}));

vi.mock('@capacitor/status-bar', () => ({
  StatusBar: {
    setOverlaysWebView: mocks.setOverlaysWebView,
    setStyle: mocks.setStyle,
    setBackgroundColor: mocks.setBackgroundColor,
    show: mocks.show,
    hide: mocks.hide,
  },
  Style: { Light: 'LIGHT' },
}));

vi.mock('../src/notification-port', () => ({
  isCapacitorNative: () => mocks.native,
}));

import { configureNativeSystemBars, setNativeFocusImmersive } from '../src/system-bars';

describe('native system bar modes', () => {
  beforeEach(() => {
    mocks.native = true;
    vi.clearAllMocks();
  });

  it('shows dark icons over the ordinary app surface', async () => {
    await configureNativeSystemBars();
    expect(mocks.setOverlaysWebView).toHaveBeenCalledWith({ overlay: true });
    expect(mocks.setStyle).toHaveBeenCalledWith({ style: 'LIGHT' });
    expect(mocks.setBackgroundColor).toHaveBeenCalledWith({ color: '#F3F5F2' });
    expect(mocks.show).toHaveBeenCalledOnce();
    expect(mocks.hide).not.toHaveBeenCalled();
  });

  it('hides the status bar for active focus without changing web data', async () => {
    await setNativeFocusImmersive(true);
    expect(mocks.setOverlaysWebView).toHaveBeenCalledWith({ overlay: true });
    expect(mocks.hide).toHaveBeenCalledOnce();
    expect(mocks.show).not.toHaveBeenCalled();
    expect(mocks.setStyle).not.toHaveBeenCalled();
  });

  it('does nothing outside a native Capacitor container', async () => {
    mocks.native = false;
    await setNativeFocusImmersive(true);
    expect(mocks.setOverlaysWebView).not.toHaveBeenCalled();
    expect(mocks.hide).not.toHaveBeenCalled();
  });
});
