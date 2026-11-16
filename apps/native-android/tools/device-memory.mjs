import {writeFile} from 'node:fs/promises';
import path from 'node:path';

// ActivityManager's package attribution includes the isolated WebView process.
// Do not guess ownership from a global process-name prefix or sum only the host.
export function ownedProcesses(text,pkg){
  if(!/^com\.[a-z0-9_.]+$/.test(pkg))throw Error('Invalid memory package');
  const rows=[];
  for(const match of text.matchAll(/^  \*APP\*[^\n]*\n(?:(?!^  \*APP\*|^  Isolated process list|^  OOM levels)[\s\S])*/gm)){
    const block=match[0],header=block.split('\n')[0],id=header.match(/ProcessRecord\{\S+ (\d+):([^/\s]+)\//);
    const packages=block.match(/^\s+packageList=\{([^}]*)\}/m)?.[1].split(',').map(x=>x.trim())??[];
    if(!id||!packages.includes(pkg))continue;
    const pid=Number(id[1]);if(!Number.isSafeInteger(pid)||pid<=0||rows.some(r=>r.pid===pid))throw Error('Invalid attributed PID');
    rows.push({pid,name:id[2],role:id[2]===pkg?'host':block.includes(' ISOLATED ')?'isolated-webview':'owned-service',
      attribution:[header.trim(),'packageList={'+packages.join(',')+'}',...block.split('\n').filter(s=>s.includes('ServiceRecord{')&&s.includes(pkg+'/')).map(s=>s.trim())]});
  }
  return rows;
}
export function memorySummary(text,pid){
  if(Number(text.match(/\*\* MEMINFO in pid (\d+) /)?.[1])!==pid)throw Error('Memory PID changed / unavailable');
  const fields={pssKiB:/TOTAL PSS:\s+(\d+)/,rssKiB:/TOTAL RSS:\s+(\d+)/,swapPssKiB:/TOTAL SWAP PSS:\s+(\d+)/,
    javaKiB:/^\s+Java Heap:\s+(\d+)/m,nativeKiB:/^\s+Native Heap:\s+(\d+)/m,graphicsKiB:/^\s+Graphics:\s+(\d+)/m};
  const result={};for(const [key,pattern]of Object.entries(fields)){const m=text.match(pattern);if(!m)throw Error('Missing Android memory field '+key);result[key]=Number(m[1]);}
  return result;
}
export async function captureOwnedMemory(shell,pkg,output,prefix,{requireWebView=false,requireHost=true,allowRetirement=false}={}){
  if(allowRetirement&&(requireHost||requireWebView))throw Error('Retirement sampling cannot replace a required live-process snapshot');
  const processes=ownedProcesses(shell('dumpsys','activity','processes',pkg),pkg);
  if(requireHost&&!processes.some(p=>p.role==='host')||requireWebView&&!processes.some(p=>p.role==='isolated-webview'))throw Error('Incomplete host / WebView memory attribution');
  const result={processes:[],totals:{pssKiB:0,rssKiB:0,swapPssKiB:0,javaKiB:0,nativeKiB:0,graphicsKiB:0},
    scope:'ActivityManager-attributed host and isolated WebView processes. Android PSS / reported Graphics, not exact standalone VRAM. RSS sum includes shared mappings; do not interpret as unique memory.'};
  const unavailable=[];
  for(const p of processes){const raw=shell('dumpsys','meminfo',String(p.pid));
    await writeFile(path.join(output,prefix+'-pid-'+p.pid+'-memory.txt'),raw);
    let summary;try{summary=memorySummary(raw,p.pid);}catch(error){if(!allowRetirement)throw error;unavailable.push({...p,error:String(error)});continue;}
    result.processes.push({...p,...summary});for(const key of Object.keys(result.totals))result.totals[key]+=summary[key];}
  const after=ownedProcesses(shell('dumpsys','activity','processes',pkg),pkg);
  const same=(a,b)=>a.pid===b.pid&&a.name===b.name;
  if(!allowRetirement){if(JSON.stringify(after.map(p=>[p.pid,p.name]).sort())!==JSON.stringify(processes.map(p=>[p.pid,p.name]).sort()))throw Error('Process identity changed during memory collection');}
  else{
    if(after.some(p=>!processes.some(b=>same(p,b))))throw Error('New / replaced process during retirement collection');
    if(unavailable.some(p=>after.some(a=>same(p,a))))throw Error('Still-live process has unavailable memory');
    const retired=processes.filter(p=>!after.some(a=>same(p,a)));
    result.retiredDuringCollection=retired;result.remainingAfterCollection=after;
    result.completeSnapshot=retired.length===0&&unavailable.length===0;
    if(!result.completeSnapshot){result.partialTotals=result.totals;result.totals=null;
      result.unavailable=unavailable;result.scope+=' Processes retired during this exit observation: totals are deliberately unavailable, not zero and not comparable to the active snapshot.';}
  }
  return result;
}
