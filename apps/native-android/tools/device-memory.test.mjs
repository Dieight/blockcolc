import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ownedProcesses,memorySummary,captureOwnedMemory} from './device-memory.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const pkg='com.blockcolc.preview';
test('isolated renderer belongs to its ActivityManager package, not its provider name',()=>{
  const text=`  *APP* UID 10421 ProcessRecord{abc 123:${pkg}/u0a421}
    packageList={${pkg}}
  *APP* UID 99724 ProcessRecord{def 456:com.google.android.webview:sandboxed_process0/u0a421i724}
    user #0 uid=10421 ISOLATED uid=99724
    packageList={${pkg}}
    Services:
      - ServiceRecord{own u0 ${pkg}/org.chromium.content.app.SandboxedProcessService0}
  *APP* UID 99725 ProcessRecord{ghi 789:com.google.android.webview:sandboxed_process1/u0a111i725}
    user #0 uid=10111 ISOLATED uid=99725
    packageList={com.example.unrelated}
  Isolated process list (sorted by uid):
    Isolated #0: ProcessRecord{def 456:com.google.android.webview:sandboxed_process0/u0a421i724}`;
  const rows=ownedProcesses(text,pkg);assert.deepEqual(rows.map(p=>[p.pid,p.role]),[[123,'host'],[456,'isolated-webview']]);
  assert.equal(ownedProcesses(text,'com.blockcolc.pre').length,0);
});
test('memory requires complete fields and the same exact process identity',()=>{
  const text=`** MEMINFO in pid 456 [com.google.android.webview:sandboxed_process0] **
           Java Heap: 784 20424
         Native Heap: 820 2764
            Graphics: 0 0
           TOTAL PSS: 691659 TOTAL RSS: 759992 TOTAL SWAP PSS: 49123`;
  assert.deepEqual(memorySummary(text,456),{pssKiB:691659,rssKiB:759992,swapPssKiB:49123,javaKiB:784,nativeKiB:820,graphicsKiB:0});
  assert.throws(()=>memorySummary(text,123),/PID/);assert.throws(()=>memorySummary(text.replace('TOTAL PSS:','REMOVED:'),456),/Missing/);
});

test('retired WebView memory is unavailable rather than counted as zero; live snapshots remain strict',async()=>{
  const output=await mkdtemp(path.join(tmpdir(),'blockcolc-p1-memory-'));
  const owned=`  *APP* UID 99724 ProcessRecord{def 456:com.google.android.webview:sandboxed_process0/u0a421i724}\n    user #0 uid=10421 ISOLATED uid=99724\n    packageList={${pkg}}\n`;
  const sample=async(options,after)=>{let calls=0;return captureOwnedMemory((...args)=>args[1]==='activity'?(++calls===1?owned:after):'No process found for: 456',pkg,output,'retiring',options);};
  try{
    await assert.rejects(sample({requireHost:false},''),/PID/);
    const r=await sample({requireHost:false,allowRetirement:true},'');
    assert.equal(r.completeSnapshot,false);assert.equal(r.totals,null);assert.equal(r.retiredDuringCollection[0].pid,456);assert.equal(r.remainingAfterCollection.length,0);
    await assert.rejects(sample({requireHost:false,allowRetirement:true},owned),/Still-live/);
    await assert.rejects(sample({requireHost:false,allowRetirement:true},owned.replaceAll('456','789')),/New \/ replaced/);
    await assert.rejects(sample({allowRetirement:true},''),/cannot replace/);
  }finally{await rm(output,{recursive:true,force:true});}
});
