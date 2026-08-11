import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
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
const manifestPath = resolve(requireArgument(argumentsMap, 'manifest'));
const expectedCommit = argumentsMap.get('expected-commit')?.toLowerCase();
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const [version, releaseConfig] = await Promise.all([
  readFile(resolve(repositoryRoot, 'version.json'), 'utf8').then(JSON.parse),
  readFile(resolve(repositoryRoot, 'tools', 'release-config.json'), 'utf8').then(JSON.parse),
]);

if (manifest.schemaVersion !== 1 || manifest.kind !== 'unsigned-android-release-candidate') {
  throw new Error('Unsupported CI candidate manifest.');
}
if (manifest.signing !== 'unsigned') throw new Error('CI candidate must be explicitly unsigned.');
if (basename(manifest.apkFileName) !== manifest.apkFileName) throw new Error('Unsafe APK file name in manifest.');
if (!/^[0-9a-f]{40}$/.test(manifest.sourceCommit)) throw new Error('Invalid source commit in manifest.');
if (expectedCommit && manifest.sourceCommit !== expectedCommit) {
  throw new Error(`Source commit mismatch: expected ${expectedCommit}, found ${manifest.sourceCommit}.`);
}
if (manifest.packageId !== releaseConfig.packageId) throw new Error('Candidate package ID does not match release configuration.');
if (manifest.versionName !== String(version.versionName) || manifest.versionCode !== Number(version.versionCode)) {
  throw new Error('Candidate version does not match version.json.');
}

const apkPath = resolve(dirname(manifestPath), manifest.apkFileName);
const apkStats = await stat(apkPath);
if (!apkStats.isFile()) throw new Error(`Candidate APK is not a file: ${apkPath}`);
if (apkStats.size !== manifest.apkSizeBytes) throw new Error('Candidate APK size does not match its manifest.');

const actualSha256 = await sha256(apkPath);
if (actualSha256 !== manifest.apkSha256) {
  throw new Error(`Candidate SHA-256 mismatch: expected ${manifest.apkSha256}, found ${actualSha256}.`);
}

console.log(`Verified CI candidate ${manifest.apkFileName} from ${manifest.sourceCommit} (${actualSha256}).`);
