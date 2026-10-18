export type DerivedCacheKind='scene'|'building';
export interface DerivedCacheRequest {id:number;kind:DerivedCacheKind;environment:string;operation:'read'|'write';entry?:unknown}
export interface DerivedCacheResponse {id:number;ok:boolean;value?:unknown}

/** Only the worker's newly read buffers may be transferred. Never call this
 * on a live renderer recipe when sending a write: that would detach its mesh. */
export function derivedCacheTransferBuffers(value:unknown):ArrayBuffer[]{
  const buffers=new Set<ArrayBuffer>(),visited=new WeakSet<object>();
  const walk=(item:unknown):void=>{
    if(item===null||typeof item!=='object'||visited.has(item))return;visited.add(item);
    if(ArrayBuffer.isView(item)){if(item.buffer instanceof ArrayBuffer)buffers.add(item.buffer);return;}
    if(item instanceof ArrayBuffer){buffers.add(item);return;}
    if(item instanceof Map){for(const [key,entry]of item){walk(key);walk(entry);}return;}
    for(const entry of Object.values(item))walk(entry);
  };
  walk(value);return [...buffers];
}
