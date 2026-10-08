import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeProbeSamples, screenPoint } from './android-performance-protocol.mjs';
test('only complete matching samples are evidence', () => {
  const data = Buffer.from(JSON.stringify({ schemaVersion: 1, native: { activityAgeMs: 100 }, safety: { idle: true } })).toString('base64');
  const line = (part, chunk, run = 'r') => `event=sample run=${run} request=q sample=1 part=${part}/2 data=${chunk}`;
  const a = data.slice(0, 40), b = data.slice(40);
  assert.deepEqual(decodeProbeSamples(line(0, a), 'r', 'q'), []);
  assert.deepEqual(decodeProbeSamples(line(0, a, 'other') + '\n' + line(1, b), 'r', 'q'), []);
  assert.equal(decodeProbeSamples(line(1, b) + '\n' + line(0, a), 'r', 'q')[0].safety.idle, true);
});
test('ADB coordinates use WebView bounds instead of assuming DPR or fullscreen', () => {
  const sample = { visible: true, rect: { x: 10, y: 30, width: 100, height: 200 }, viewport: { width: 400, height: 800 }, native: { webViewX: 0, webViewY: 24, webViewWidth: 1200, webViewHeight: 2400 } };
  assert.deepEqual(screenPoint(sample), [180, 414]);
  assert.throws(() => screenPoint({ ...sample, visible: false }));
});
