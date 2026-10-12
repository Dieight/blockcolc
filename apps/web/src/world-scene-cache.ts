import type { WorldSceneCache, WorldSceneCachePort, TerrainEnvironmentStyle, BuildingCpuCache, BuildingCpuCachePort } from '@blockcolc/voxel';
import { queueIdleWork } from './idle-work';

const DB_NAME = 'blockcolc-derived-world-scene';
const STORE = 'scenes';
const HEADERS = 'headers';
const MAX_BYTES = 64 * 1024 * 1024;
interface StoredScene<T> { slot:string; bytes:number; updatedAt:number; entry:T }

function optionalIndexedDB():IDBFactory|undefined {
  try{return globalThis.indexedDB;}catch{return undefined;}
}

/** Separate, disposable database. Domain CAS and backup data never enter here. */
export function createWorldSceneCachePort(environment: TerrainEnvironmentStyle,
  bytes: (entry:WorldSceneCache) => number,
  schedule = queueIdleWork,
  database: IDBFactory | undefined = optionalIndexedDB(),
  encode: (entry:WorldSceneCache)=>unknown = entry=>entry): WorldSceneCachePort {
  return createDerivedCachePort(environment,bytes,schedule,database,DB_NAME,MAX_BYTES,encode);
}
export function createBuildingCpuCachePort(environment:TerrainEnvironmentStyle,bytes:(entry:BuildingCpuCache)=>number,
  schedule=queueIdleWork,database:IDBFactory|undefined=optionalIndexedDB()):BuildingCpuCachePort {
  return createDerivedCachePort(environment,bytes,schedule,database,`${DB_NAME}-buildings`,32*1024*1024);
}
function createDerivedCachePort<T>(environment:string,bytes:(entry:T)=>number,schedule:typeof queueIdleWork,
  database:IDBFactory|undefined,name:string,maximum:number,encode:(entry:T)=>unknown=entry=>entry):{read():Promise<unknown>;write(entry:T):void}{
  const open = () => new Promise<IDBDatabase>((resolve,reject) => {
    if (!database) { reject(new Error('Cache storage unavailable')); return; }
    const request = database.open(name,1);
    let settled=false;
    const failed=(error:unknown)=>{if(settled)return;settled=true;clearTimeout(timeout);reject(error);};
    const timeout=setTimeout(()=>failed(new Error('Cache open timed out')),1500);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE,{keyPath:'slot'});
      request.result.createObjectStore(HEADERS,{keyPath:'slot'});
    };
    request.onsuccess = () => { if(settled){request.result.close();return;}settled=true;clearTimeout(timeout);request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => failed(request.error);
    request.onblocked = () => failed(new Error('Cache upgrade blocked'));
  });
  return {
    async read() {
      let db:IDBDatabase | undefined;
      try {
        db = await open();
        return await new Promise<unknown>((resolve,reject) => {
          const tx = db!.transaction(STORE), request = tx.objectStore(STORE).get(environment);
          const timeout=setTimeout(()=>{tx.abort();reject(new Error('Cache read timed out'));},1500);
          request.onsuccess = () => {clearTimeout(timeout);resolve(request.result?.entry ?? null);};
          request.onerror = () => {clearTimeout(timeout);reject(request.error);};
          tx.onabort = () => {clearTimeout(timeout);reject(tx.error);};
        });
      } catch { return null; }
      finally { db?.close(); }
    },
    write(entry) {
      // Retain just the latest pending layout, not four huge closures.
      schedule(`${name}:current`,async () => {
        let db:IDBDatabase | undefined;
        try {
          const size = bytes(entry);
          if (!Number.isFinite(size)||size<0||size > maximum) return;
          const encoded=encode(entry);
          db = await open();
          await new Promise<void>((resolve,reject) => {
            const tx = db!.transaction([STORE,HEADERS],'readwrite'), store = tx.objectStore(STORE), headers=tx.objectStore(HEADERS);
            // Read only small headers with a cursor; old scenes aren't cloned.
            const request = headers.openCursor();
            const existing:Array<{slot:string;bytes:number;updatedAt:number}> = [];
            request.onsuccess = () => {
              try {
              const cursor=request.result;
              if(cursor) { const value=cursor.value as StoredScene<T>; existing.push({slot:value.slot,bytes:value.bytes,updatedAt:value.updatedAt});cursor.continue();return; }
              let total=size;
              for(const value of existing.filter(item=>item.slot!==environment).sort((a,b)=>b.updatedAt-a.updatedAt)) {
                if(!Number.isFinite(value.bytes)||total+value.bytes>maximum){store.delete(value.slot);headers.delete(value.slot);}
                else total+=value.bytes;
              }
              store.put({slot:environment,bytes:size,updatedAt:Date.now(),entry:encoded} satisfies StoredScene<unknown>);
              headers.put({slot:environment,bytes:size,updatedAt:Date.now()});
              } catch(error) {tx.abort();reject(error);}
            };
            tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error);
          });
        } catch { /* Quota, private mode or cache failure never blocks the app. */ }
        finally { db?.close(); }
      });
    },
  };
}
