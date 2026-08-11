import { createHash } from 'node:crypto';
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid argument near ${key ?? '<end>'}.`);
    }
    values.set(key.slice(2), value);
  }
  return values;
}

function requireArgument(argumentsMap, name) {
  const value = argumentsMap.get(name);
  if (!value) throw new Error(`Missing --${name}.`);
  return value;
}

async function sha256(path) {
  const contents = await readFile(path);
  return createHash('sha256').update(contents).digest('hex');
}

const argumentsMap = readArguments(process.argv.slice(2));
const apkPath = resolve(requireArgument(argumentsMap, 'apk'));
const outputPath = resolve(requireArgument(argumentsMap, 'output'));
const sourceCommit = requireArgument(argumentsMap, 'commit').toLowerCase();
const workflowRunId = requireArgument(argumentsMap, 'run-id');
const workflowRunAttempt = requireArgument(argumentsMap, 'run-attempt');

if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error('Source commit must be a full Git SHA.');
if (!/^\d+$/.test(workflowRunId) || !/^\d+$/.test(workflowRunAttempt)) {
  throw new Error('Workflow run identifiers must be decimal integers.');
}

const [version, releaseConfig, apkStats] = await Promise.all([
  readFile(resolve(repositoryRoot, 'version.json'), 'utf8').then(JSON.parse),
  readFile(resolve(repositoryRoot, 'tools', 'release-config.json'), 'utf8').then(JSON.parse),
  stat(apkPath),
]);

if (!apkStats.isFile()) throw new Error(`Candidate APK is not a file: ${apkPath}`);

const manifest = {
  schemaVersion: 1,
  kind: 'unsigned-android-release-candidate',
  sourceCommit,
  workflow: 'android-ci.yml',
  workflowRunId,
  workflowRunAttempt: Number(workflowRunAttempt),
  packageId: releaseConfig.packageId,
  versionName: String(version.versionName),
  versionCode: Number(version.versionCode),
  signing: 'unsigned',
  apkFileName: basename(apkPath),
  apkSha256: await sha256(apkPath),
  apkSizeBytes: apkStats.size,
  createdAt: new Date().toISOString(),
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Recorded unsigned candidate ${manifest.apkFileName} (${manifest.apkSha256}).`);
