import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateManifest } from './check-ui-assets.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'blockcolc-ui-assets-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'assets'), { recursive: true });
  mkdirSync(path.join(root, 'web'), { recursive: true });
  const master = Buffer.from('approved-master');
  const derived = Buffer.from('generated-derived');
  writeFileSync(path.join(root, 'assets/master.png'), master);
  writeFileSync(path.join(root, 'assets/icon.png'), derived);
  writeFileSync(path.join(root, 'web/index.html'), '<img src="/assets/icon.png">');
  const manifest = {
    schemaVersion: 2,
    algorithm: 'SHA-256',
    assets: [
      { path: 'assets/master.png', role: 'approved-master', approval: { status: 'approved', sha256: hash(master) }, sha256: hash(master), bytes: master.length },
      { path: 'assets/icon.png', role: 'generated-derived', derivedFrom: 'assets/master.png', generatedBy: 'tools/build-adaptive-icon-source.py', generatedOutput: 'generated/web-icons/icon.png', sha256: hash(derived), bytes: derived.length },
    ],
    consumers: [{ path: 'web/index.html', includes: ['/assets/icon.png'] }],
  };
  return { root, manifest, generatedFiles: new Map([['generated/web-icons/icon.png', derived]]) };
}

test('accepts the approved master, its generated output and a live consumer reference', (t) => {
  const input = fixture(t);
  assert.deepEqual(validateManifest(input).errors, []);
});

test('rejects a tampered derived file even when its manifest digest is refreshed', (t) => {
  const input = fixture(t);
  const changed = Buffer.from('tampered');
  writeFileSync(path.join(input.root, 'assets/icon.png'), changed);
  input.manifest.assets[1].sha256 = hash(changed);
  input.manifest.assets[1].bytes = changed.length;
  assert.ok(validateManifest(input).errors.some((error) => error.includes('Generated output differs')));
});

test('rejects missing and duplicate asset paths', (t) => {
  const input = fixture(t);
  input.manifest.assets.push({ ...input.manifest.assets[1] });
  rmSync(path.join(input.root, 'assets/icon.png'));
  const errors = validateManifest(input).errors;
  assert.ok(errors.some((error) => error.includes('Duplicate asset path')));
  assert.ok(errors.some((error) => error.includes('Missing asset')));
});

test('rejects a changed approved master and path escapes', (t) => {
  const input = fixture(t);
  writeFileSync(path.join(input.root, 'assets/master.png'), 'changed-master');
  input.manifest.assets.push({ ...input.manifest.assets[0], path: '../outside.png' });
  const errors = validateManifest(input).errors;
  assert.ok(errors.some((error) => error.includes('Approved source digest changed')));
  assert.ok(errors.some((error) => error.includes('escapes')));
});

test('rejects a removed or redirected generated relationship', (t) => {
  const input = fixture(t);
  input.manifest.assets[1].derivedFrom = 'assets/missing-master.png';
  input.manifest.assets[1].generatedOutput = '../outside.png';
  const errors = validateManifest(input).errors;
  assert.ok(errors.some((error) => error.includes('does not point to an approved master')));
  assert.ok(errors.some((error) => error.includes('escapes')));
});

test('rejects a derived asset pointing to a different approved source', (t) => {
  const input = fixture(t);
  const otherSource = Buffer.from('other-approved-source');
  writeFileSync(path.join(input.root, 'assets/other.png'), otherSource);
  input.manifest.assets.push({
    path: 'assets/other.png',
    role: 'approved-reference-source',
    approval: { status: 'approved', sha256: hash(otherSource) },
    sha256: hash(otherSource),
    bytes: otherSource.length,
  });
  input.manifest.assets[1].derivedFrom = 'assets/other.png';
  const errors = validateManifest(input).errors;
  assert.ok(errors.some((error) => error.includes('does not point to the actual generation source')));
});

test('rejects a repository path whose junction resolves outside the repository', (t) => {
  const input = fixture(t);
  const outside = mkdtempSync(path.join(tmpdir(), 'blockcolc-ui-assets-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(path.join(outside, 'external.png'), 'outside');
  symlinkSync(outside, path.join(input.root, 'external-link'), 'junction');
  const errors = validateManifest({
    root: input.root,
    manifest: {
      schemaVersion: 2,
      algorithm: 'SHA-256',
      assets: [{ path: 'external-link/external.png', role: 'source' }],
    },
  }).errors;
  assert.ok(errors.some((error) => error.includes('Path escapes repository root')));
});
