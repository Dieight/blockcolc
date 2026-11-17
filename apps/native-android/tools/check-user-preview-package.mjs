import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {apkIdentity,dexClassNames} from './native-apk-identity.mjs';
const {apk,identity}=apkIdentity(process.argv[2]);assert.equal(identity.mode,'user-preview');
const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT||(process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'Android','Sdk'));
assert.ok(sdk,'Android SDK required to verify the delivery configuration');
const buildTools=path.join(sdk,'build-tools');const versions=fs.readdirSync(buildTools).filter(name=>fs.statSync(path.join(buildTools,name)).isDirectory()).sort((a,b)=>b.localeCompare(a,'en',{numeric:true}));
const aapt=versions.map(version=>path.join(buildTools,version,process.platform==='win32'?'aapt2.exe':'aapt2')).find(file=>fs.existsSync(file));
assert.ok(aapt,'aapt2 required to verify the delivery configuration');
const badging=execFileSync(aapt,['dump','badging',path.resolve(process.argv[2])],{encoding:'utf8',maxBuffer:4*1024*1024});
const debuggable=/^application-debuggable\s*$/m.test(badging);
assert.ok(!debuggable||process.argv.includes('--allow-debuggable'),'User delivery must be optimized and non-debuggable; rebuild with :app:recordUserPreview');
const forbidden=apk.names.filter(n=>/(\.world\.json$|p2-fixture|p3-audio-formats|^assets\/web\/|^assets\/construction\/|oracle|\.p2pack$|\.(jar|zip|js|mjs)$)/i.test(n));assert.deepEqual(forbidden,[],'Experimental or source assets in user preview');
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
 const table=execFileSync(aapt,['dump','resources',path.resolve(process.argv[2])],{encoding:'utf8',maxBuffer:16*1024*1024});
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
console.log(JSON.stringify({userPreviewPackageVerified:true,configuration:identity,debuggable,deliveryEligible:!debuggable,bundledBlueprints:entries.length,entries:apk.names.length,diagnosticAssets:0,diagnosticImplementations:0}));
