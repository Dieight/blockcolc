import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, statSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MANIFEST = 'docs/assets/ui-assets-manifest.json';

export function safeRepositoryPath(root, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath) || /^[a-zA-Z]:/.test(relativePath)) {
    throw new Error(`Expected a repository-relative path: ${String(relativePath)}`);
  }
  const segments = relativePath.replaceAll('\\', '/').split('/');
  if (segments.some((segment) => segment === '..' || segment === '')) {
    throw new Error(`Path escapes or is malformed: ${relativePath}`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...segments);
  const realRoot = realpathSync(resolvedRoot);
  let existingAncestor = resolved;
  const missingSuffix = [];
  while (!existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) break;
    missingSuffix.unshift(path.basename(existingAncestor));
    existingAncestor = parent;
  }
  const realAncestor = realpathSync(existingAncestor);
  const effectivePath = path.resolve(realAncestor, ...missingSuffix);
  const relative = path.relative(realRoot, effectivePath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Path escapes repository root: ${relativePath}`);
  }
  return effectivePath;
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

export function validateManifest({ root, manifest, generatedFiles = new Map(), checkHashes = true }) {
  const errors = [];
  const measured = new Map();
  if (!manifest || manifest.schemaVersion !== 2 || manifest.algorithm !== 'SHA-256' || !Array.isArray(manifest.assets)) {
    return { errors: ['Manifest must use schemaVersion 2, SHA-256, and an assets array'], measured };
  }

  const approvedMasters = manifest.assets.filter((asset) => asset?.role === 'approved-master');
  if (approvedMasters.length !== 1 || approvedMasters[0]?.approval?.status !== 'approved') {
    errors.push(`Expected exactly one approved-master asset, found ${approvedMasters.length}`);
  }
  const approvedMasterPath = approvedMasters.length === 1 && approvedMasters[0]?.approval?.status === 'approved'
    ? approvedMasters[0].path
    : null;

  const paths = new Map();
  for (const asset of manifest.assets) {
    const assetPath = asset?.path;
    if (typeof assetPath !== 'string') {
      errors.push('Every asset requires a path');
      continue;
    }
    let absolutePath;
    try {
      absolutePath = safeRepositoryPath(root, assetPath);
    } catch (error) {
      errors.push(error.message);
      continue;
    }
    const canonicalPath = assetPath.replaceAll('\\', '/').toLocaleLowerCase('en-US');
    if (paths.has(canonicalPath)) errors.push(`Duplicate asset path: ${assetPath} (also ${paths.get(canonicalPath)})`);
    else paths.set(canonicalPath, assetPath);

    let bytes;
    try {
      bytes = readFileSync(absolutePath);
    } catch {
      errors.push(`Missing asset: ${assetPath}`);
      continue;
    }
    const actualHash = digest(bytes);
    measured.set(assetPath, { sha256: actualHash, bytes: bytes.length });
    if (checkHashes && asset.sha256 !== actualHash) errors.push(`SHA-256 mismatch: ${assetPath}`);
    if (checkHashes && asset.bytes !== bytes.length) errors.push(`Byte-count mismatch: ${assetPath}`);

    if (asset.approval?.status === 'approved' && asset.approval.sha256 !== actualHash) {
      errors.push(`Approved source digest changed; approval must be reviewed explicitly: ${assetPath}`);
    }
    if (asset.role === 'generated-derived') {
      if (typeof asset.derivedFrom !== 'string' || typeof asset.generatedBy !== 'string' || typeof asset.generatedOutput !== 'string') {
        errors.push(`Derived asset lacks a complete generation relationship: ${assetPath}`);
        continue;
      }
      const parent = manifest.assets.find((candidate) => candidate.path === asset.derivedFrom);
      if (!parent || parent.role !== 'approved-master' || parent.approval?.status !== 'approved') {
        errors.push(`Derived asset does not point to an approved master: ${assetPath}`);
      }
      if (asset.derivedFrom !== approvedMasterPath) {
        errors.push(`Derived asset does not point to the actual generation source ${approvedMasterPath ?? '(undefined)'}: ${assetPath}`);
      }
      if (asset.generatedBy !== 'tools/build-adaptive-icon-source.py') {
        errors.push(`Unexpected generator for derived asset: ${assetPath}`);
      }
      try {
        const generatedPath = safeRepositoryPath(root, asset.generatedOutput);
        const outputKey = path.relative(root, generatedPath).replaceAll('\\', '/');
        const generatedBytes = generatedFiles.get(outputKey);
        if (!generatedBytes) errors.push(`Generator did not produce ${asset.generatedOutput} for ${assetPath}`);
        else if (!bytes.equals(generatedBytes)) errors.push(`Generated output differs from tracked asset: ${assetPath}`);
      } catch (error) {
        errors.push(error.message);
      }
    }
  }

  for (const consumer of manifest.consumers ?? []) {
    try {
      const consumerPath = safeRepositoryPath(root, consumer.path);
      const text = readFileSync(consumerPath, 'utf8');
      for (const needle of consumer.includes ?? []) {
        if (!text.includes(needle)) errors.push(`Missing asset consumer reference ${JSON.stringify(needle)} in ${consumer.path}`);
      }
    } catch (error) {
      errors.push(error.message.startsWith('Path ') || error.message.startsWith('Expected ') ? error.message : `Missing asset consumer: ${consumer.path}`);
    }
  }
  return { errors, measured };
}

function runGenerator(root, manifest) {
  const approvedMasters = manifest.assets.filter((asset) => asset.role === 'approved-master' && asset.approval?.status === 'approved');
  if (approvedMasters.length !== 1) throw new Error(`Expected exactly one approved master, found ${approvedMasters.length}`);
  const [master] = approvedMasters;
  const scratchRoot = mkdtempSync(path.join(tmpdir(), 'blockcolc-ui-assets-'));
  const outputRoot = path.join(scratchRoot, 'generated');
  const androidRoot = path.join(outputRoot, 'android-res');
  const webRoot = path.join(outputRoot, 'web-icons');
  const script = safeRepositoryPath(root, 'tools/build-adaptive-icon-source.py');
  const source = safeRepositoryPath(root, master.path);
  mkdirSync(outputRoot, { recursive: true });

  let result = spawnSync('py', ['-3', script, source, outputRoot, '--android-res', androidRoot, '--web-icons', webRoot], { cwd: root, encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') {
    result = spawnSync('python3', [script, source, outputRoot, '--android-res', androidRoot, '--web-icons', webRoot], { cwd: root, encoding: 'utf8' });
  }
  if (result.error || result.status !== 0) {
    rmSync(scratchRoot, { recursive: true, force: true });
    throw new Error(`Icon generator failed (${result.status ?? result.error?.code}): ${result.stderr || result.error?.message || ''}`);
  }

  const generatedFiles = new Map();
  for (const asset of manifest.assets.filter((entry) => entry.role === 'generated-derived')) {
    const relativeOutput = asset.generatedOutput.replaceAll('\\', '/');
    const filename = path.basename(relativeOutput);
    const generatedPath = relativeOutput.startsWith('generated/web-icons/')
      ? path.join(webRoot, filename)
      : relativeOutput.startsWith('generated/android-res/')
        ? path.join(androidRoot, relativeOutput.slice('generated/android-res/'.length))
        : null;
    if (generatedPath && statSync(generatedPath, { throwIfNoEntry: false })?.isFile()) {
      const key = path.relative(root, safeRepositoryPath(root, asset.generatedOutput)).replaceAll('\\', '/');
      generatedFiles.set(key, readFileSync(generatedPath));
    }
  }
  return { generatedFiles, cleanup: () => rmSync(scratchRoot, { recursive: true, force: true }) };
}

function parseArguments(argv) {
  const options = { mode: null, root: REPOSITORY_ROOT, manifestPath: DEFAULT_MANIFEST };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--check' || value === '--write') {
      if (options.mode) throw new Error('Choose exactly one of --check or --write');
      options.mode = value.slice(2);
    } else if (value === '--root' || value === '--manifest') {
      const next = argv[++index];
      if (!next) throw new Error(`${value} requires a path`);
      if (value === '--root') options.root = path.resolve(next);
      else options.manifestPath = next;
    } else {
      throw new Error(`Unknown option: ${value}`);
    }
  }
  if (!options.mode) throw new Error('Use --check or --write');
  return options;
}

export function runUiAssetCommand({ root, manifestPath, mode }) {
  const absoluteManifest = safeRepositoryPath(root, manifestPath);
  const manifest = JSON.parse(readFileSync(absoluteManifest, 'utf8'));
  const generated = runGenerator(root, manifest);
  try {
    const result = validateManifest({ root, manifest, generatedFiles: generated.generatedFiles, checkHashes: mode === 'check' });
    if (result.errors.length) return { ok: false, errors: result.errors };
    if (mode === 'write') {
      delete manifest.generatedAt;
      manifest.assets = manifest.assets.map((asset) => ({ ...asset, ...result.measured.get(asset.path) }));
      writeFileSync(absoluteManifest, `${JSON.stringify(manifest, null, 2)}\n`);
    }
    return { ok: true, errors: [] };
  } finally {
    generated.cleanup();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = runUiAssetCommand(options);
    if (!result.ok) {
      for (const error of result.errors) console.error(`FAIL ${error}`);
      process.exitCode = 1;
    } else {
      console.log(options.mode === 'write' ? 'UI asset manifest refreshed.' : 'UI asset manifest and generated relationships are valid.');
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
