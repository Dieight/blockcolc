import { describe, expect, it } from 'vitest';
import { openSystemNotificationSettings } from '../src/index';

describe('system notification settings bridge', () => {
  it('returns false on non-native platforms without touching the bridge', async () => {
    await expect(openSystemNotificationSettings()).resolves.toBe(false);
  });
});
