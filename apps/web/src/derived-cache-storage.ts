/** The derived cache never opens the authoritative domain/backup database. */
export const DERIVED_CACHE_DB='blockcolc-derived-world-scene';
export const SCENE_CACHE_BUDGET=64*1024*1024;
export const BUILDING_CACHE_BUDGET=32*1024*1024;
const STORE='scenes',HEADERS='headers';

export function optionalIndexedDB():IDBFactory|undefined {
  try{return globalThis.indexedDB;}catch{return undefined;}
}

export function createDerivedCacheStorage(environment:string,database:IDBFactory|undefined,name:string,maximum:number){
  const open=()=>new Promise<IDBDatabase>((resolve,reject)=>{
    if(!database){reject(new Error('Cache storage unavailable'));return;}
    const request=database.open(name,1);let settled=false;
    const failed=(error:unknown)=>{if(settled)return;settled=true;clearTimeout(timeout);reject(error);};
    const timeout=setTimeout(()=>failed(new Error('Cache open timed out')),1500);
    request.onupgradeneeded=()=>{
      request.result.createObjectStore(STORE,{keyPath:'slot'});
      request.result.createObjectStore(HEADERS,{keyPath:'slot'});
    };
    request.onsuccess=()=>{
      if(settled){request.result.close();return;}
      settled=true;clearTimeout(timeout);request.result.onversionchange=()=>request.result.close();resolve(request.result);
    };
    request.onerror=()=>failed(request.error);request.onblocked=()=>failed(new Error('Cache upgrade blocked'));
  });
  return {
    async read():Promise<unknown>{
      let db:IDBDatabase|undefined;
      try{
        db=await open();
        return await new Promise<unknown>((resolve,reject)=>{
          const tx=db!.transaction(STORE),request=tx.objectStore(STORE).get(environment);
          const timeout=setTimeout(()=>{tx.abort();reject(new Error('Cache read timed out'));},1500);
          request.onsuccess=()=>{clearTimeout(timeout);resolve(request.result?.entry??null);};
          request.onerror=()=>{clearTimeout(timeout);reject(request.error);};
          tx.onabort=()=>{clearTimeout(timeout);reject(tx.error);};
        });
      }catch{return null;}finally{db?.close();}
    },
    async write(entry:unknown,size:number):Promise<void>{
      if(!Number.isFinite(size)||size<0||size>maximum)return;
      let db:IDBDatabase|undefined;
      try{
        db=await open();
        await new Promise<void>((resolve,reject)=>{
          const tx=db!.transaction([STORE,HEADERS],'readwrite'),store=tx.objectStore(STORE),headers=tx.objectStore(HEADERS);
          const request=headers.openCursor(),existing:Array<{slot:string;bytes:number;updatedAt:number}>=[];
          request.onsuccess=()=>{
            try{
              const cursor=request.result;
              if(cursor){const value=cursor.value;existing.push({slot:value.slot,bytes:value.bytes,updatedAt:value.updatedAt});cursor.continue();return;}
              let total=size;
              for(const value of existing.filter(item=>item.slot!==environment).sort((a,b)=>b.updatedAt-a.updatedAt)){
                if(!Number.isFinite(value.bytes)||total+value.bytes>maximum){store.delete(value.slot);headers.delete(value.slot);}
                else total+=value.bytes;
              }
              const updatedAt=Date.now();store.put({slot:environment,bytes:size,updatedAt,entry});headers.put({slot:environment,bytes:size,updatedAt});
            }catch(error){tx.abort();reject(error);}
          };
          tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error);
        });
      }catch{/* Optional derived data: quota or storage failure is a cache miss. */}finally{db?.close();}
    },
  };
}
