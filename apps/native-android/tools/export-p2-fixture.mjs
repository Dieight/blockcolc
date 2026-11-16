import {buildSync} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('frozen inputs and output required');
const manifest=JSON.parse(readFileSync(path.join(input,'manifest.json')));
const catalog=manifest.reports[0].blueprints; if(!catalog?.length)throw Error('Frozen blueprint identity list missing');
const code=buildSync({entryPoints:[path.join(root,'packages/domain/src/index.ts')],bundle:true,write:false,platform:'node',format:'esm'}).outputFiles[0].text;
const {createInitialState,execute,parseDomainState}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
let state=createInitialState('Asia/Shanghai'),now=Date.parse('2026-09-15T00:00:00.000Z');
function command(c,delta=1){now+=delta;const r=execute(state,c,{now:()=>new Date(now)});if(!r.ok)throw Error(c.type+':'+r.code);state=r.state;}
for(let i=0;i<25;i++) {
  command({type:'CreateProject',projectId:'complex-'+i,title:i===0?'正在建造的工坊':'已完成建筑 '+i,blueprintId:catalog[i%catalog.length].id,subtasks:i===0?[{id:'read',title:'读一章'},{id:'write',title:'写下想法'}]:[{id:'done-'+i,title:'已完成'}]});
  if(i>0){command({type:'StartFocus',sessionId:'fixture-focus-'+i,subtaskId:'done-'+i,plannedDurationMs:60000});command({type:'CompleteFocusEarly',reportId:'fixture-report-'+i},1000);}
}
command({type:'SwitchActiveProject',projectId:'complex-0'});parseDomainState(state);
mkdirSync(output,{recursive:true});writeFileSync(path.join(output,'p2-fixture-domain.json'),JSON.stringify(state));
console.log(JSON.stringify({synthetic:true,projects:state.projects.length,first:state.projects[0].blueprintId,formalDataRead:false}));
