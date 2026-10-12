import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:net';
import path from 'node:path';

const args=process.argv.slice(2),option=name=>args[args.indexOf(name)+1];
const serial=option('--serial'),apk=option('--apk'),output=path.resolve(option('--output'));
if(!/^[\w-]+$/.test(serial??'')||!apk)throw Error('Explicit device, installed diagnostic APK and output required');
const adb=path.join(process.env.LOCALAPPDATA,'Android/Sdk/platform-tools/adb.exe'),pkg='com.blockcolc.app';
const report={status:'running',sha256:createHash('sha256').update(await readFile(apk)).digest('hex')};
let socket,forward;
const call=(...argv)=>new Promise((resolve,reject)=>{const p=spawn(adb,['-s',serial,...argv],{windowsHide:true});let out='';const timer=setTimeout(()=>p.kill(),30000);p.stdout.on('data',v=>out+=v);p.on('error',reject);p.on('exit',code=>{clearTimeout(timer);code===0?resolve(out):reject(Error('ADB failed'));});});
try{
  const installed=(await call('shell','pm','path',pkg)).split(/\r?\n/).find(s=>s.endsWith('base.apk'))?.replace('package:','').trim();
  if(!installed||!(await call('shell','sha256sum',installed)).startsWith(report.sha256))throw Error('Installed APK mismatch');
  const pid=(await call('shell','pidof',pkg)).trim();if(!/^\d+$/.test(pid))throw Error('Unique app process required');
  const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
  forward=`tcp:${port}`;await call('forward','--no-rebind',forward,`localabstract:webview_devtools_remote_${pid}`);
  const targets=(await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json())).filter(t=>t.type==='page'&&/^https?:\/\/localhost(?:[:/]|$)/.test(t.url));
  if(targets.length!==1)throw Error('Unique app-owned WebView required');
  const url=new URL(targets[0].webSocketDebuggerUrl);url.hostname='127.0.0.1';url.port=String(port);
  socket=new WebSocket(url);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
  const expression=`(async()=>{
    const c=document.querySelector('canvas[data-world-canvas]'),keys=['terrainGenerationBytes','terrainGenerationCacheRetained','terrainGenerationCacheHit','worldSceneCacheRead','worldSceneCacheReadMs','sceneryPlanCacheHit','sceneryObjectCount','worldRebuildStagesMs','terrainCellCount','terrainRenderTriangles'];
    const canvas=Object.fromEntries(keys.map(k=>[k,c?.dataset[k]??null]));
    const headers=await new Promise(resolve=>{const r=indexedDB.open('blockcolc-derived-world-scene',1);r.onerror=()=>resolve([]);r.onsuccess=()=>{const db=r.result;if(!db.objectStoreNames.contains('headers')){db.close();resolve([]);return;}const q=db.transaction('headers').objectStore('headers').getAll();q.onsuccess=()=>{const result=q.result.map(h=>({slot:h.slot,bytes:h.bytes,updatedAt:h.updatedAt}));db.close();resolve(result);};q.onerror=()=>{db.close();resolve([]);};};});
    return{canvas,headers,probe:window.__blockcolcPerformanceProbe?.snapshot()};
  })()`;
  const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Inspection timeout')),30000);socket.addEventListener('message',event=>{const m=JSON.parse(String(event.data));if(m.id!==1)return;clearTimeout(timer);m.error||m.result?.exceptionDetails?reject(Error('Inspection failed')):resolve(m.result.result.value);});socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));});
  report.result=result;report.status='completed';
}catch(error){report.status='failed';report.failure=error.message;process.exitCode=1;}
finally{socket?.close();if(forward)await call('forward','--remove',forward).catch(()=>{});await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2));console.log(`World cache inspection ${report.status}: ${output}`);}
