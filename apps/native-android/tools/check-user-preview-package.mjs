import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {apkIdentity,dexClassNames} from './native-apk-identity.mjs';
const upgrade=process.argv.includes('--upgrade-candidate');
const {apk,identity}=apkIdentity(process.argv[2]);assert.equal(identity.mode,upgrade?'upgrade-candidate':'user-preview');
const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT||(process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'Android','Sdk'));
assert.ok(sdk,'Android SDK required to verify the delivery configuration');
const buildTools=path.join(sdk,'build-tools');const versions=fs.readdirSync(buildTools).filter(name=>fs.statSync(path.join(buildTools,name)).isDirectory()).sort((a,b)=>b.localeCompare(a,'en',{numeric:true}));
const executableSuffix=process.platform==='win32'?'.exe':'';
const findBuildTool=name=>versions.map(version=>path.join(buildTools,version,name)).find(file=>fs.existsSync(file));
const apkPath=path.resolve(process.argv[2]);
const aapt=findBuildTool(`aapt2${executableSuffix}`);
assert.ok(aapt,'aapt2 required to verify the delivery configuration');
const badging=execFileSync(aapt,['dump','badging',apkPath],{encoding:'utf8',maxBuffer:4*1024*1024});
assert.equal(/^package: name='([^']+)'/m.exec(badging)?.[1],identity.applicationId);
if(upgrade){
 assert.equal(identity.accountBased,true,'Public native APK must contain account support');
 assert.equal(identity.privateRelay,false,'Public native APK must not contain the legacy private relay');
 const version=JSON.parse(fs.readFileSync(new URL('../../../version.json',import.meta.url),'utf8'));
 const beta=process.argv.find(arg=>arg.startsWith('--beta='))?.slice(7);
 const manifestCode=Number(/^package: .* versionCode='([0-9]+)'/m.exec(badging)?.[1]);
 const manifestName=/^package: .* versionName='([^']+)'/m.exec(badging)?.[1];
 if(beta===undefined){
  const configuredCode=process.argv.find(arg=>arg.startsWith('--release-code='))?.slice(15);
  assert.match(configuredCode??'',/^[1-9][0-9]{0,8}$/,'Specify the formal Android versionCode with --release-code');
  const code=Number(configuredCode);
  const minimum=version.versionCode;
  assert.ok(Number.isSafeInteger(code)&&code>=minimum);
  assert.equal(manifestCode,code);
  assert.equal(manifestName,version.versionName);
 }else{
  assert.match(beta,/^[1-9][0-9]{0,5}$/);
  const code=Number(process.argv.find(arg=>arg.startsWith('--beta-code='))?.slice(12));
  assert.ok(Number.isSafeInteger(code)&&code>version.versionCode);
  assert.equal(manifestCode,code);
  const target=process.argv.find(arg=>arg.startsWith('--beta-target='))?.slice(14)??version.versionName;
  assert.match(target,/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/);
  assert.equal(manifestName,`${target}-beta.${beta}`);
 }
}
const debuggable=/^application-debuggable\s*$/m.test(badging);
assert.ok(!debuggable||!upgrade&&process.argv.includes('--allow-debuggable'),'Delivery must be optimized and non-debuggable');
const forbidden=apk.names.filter(n=>/(\.world\.json$|p2-fixture|p3-audio-formats|^assets\/web\/|^assets\/construction\/|oracle|\.p2pack$|\.(jar|zip|js|mjs)$)/i.test(n));
assert.deepEqual(forbidden,[],'Experimental or source assets in delivery APK');
assert.equal(apk.names.includes('assets/legacy-workspace.html'),upgrade,'Workspace reader must be scoped to the formal migration build');
const dex=Buffer.concat(apk.names.filter(n=>/^classes[0-9]*\.dex$/.test(n)).map(n=>apk.read(n)));
const classes=apk.names.filter(n=>/^classes[0-9]*\.dex$/.test(n)).flatMap(n=>dexClassNames(apk.read(n)));
assert.ok(!classes.some(n=>n.includes('OrbitMeasurement')),'Orbit implementation retained');
const banned=['P2CostActivity','ReferenceWorldView','P3DerivedCacheCheckActivity','P3AudioSourceProvider','P3BackupCaptureActivity','p1-orbit-','p1-retire-','p2-startup-','p2-fixture-domain.json','p2-construction.json','testMeasuredOperation','p3LoadingArt','p3LoadingAnimated','p4VisualPreset','p4ColdCacheTag','BlockcolcStartup'];
for(const marker of banned)assert.ok(!dex.includes(Buffer.from(marker)),'Diagnostic implementation retained: '+marker);
if(!identity.privateRelay)for(const marker of ['PrivateRelayCache','NativePreviewRelay','PrivateRelaySync','BLOCKCOLC_RELAY_UPLOAD_TOKEN','relay.invalid'])assert.ok(!dex.includes(Buffer.from(marker)),'Private implementation retained in standard build');
const manifest=apk.read('AndroidManifest.xml');for(const name of ['P2CostActivity','P3DerivedCacheCheckActivity','P3AudioSourceProvider'])assert.ok(!manifest.includes(Buffer.from(name))&&!manifest.includes(Buffer.from(name,'utf16le')),'Diagnostic component in manifest');
assert.ok(manifest.includes(Buffer.from('MainActivity'))||manifest.includes(Buffer.from('MainActivity','utf16le')));
for(const name of ['icon','roundIcon'])assert.ok(manifest.includes(Buffer.from(name))||manifest.includes(Buffer.from(name,'utf16le')),'Missing native launcher attribute: '+name);
const launcherNames=['ic_launcher','ic_launcher_foreground','ic_launcher_round'];
if(!launcherNames.every(name=>apk.names.some(n=>new RegExp('^res/mipmap-[^/]+/'+name+'\\.png$').test(n)))){
 // Release resource optimization renames ZIP entries (for example res/9w.png).
 // Resolve named resources rather than mistaking renamed artwork for a loss.
 const table=execFileSync(aapt,['dump','resources',apkPath],{encoding:'utf8',maxBuffer:16*1024*1024});
 const resolved=new Map(launcherNames.map(name=>[name,[]]));let current=null;
 for(const line of table.split(/\r?\n/)){
  if(/^\s+resource /.test(line)){const match=/\bmipmap\/(\w+)\s*$/.exec(line);current=match&&resolved.has(match[1])?match[1]:null;}
  if(current){const match=/\(file\) (res\/\S+\.png) type=PNG/.exec(line);if(match)resolved.get(current).push(match[1]);}
 }
 for(const [name,files]of resolved){assert.equal(files.length,5,'Missing density variants: '+name);for(const file of files)assert.ok(apk.names.includes(file),'Missing resolved launcher bitmap: '+file);}
}
const catalog=JSON.parse(apk.read('native-blueprints/catalog.json'));const entries=catalog.entries;assert.equal(entries.length,47,'Bundled catalog must remain intact');
assert.ok(apk.names.some(n=>n.endsWith('.filamat')),'Runtime shaders missing');assert.ok(apk.names.includes('native-original-materials/materials.json'),'Original materials missing');assert.ok(apk.names.some(n=>n.includes('licenses/fusion-pixel/')),'Font licenses missing');assert.ok(apk.names.some(n=>n.endsWith('.ogg')),'Recordings missing');
for(const marker of ['NativeWorldView','NativeApp'])assert.ok(dex.includes(Buffer.from(marker)),'Real application/runtime missing');
assert.equal(dex.includes(Buffer.from('legacyWorkspaceSha')),upgrade,'Missing or unexpected first-start upgrade path');
const signingEvidence={};
if(upgrade){
 const releaseConfig=JSON.parse(fs.readFileSync(new URL('../../../tools/release-config.json',import.meta.url),'utf8'));
 assert.equal(identity.applicationId,releaseConfig.packageId,'Public native package differs from the release identity');
 const apksigner=findBuildTool(path.join('lib','apksigner.jar'));
 const zipalign=findBuildTool(`zipalign${executableSuffix}`);
 assert.ok(apksigner&&zipalign,'apksigner and zipalign required to verify the public native APK');
 const java=process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',`java${executableSuffix}`):'java';
 const signing=execFileSync(java,['-jar',apksigner,'verify','--print-certs',apkPath],{encoding:'utf8'});
 const signers=[...signing.matchAll(/^Signer #\d+ certificate SHA-256 digest:\s*([0-9a-f]{64})\s*$/gim)]
     .map(match=>match[1].toLowerCase());
 assert.deepEqual(signers,[releaseConfig.signerSha256],'APK is not signed with the configured public release certificate');
 execFileSync(zipalign,['-c','-P','16','4',apkPath]);
 signingEvidence.signerSha256=signers[0];
 signingEvidence.alignedFor16KiB=true;
}
console.log(JSON.stringify({userPreviewPackageVerified:!upgrade,upgradeCandidateVerified:upgrade,configuration:identity,debuggable,deliveryEligible:!debuggable&&!upgrade,bundledBlueprints:entries.length,entries:apk.names.length,diagnosticAssets:0,diagnosticImplementations:0,...signingEvidence}));
