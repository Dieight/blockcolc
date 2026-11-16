import {buildSync} from 'esbuild';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Device report and new result required');
const root=fileURLToPath(new URL('../../../',import.meta.url));
const code=buildSync({entryPoints:[path.join(root,'packages/domain/src/index.ts')],bundle:true,write:false,platform:'node',format:'esm'}).outputFiles[0].text;
const {execute,parseDomainState}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const projections=buildSync({entryPoints:[path.join(root,'packages/application/src/focus-attribution.ts')],bundle:true,write:false,platform:'node',format:'esm'}).outputFiles[0].text;
const {projectFocusAttribution}=await import('data:text/javascript;base64,'+Buffer.from(projections).toString('base64'));
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const report=JSON.parse(readFileSync(input));const result={completed:false,commands:0,transactions:0,scope:'Actual Android SQLite/actor journal replayed by current formal TS, including background commands'};
try {
 assert.equal(report.completed,true);let state=parseDomainState(JSON.parse(report.initial));
 for(const transaction of report.commands){
   const events=[];
   for(const item of transaction.commands){
     const r=execute(state,item.command,{now:()=>new Date(item.now)});assert.equal(r.ok,true,item.command.type+':'+r.code);state=r.state;events.push(...r.events);result.commands++;
   }
   assert.equal(canonical(state),transaction.after,'complete persisted state transaction '+result.transactions);
   assert.equal(canonical(events),canonical(transaction.events),'events transaction '+result.transactions);result.transactions++;
 }
 assert.equal(canonical(state),report.final);assert.equal(canonical(projectFocusAttribution(state)),canonical(report.attribution));
 result.completed=true;
}catch(error){result.failure=String(error);process.exitCode=1;}
writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
