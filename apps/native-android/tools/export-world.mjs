import {chromium} from 'playwright';
import {mkdir,writeFile,readFile,readdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {exportArguments} from './fixture-scope.mjs';

const {output,profile,assets,fixtures,jar,inventoryOnly}=exportArguments(process.argv.slice(2));
let controlledPack=null;
if(jar){
  const source=path.resolve(jar),info=await stat(source);
  if(!info.isFile()||info.size<=0||info.size>64*1024*1024)throw Error('Controlled client JAR exceeds bounded import envelope');
  controlledPack={source,bytes:info.size,sha256:createHash('sha256').update(await readFile(source)).digest('hex')};
}
await mkdir(path.dirname(path.resolve(output)),{recursive:true});await mkdir(output,{recursive:false});
await mkdir(path.join(output,'images'));
const tools=fileURLToPath(new URL('./',import.meta.url));
async function toolInputs(){return Promise.all((await readdir(tools)).filter(name=>/\.(mjs|ts|html)$/.test(name)).sort().map(async name=>({name,sha256:createHash('sha256').update(await readFile(path.join(tools,name))).digest('hex')})));}
const generatorBefore=await toolInputs();
execFileSync(process.execPath,[path.join(tools,'freeze-inputs.mjs'),path.join(output,'producer-before')],{stdio:'pipe'});
const baseline=JSON.parse(await readFile(path.join(output,'producer-before/source-inputs.json')));
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const reports=[],errors=[];let activeFixture=null;
try {
  const page=await browser.newPage({viewport:{width:720,height:960},reducedMotion:'reduce',timezoneId:'Asia/Shanghai'});
  if(controlledPack)await page.route('**/p1-controlled-client.jar',route=>route.fulfill({path:controlledPack.source,contentType:'application/java-archive'}));
  page.on('pageerror',e=>errors.push(e.message));
  page.on('requestfailed',request=>errors.push(request.url()+': '+request.failure()?.errorText));
  await page.exposeFunction('writeP1Asset',async(name,base64)=>{
    if(!/^(images\/[a-f0-9]{64}\.(png|f32)|(ocean|coast|valley|floating)(-update)?(\.animals)?\.bin)$/.test(name))throw Error('Unsafe export filename');
    await writeFile(path.join(output,name),Buffer.from(base64,'base64'));
  });
  await page.goto('http://127.0.0.1:42039/apps/native-android/tools/world.html',{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>window.nativeP1,null,{timeout:120000});
  const pack=controlledPack?await page.evaluate(hash=>window.nativeP1.loadResourcePack('/p1-controlled-client.jar',hash),controlledPack.sha256):null;
  if(pack&&!inventoryOnly){const wire=await page.evaluate(()=>window.nativeP1.packWire());
    await writeFile(path.join(output,'resource-pack.json'),wire);
    pack.identity.wireSha256=createHash('sha256').update(wire).digest('hex');}
  for(const {name,style} of fixtures) {
    const prepared=await page.evaluate(({style,profile})=>window.nativeP1.build(style,25,profile),{style,profile});
    activeFixture={name,...prepared};
    await page.screenshot({path:path.join(output,name+'-production.png'),timeout:180000});
    if(inventoryOnly){reports.push(activeFixture);activeFixture=null;continue;}
    const metadata=await page.evaluate(async name=>{
      const bundle=await window.nativeP1.bundle();
      for(const [filename,bytes] of [...bundle.images,[name+'.bin',bundle.bytes]]) {
        // A single buffer per file. No append across retries, and no half-valid previous fixture.
        let raw='';for(let i=0;i<bytes.length;i+=32768)raw+=String.fromCharCode(...bytes.subarray(i,i+32768));
        await window.writeP1Asset(filename,btoa(raw));
      }
      return bundle.metadata;
    },name);
    reports.push({name,...prepared,inventory:metadata.inventory,unsupportedPrograms:metadata.unsupported.length,binarySha256:metadata.binarySha256});
    await writeFile(path.join(output,name+'.world.json'),JSON.stringify(metadata));
    reports.at(-1).cameraAudit=await page.evaluate(()=>window.nativeP1.auditAngles());
    const update=await page.evaluate(async name=>{
      const bundle=await window.nativeP1.replaceBuilding();
      for(const [filename,bytes] of [...bundle.images,[name+'-update.bin',bundle.bytes]]) {
        let raw='';for(let i=0;i<bytes.length;i+=32768)raw+=String.fromCharCode(...bytes.subarray(i,i+32768));
        await window.writeP1Asset(filename,btoa(raw));
      }
      return bundle.metadata;
    },name);
    await writeFile(path.join(output,name+'-update.world.json'),JSON.stringify(update));
    await page.screenshot({path:path.join(output,name+'-production-update.png'),timeout:180000});
    if(update.inventory.owners.length!==1||update.inventory.owners[0]!=='building:complex-0')throw Error('Replacement owner boundary failed');
    reports.at(-1).update={owner:'building:complex-0',inventory:update.inventory,binarySha256:update.binarySha256};
    activeFixture=null;
  }
  execFileSync(process.execPath,[path.join(tools,'freeze-inputs.mjs'),path.join(output,'producer-after')],{stdio:'pipe'});
  const after=JSON.parse(await readFile(path.join(output,'producer-after/source-inputs.json'))),generatorAfter=await toolInputs();
  if(baseline.fingerprint!==after.fingerprint||JSON.stringify(generatorBefore)!==JSON.stringify(generatorAfter))throw Error('Producer changed during export');
  const manifest={executedAt:new Date().toISOString(),profile,assets,inventoryOnly,resourcePack:pack,productionDataRead:false,producerFingerprint:baseline.fingerprint,generatorInputs:generatorBefore,reports,errors};
  await writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2));
  if(errors.length)throw Error(errors.join('\n'));
  console.log(JSON.stringify(manifest,null,2));
} catch(error) {
  await writeFile(path.join(output,'failure.json'),JSON.stringify({error:String(error),completed:reports,activeFixture,errors},null,2));throw error;
} finally {await browser.close();}
