import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ApplicationService } from '@blockcolc/application';
import { createAutomaticContinuationCoordinator } from './automatic-continuation';
import { defaultFocusPreferences } from './focus-preferences';
import { useAutomaticContinuation } from './use-automatic-continuation';

vi.mock('./automatic-continuation', () => ({
  createAutomaticContinuationCoordinator: vi.fn(() => ({
    start: vi.fn(), stop: vi.fn(), reconcile: vi.fn(), onResume: vi.fn(),
    retry: vi.fn(), handleDeadline: vi.fn(), lastResult: undefined,
  })),
}));

describe('automatic continuation application adapter', () => {
  it.each([0, 7])('forwards the live replacement revision %s instead of assuming a fresh database', revision => {
    let current = revision;
    const service = { stateReplacementRevision: () => current } as ApplicationService;
    function Probe() {
      useAutomaticContinuation({ service, preferences: defaultFocusPreferences(), readPlan: () => null, writePlan: vi.fn() });
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    const ports = vi.mocked(createAutomaticContinuationCoordinator).mock.calls.at(-1)![0];
    expect(ports.service.stateReplacementRevision?.()).toBe(revision);
    current += 1;
    expect(ports.service.stateReplacementRevision?.()).toBe(current);
  });
});
