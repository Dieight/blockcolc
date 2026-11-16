import {chromium} from 'playwright';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import path from 'node:path';
const [base,output]=process.argv.slice(2);if(!base||!output)throw Error('frozen base and fresh output required');
await mkdir(output,{recursive:false});await mkdir(path.join(output,'construction'));await mkdir(path.join(output,'images'));
const hash=b=>createHash('sha256').update(b).digest('hex'),manifest=JSON.parse(await readFile(path.join(base,'manifest.json')));
const index={schema:1,scope:'Complete admitted first-workshop construction thresholds, owner-only exact CPU output; not general native world generation',fixtures:{},images:{},completed:false};
const started=Date.now(),browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:720,height:960},reducedMotion:'reduce',timezoneId:'Asia/Shanghai'});
 await page.route('**/web/controlled-resource-pack.json',route=>route.fulfill({path:path.resolve(base,'resource-pack.json'),contentType:'application/json'}));
 await page.exposeFunction('saveOwnerPack',async(name,metadata,bytes,animals,images,timing)=>{
   if(!/^(ocean|coast|valley|floating)-[0-9]{1,5}$/.test(name))throw Error('Unsafe owner filename');
   const encoded=gzipSync(Buffer.from(JSON.stringify({metadata,bytes,animals})),{level:9}),file='construction/'+name+'.p2pack';await writeFile(path.join(output,file),encoded);
   for(const [name,base64]of images){if(!/^[a-f0-9]{64}\.(png|f32)$/.test(name))throw Error('Unsafe texture');const data=Buffer.from(base64,'base64');index.images[name]=hash(data);await writeFile(path.join(output,'images',name),data);}
   return {file,sha256:hash(encoded),bytes:encoded.length,binarySha256:metadata.binarySha256,timing};
 });
 await page.goto('http://127.0.0.1:42039/apps/native-android/tools/world.html',{waitUntil:'domcontentloaded',timeout:120000});await page.waitForFunction(()=>window.nativeP1,null,{timeout:120000});
 await page.evaluate(async()=>{window.p2OwnerExporter=await import('/apps/native-android/tools/owner-only-export.ts');window.p2SentImages=new Set();});
 if(manifest.resourcePack)await page.evaluate(i=>window.nativeP1.loadResourcePackWire(i),manifest.resourcePack.identity);
 for(const fixture of manifest.reports){
   await page.evaluate(({style,profile})=>window.nativeP1.build(style,25,profile),{style:fixture.style,profile:manifest.profile});
   const source=await page.evaluate(()=>window.nativeP1.constructionOrders()),template=JSON.parse(await readFile(path.join(base,fixture.name+'-update.world.json')));
   const bound=JSON.parse(await readFile(path.join(base,fixture.name+'.world.json'))),rows=[];index.fixtures[fixture.name]={blueprintId:source.blueprintId,baseBinary:bound.binarySha256,rows};
   for(const progress of source.orders){
     const row=await page.evaluate(async({fixture,progress,template})=>{
       const b=await window.p2OwnerExporter.bundleOwner(fixture,progress,template),encode=bytes=>{let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);};
       const images=[];for(const [name,bytes]of b.images)if(name.startsWith('images/')&&!window.p2SentImages.has(name)){window.p2SentImages.add(name);images.push([name.slice(7),encode(bytes)]);}
       return window.saveOwnerPack(fixture+'-'+progress,b.metadata,encode(b.bytes),encode(b.images.get(b.metadata.animalRuntime.file)),images,b.timing);
     },{fixture:fixture.name,progress,template});rows.push({progress,...row});
   }
 }
 index.completed=true;index.elapsedMs=Date.now()-started;await writeFile(path.join(output,'p2-construction.json'),JSON.stringify(index));console.log(JSON.stringify({completed:true,elapsedMs:index.elapsedMs,fixtures:Object.fromEntries(Object.entries(index.fixtures).map(([k,v])=>[k,v.rows.length]))}));
}catch(error){await writeFile(path.join(output,'failure.json'),JSON.stringify({failure:String(error),index},null,2));throw error;}finally{await browser.close();}
