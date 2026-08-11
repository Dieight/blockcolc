import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const mode = process.argv[2] ?? '--check';

if (!['--check', '--write'].includes(mode)) {
  throw new Error('Usage: node tools/sync-version.mjs --check|--write');
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path), 'utf8'));
}

async function saveJson(path, value) {
  await writeFile(resolve(root, path), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const version = await readJson('version.json');
if (!/^\d+\.\d+\.\d+$/.test(version.versionName)) throw new Error('versionName must use MAJOR.MINOR.PATCH.');
if (!Number.isSafeInteger(version.versionCode) || version.versionCode < 1) throw new Error('versionCode must be a positive integer.');

const files = ['package.json', 'apps/web/package.json', 'apps/android/package.json'];
const problems = [];

for (const path of files) {
  const data = await readJson(path);
  if (mode === '--write') {
    if (data.version !== version.versionName) {
      data.version = version.versionName;
      await saveJson(path, data);
    }
  } else if (data.version !== version.versionName) {
    problems.push(`${path}: expected ${version.versionName}, found ${data.version ?? '<missing>'}`);
  }
}

const lock = await readJson('package-lock.json');
const lockEntries = ['', 'apps/web', 'apps/android'];
if (mode === '--write') {
  let changed = false;
  if (lock.version !== version.versionName) {
    lock.version = version.versionName;
    changed = true;
  }
  for (const key of lockEntries) {
    if (lock.packages[key].version !== version.versionName) {
      lock.packages[key].version = version.versionName;
      changed = true;
    }
  }
  if (changed) await saveJson('package-lock.json', lock);
} else {
  if (lock.version !== version.versionName) problems.push(`package-lock.json: expected ${version.versionName}, found ${lock.version}`);
  for (const key of lockEntries) {
    if (lock.packages[key]?.version !== version.versionName) {
      problems.push(`package-lock.json packages[${JSON.stringify(key)}]: expected ${version.versionName}, found ${lock.packages[key]?.version ?? '<missing>'}`);
    }
  }
}

if (problems.length) {
  throw new Error(`Version drift detected:\n${problems.map(problem => `- ${problem}`).join('\n')}`);
}

console.log(`${mode === '--write' ? 'Synchronized' : 'Verified'} ${version.versionName} (${version.versionCode}).`);
