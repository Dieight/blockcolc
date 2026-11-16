import {buildSync} from 'esbuild';
import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url)),out=process.argv[2];
const source=path.join(root,'packages/application/src/focus-export.ts');
const built=buildSync({entryPoints:[source],bundle:true,write:false,platform:'node',format:'esm'});
const {projectFocusExportDays,projectFocusExportSnapshot}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const cases=[];
for(let i=0;i<96;i++){
 const now=Date.parse('2026-10-29T16:05:00.000Z')+i*60000;
 const begin=Date.parse('2026-10-29T15:50:00.000Z');
 const history=[{id:'synthetic-history',startedAt:new Date(begin).toISOString(),actualDurationMs:1200000}];
 const state={projects:[{id:'private-parent',subtasks:[{id:'task',title:'合成小事'}]}],focusHistory:history,activeFocusSession:null};
 if(i%4!==0)state.activeFocusSession={id:'active',projectId:'private-parent',subtaskId:i%5===0?null:'task',startedAt:'2026-10-29T15:55:00.000Z',endsAt:'2026-10-29T17:00:00.000Z',marathon:i%4===2,deferredSettlement:i%4===3};
 // Cases before the history's actual completion deliberately test rejected capture clocks separately.
 if(now<begin+1200000)continue;
 const at=new Date(now).toISOString();
 cases.push({state,at,from:'2026-10-29',snapshot:projectFocusExportSnapshot(state,at),days:projectFocusExportDays(state,'2026-10-29','2026-10-30',at)});
}
mkdirSync(out,{recursive:true});writeFileSync(path.join(out,'focus-oracle.json'),JSON.stringify({sourceSha256:createHash('sha256').update(readFileSync(source)).digest('hex'),cases}));
