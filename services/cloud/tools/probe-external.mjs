import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CloudStore} from '../src/store.mjs';
import {ExternalFocusBridge} from '../src/external-focus.mjs';

const configuration=process.argv[2];if(!configuration)throw Error('Expected a configuration file path');
const directory=mkdtempSync(join(tmpdir(),'blockcolc-external-live-')),store=new CloudStore(directory);
const bridge=new ExternalFocusBridge(store,{configuration});
try{
  await bridge.poll({force:true});
  const results=bridge.descriptions().map(source=>{
    const row=store.db.prepare('SELECT projection,error FROM external_sources WHERE id=?').get(source.id),projection=row.projection?JSON.parse(row.projection):null;
    return {source:source.id,available:source.available,syncedAt:source.syncedAt,error:row.error,days:projection?.days.length??0,focusState:projection?.focusState??null};
  });
  console.log(JSON.stringify({at:new Date().toISOString(),results}));if(results.some(source=>!source.available))process.exitCode=1;
}finally{await bridge.stop();store.close();rmSync(directory,{recursive:true,force:true});}
