import { describe, expect, it } from 'vitest';
import { createOrderedLifecycleDispatcher, mapNativeBackgroundContext } from '../src/index';

describe('Capacitor focus lifecycle contract', () => {
  it('maps interactive app switching as a countable native background event', () => {
    expect(mapNativeBackgroundContext({
      screenInteractive: true,
      keyguardLocked: false,
      backgroundedAtEpochMs: 1_000,
      productSystemUi: false,
    })).toEqual({
      type: 'background', source: 'native',
      context: { locked: false, screenOff: false, exempt: false, backgroundedAtEpochMs: 1_000 },
    });
  });

  it('preserves lock, screen-off, and product-system-UI exemption signals', () => {
    expect(mapNativeBackgroundContext({
      screenInteractive: false,
      keyguardLocked: true,
      backgroundedAtEpochMs: 2_000,
      productSystemUi: true,
    })).toEqual({
      type: 'background', source: 'native',
      context: { locked: true, screenOff: true, exempt: true, backgroundedAtEpochMs: 2_000 },
    });
  });

  it('waits for delayed native background context before a later foreground event', async () => {
    const events: string[] = [];
    let release!: (context: {
      screenInteractive: boolean; keyguardLocked: boolean; backgroundedAtEpochMs: number; productSystemUi: boolean;
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
    release({ screenInteractive: true, keyguardLocked: false, backgroundedAtEpochMs: 1_000, productSystemUi: false });
    await dispatcher.drain();
    expect(events).toEqual(['background', 'foreground']);
  });
});
