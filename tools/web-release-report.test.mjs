import assert from 'node:assert/strict';
import test from 'node:test';
import { collectReportEvidence, summarizePlaywrightReport } from './web-release-report.mjs';

const report = {
  stats: { expected: 2, skipped: 2, flaky: 1, unexpected: 0 },
  suites: [{
    title: 'renderer',
    suites: [{
      title: 'nested visual group',
      suites: [{
        title: 'deeply nested group',
        specs: [{
          title: 'renderer.spec.ts',
          file: 'tests/renderer.spec.ts',
          line: 21,
          tests: [
            {
              title: 'recovers after one retry',
              projectName: 'mobile-chromium',
              status: 'flaky',
              results: [
                { status: 'failed', duration: 1200, retry: 0 },
                { status: 'passed', duration: 800, retry: 1 },
              ],
            },
            {
              title: 'passes first try',
              projectName: 'mobile-chromium',
              status: 'expected',
              results: [{ status: 'passed', duration: 300, retry: 0 }],
            },
            {
              title: 'skips unsupported browser behavior',
              projectName: 'mobile-chromium',
              status: 'skipped',
              annotations: [{ type: 'skip', description: 'Not supported in this browser.' }],
              results: [{ status: 'skipped', duration: 0, retry: 0 }],
            },
          ],
        }],
      }],
    }],
  }],
};

test('collects test evidence from deeply nested Playwright suites', () => {
  const evidence = collectReportEvidence(report, 'renderer');

  assert.equal(evidence.length, 3);
  assert.deepEqual(evidence.map(({ title }) => title), [
    'recovers after one retry',
    'passes first try',
    'skips unsupported browser behavior',
  ]);
  assert.equal(evidence[0].suite, 'renderer');
  assert.equal(evidence[0].durationSeconds, 2);
  assert.equal(evidence[2].skipReason, 'Not supported in this browser.');
});

test('summarizes observed retry, flaky, skip and test counts from attempts', () => {
  const summary = summarizePlaywrightReport(report, 'renderer');

  assert.equal(summary.retryCount, 1);
  assert.equal(summary.flakyTestCount, 1);
  assert.equal(summary.skippedTestCount, 1);
  assert.equal(summary.testCount, 3);
  assert.equal(summary.stats, report.stats);
  assert.equal(summary.skippedTests[0].title, 'skips unsupported browser behavior');
});

test('counts every observed retry without calling a failed final attempt flaky', () => {
  const failedAfterRetries = {
    suites: [{ specs: [{ tests: [{
      title: 'still fails',
      status: 'unexpected',
      results: [
        { status: 'failed', retry: 0 },
        { status: 'failed', retry: 1 },
        { status: 'failed', retry: 2 },
      ],
    }] }] }],
  };

  const summary = summarizePlaywrightReport(failedAfterRetries, 'core');
  assert.equal(summary.retryCount, 2);
  assert.equal(summary.flakyTestCount, 0);
  assert.equal(summary.skippedTestCount, 0);
});
