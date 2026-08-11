import { describe, expect, it } from 'vitest';
import { FOCUS_NOTIFICATION_ID, mapPermission } from '../src/index';

describe('Capacitor notification contract', () => {
  it('uses one stable Android notification identifier', () => { expect(FOCUS_NOTIFICATION_ID).toBe(42001); });
  it.each([
    ['granted', 'granted'], ['denied', 'denied'], ['prompt', 'prompt'], ['prompt-with-rationale', 'prompt'],
  ] as const)('maps %s permission to %s', (native, application) => { expect(mapPermission(native)).toBe(application); });
});
