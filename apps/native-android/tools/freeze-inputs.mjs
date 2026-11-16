import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = process.argv[2];
if (!output) throw new Error('Choose a new P0 evidence directory.');
await mkdir(path.dirname(path.resolve(output)), {recursive: true});
await mkdir(output, {recursive: false});
const inputs = ['version.json', 'package.json', 'package-lock.json', 'BLOCKCOLC.md',
  'ARCHITECTURE.md', 'MINECRAFT-VISUAL-COMPATIBILITY.md', 'apps/web/src',
  'apps/web/public/audio', 'apps/web/public/fonts', 'apps/android/android/app/src/main/java',
  'apps/android/android/app/build.gradle', 'apps/android/android/variables.gradle',
  'packages/domain/src', 'packages/application/src', 'packages/storage-indexeddb/src',
  'packages/voxel/src', 'packages/litematic/src'];
const entries = [];
async function capture(relative) {
  const absolute = path.join(root, relative);
  let children;
  try { children = await readdir(absolute, {withFileTypes: true}); }
  catch (error) { if (error.code !== 'ENOTDIR') throw error; }
  if (children) {
    for (const child of children.sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
      if (child.isSymbolicLink()) throw new Error('Unexpected linked input: '+relative+'/'+child.name);
      await capture(relative+'/'+child.name);
    }
  } else {
    const bytes = await readFile(absolute);
    entries.push({path: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
  }
}
for (const input of inputs) await capture(input);
entries.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
const fingerprint = createHash('sha256').update(JSON.stringify(entries)).digest('hex');
const report = {kind:'blockcolc-native-p0', clientDate:'2026-10-20',
  version:JSON.parse(await readFile(path.join(root,'version.json'),'utf8')),
  head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  baselineStatus:'Provisional /100-followup source, not a released or user-accepted v2.9.0 baseline',
  formalDataRead:false, privateConfigurationRead:false, fingerprint, files:entries};
await writeFile(path.join(output,'source-inputs.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({files:entries.length,fingerprint,output}));
