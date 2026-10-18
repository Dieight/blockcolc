import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const web = new URL('../apps/web/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('playwright.release-suites.json', web), 'utf8'));

test('release batches partition every spec exactly once, apart from explicit diagnostics', () => {
  const all = readdirSync(new URL('tests/', web)).filter(name => name.endsWith('.spec.ts')).sort();
  const assigned = manifest.suites.flatMap(suite => suite.specs);
  const classified = [...assigned, ...manifest.diagnostics];
  assert.equal(new Set(classified).size, classified.length, 'duplicate or diagnostic/release overlap');
  assert.deepEqual(classified.sort(), all, 'missing or unrecognized specs');
  assert.equal(new Set(manifest.suites.map(suite => suite.name)).size, manifest.suites.length);
});

test('critical state/input and renderer contracts run before costly presentation matrices', () => {
  assert.deepEqual(manifest.suites.slice(0, 2).map(suite => suite.name), ['critical', 'render-contracts']);
  const owner = new Map(manifest.suites.flatMap(suite => suite.specs.map(spec => [spec, suite.name])));
  for (const spec of ['automatic-continuation.spec.ts', 'focus-regressions.spec.ts',
    'minimal-achievement-entry.spec.ts', 'task-ime.spec.ts', 'v256-settlement-recovery.spec.ts']) {
    assert.equal(owner.get(spec), 'critical', spec);
  }
  for (const spec of ['v16-terrain-clip.spec.ts', 'v2-world-interaction.spec.ts', 'world-animals.spec.ts',
    'world-render-retention.spec.ts', 'world-shadow-cache.spec.ts', 'world-weather-lifecycle.spec.ts']) {
    assert.equal(owner.get(spec), 'render-contracts', spec);
  }
});
