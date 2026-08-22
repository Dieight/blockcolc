import { describe, expect, it } from 'vitest';
import { createOrderedLifecycleDispatcher, mapNativeBackgroundContext } from '../src/index';

describe('Capacitor focus lifecycle contract', () => {
  it('maps interactive app switching as a countable native background event', () => {
    expect(mapNativeBackgroundContext({
      screenInteractive: true,
      keyguardLocked: false,
      backgroundedAtEpochMs: 1_000,
      productSystemUi: false,
      multiWindow: false,
    })).toEqual({
      type: 'background', source: 'native',
      context: { locked: false, screenOff: false, exempt: false, multiWindow: false, backgroundedAtEpochMs: 1_000 },
    });
  });

  it('preserves lock, screen-off, and product-system-UI exemption signals', () => {
    expect(mapNativeBackgroundContext({
      screenInteractive: false,
      keyguardLocked: true,
      backgroundedAtEpochMs: 2_000,
      productSystemUi: true,
      multiWindow: false,
    })).toEqual({
      type: 'background', source: 'native',
      context: { locked: true, screenOff: true, exempt: true, multiWindow: false, backgroundedAtEpochMs: 2_000 },
    });
  });

  it('passes through multi-window signals for the application-side counting decision', () => {
    expect(mapNativeBackgroundContext({
      screenInteractive: true,
      keyguardLocked: false,
      backgroundedAtEpochMs: 3_000,
      productSystemUi: false,
      multiWindow: true,
    })).toEqual({
      type: 'background', source: 'native',
      context: { locked: false, screenOff: false, exempt: false, multiWindow: true, backgroundedAtEpochMs: 3_000 },
    });
  });

  it('waits for delayed native background context before a later foreground event', async () => {
    const events: string[] = [];
    let release!: (context: {
      screenInteractive: boolean; keyguardLocked: boolean; backgroundedAtEpochMs: number; productSystemUi: boolean; multiWindow: boolean;
    }) => void;
    const delayedContext = new Promise<Parameters<typeof release>[0]>(resolve => { release = resolve; });
    const dispatcher = createOrderedLifecycleDispatcher(
      async event => { events.push(event.type); },
      () => delayedContext,
    );

    dispatcher.background();
    dispatcher.foreground();
    await Promise.resolve();
    expect(events).toEqual([]);
    release({ screenInteractive: true, keyguardLocked: false, backgroundedAtEpochMs: 1_000, productSystemUi: false, multiWindow: false });
    await dispatcher.drain();
    expect(events).toEqual(['background', 'foreground']);
  });
});
