import {chromium} from 'playwright';
import {readFile,mkdir,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const [base,output,mode='complete',strategy='owner']=process.argv.slice(2);if(!base||!output||!['complete','sample'].includes(mode)||!['world','owner'].includes(strategy))throw Error('Frozen base, new output and optional complete|sample world|owner required');
await mkdir(output,{recursive:false});await mkdir(path.join(output,'construction'));await mkdir(path.join(output,'images'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(await readFile(path.join(base,'manifest.json')));
const root=fileURLToPath(new URL('../../../',import.meta.url));
const producer=JSON.parse(await readFile(path.join(base,'producer-before/source-inputs.json')));
const worldSource=producer.files.filter(entry=>entry.path.startsWith('packages/voxel/src/'));
if(worldSource.length<20)throw Error('Frozen world source identity missing');
for(const entry of worldSource)if(hash(await readFile(path.join(root,entry.path)))!==entry.sha256)throw Error('Frozen base world source changed: '+entry.path);
const exporterFiles=['tools/export-construction.mjs','tools/owner-only-export.ts','tools/export-fixture.ts','tools/vite.config.ts','tools/animal-source.ts'];
const exporterSource=await Promise.all(exporterFiles.map(async name=>({name,sha256:hash(await readFile(new URL(name.slice(6),import.meta.url)))})));
const index={schema:1,scope:'Exact current TS owner-only CPU construction breakpoints for the admitted P2 first-building fixture; not a generic native geometry generator',fixtures:{},images:{},completed:false};
index.baseProducerFingerprint=manifest.producerFingerprint;index.worldSource=worldSource;index.exporterSource=exporterSource;
index.exhaustive=mode==='complete';
index.sourceStrategy=strategy;
const started=Date.now();
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const deadline=setTimeout(()=>{void browser.close();},20*60_000);
const written=new Map();
try {
 const page=await browser.newPage({viewport:{width:720,height:960},reducedMotion:'reduce',timezoneId:'Asia/Shanghai'});
 await page.route('**/web/controlled-resource-pack.json',route=>route.fulfill({path:path.resolve(base,'resource-pack.json'),contentType:'application/json'}));
 await page.exposeFunction('saveConstruction',async(fixture,order,bundle)=>{
   if(!['ocean','coast','valley','floating'].includes(fixture)||!Number.isInteger(order)||order<0||order>10000)throw Error('Unsafe construction path');
   const {metadata,bytes,animals,images,timing}=bundle;
   if(metadata.inventory.owners.length!==1||metadata.inventory.owners[0]!=='building:complex-0')throw Error('Owner leak');
   const pack=gzipSync(Buffer.from(JSON.stringify({metadata,bytes,animals})),{level:9});const name=`construction/${fixture}-${order}.p2pack`;
   await writeFile(path.join(output,name),pack);
   for(const [name,base64]of images){if(!/^[a-f0-9]{64}\.(png|f32)$/.test(name))throw Error('Unsafe image');const image=Buffer.from(base64,'base64'),digest=hash(image);
     if(written.has(name)){if(written.get(name)!==digest)throw Error('Asset identity conflict');continue;}
     written.set(name,digest);index.images[name]=digest;await writeFile(path.join(output,'images',name),image);
   }
   return {progress:order,file:name,sha256:hash(pack),bytes:pack.length,binarySha256:metadata.binarySha256,timing};
 });
 await page.goto('http://127.0.0.1:42039/apps/native-android/tools/world.html',{waitUntil:'domcontentloaded',timeout:120000});
 await page.waitForFunction(()=>window.nativeP1,null,{timeout:120000});
 if(manifest.resourcePack)await page.evaluate(identity=>window.nativeP1.loadResourcePackWire(identity),manifest.resourcePack.identity);
 for(const fixture of manifest.reports){
   await page.evaluate(({style,profile})=>window.nativeP1.build(style,25,profile),{style:fixture.style,profile:manifest.profile});
   const source=await page.evaluate(()=>window.nativeP1.constructionOrders());
   const bound=JSON.parse(await readFile(path.join(base,fixture.name+'.world.json')));
   await page.evaluate(template=>{window.constructionBase=template;},bound);
   if(source.blueprintId!==fixture.blueprints[0].id)throw Error('Blueprint identity differs');
   const rows=[];index.fixtures[fixture.name]={blueprintId:source.blueprintId,baseBinary:bound.binarySha256,rows};
   const orders=mode==='sample'?[source.orders[0],source.orders[Math.floor(source.orders.length/2)],source.orders.at(-1)]:source.orders;
   for(const order of orders) {
     const row=await page.evaluate(async({fixture,order,strategy})=>{
       const {bundleOwner}=await import('/apps/native-android/tools/owner-only-export.ts');
       const b=await bundleOwner(fixture,order,window.constructionBase,strategy);
       const base64=bytes=>{let raw='';for(let i=0;i<bytes.length;i+=32768)raw+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(raw);};
       const animalFile=b.metadata.animalRuntime.file;
       return window.saveConstruction(fixture,order,{metadata:b.metadata,bytes:base64(b.bytes),animals:base64(b.images.get(animalFile)),
         images:[...b.images].filter(([name])=>name.startsWith('images/')).map(([name,bytes])=>[name.slice(7),base64(bytes)]),timing:b.timing});
     },{fixture:fixture.name,order,strategy});
     rows.push(row);
   }
 }
 for(const entry of exporterSource)if(hash(await readFile(new URL(entry.name.slice(6),import.meta.url)))!==entry.sha256)throw Error('Exporter changed while producing construction inputs');
 for(const entry of worldSource)if(hash(await readFile(path.join(root,entry.path)))!==entry.sha256)throw Error('World source changed during construction export');
 index.completed=mode==='complete';index.sampleCompleted=mode==='sample';index.elapsedMs=Date.now()-started;await writeFile(path.join(output,'p2-construction.json'),JSON.stringify(index));
 console.log(JSON.stringify({completed:index.completed,sampleCompleted:index.sampleCompleted,fixtures:Object.fromEntries(Object.entries(index.fixtures).map(([k,v])=>[k,v.rows.length])),bytes:Object.values(index.fixtures).flatMap(v=>v.rows).reduce((s,r)=>s+r.bytes,0)}));
}catch(error){await writeFile(path.join(output,'failure.json'),JSON.stringify({failure:String(error),index},null,2));throw error;}
finally{clearTimeout(deadline);await browser.close();}
