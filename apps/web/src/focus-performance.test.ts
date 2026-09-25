import { afterEach, describe, expect, it } from 'vitest';
import { clearFocusPerformanceMarks, markFocusPerformance, readFocusPerformanceMarks } from './focus-performance';

describe('focus transition diagnostics', () => {
  afterEach(() => clearFocusPerformanceMarks());

  it('records deterministic gesture, command, persistence and renderer milestones without affecting state', () => {
    markFocusPerformance('gesture-confirmed');
    markFocusPerformance('command-queued');
    markFocusPerformance('command-committed');
    markFocusPerformance('plan-persisted');
    markFocusPerformance('renderer-updated');
    expect(readFocusPerformanceMarks().map(entry => entry.name.replace('blockcolc-focus:', ''))).toEqual([
      'gesture-confirmed', 'command-queued', 'command-committed', 'plan-persisted', 'renderer-updated',
    ]);
  });
});
