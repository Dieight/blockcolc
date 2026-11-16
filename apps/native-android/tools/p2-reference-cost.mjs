/** Instrument the real repository, never substitute its persistence or validation. */
export function observeP2Repository(repository,current,clock){
  const cached=new Map();
  return new Proxy(repository,{get(target,key){
    const value=Reflect.get(target,key);if(typeof value!=='function')return value;
    if(!cached.has(key))cached.set(key,async(...args)=>{
      const cost=current();if(!cost||!['save','load','loadIfChanged','replacementRevision'].includes(key))return value.apply(target,args);
      const span={name:'repository-'+key,beginNs:clock(),ok:false};cost.spans.push(span);
      try{
        const result=await value.apply(target,args);span.ok=true;
        if(key==='save')cost.marks.repositorySaveAcknowledgedNs=clock();
        return result;
      }finally{span.endNs=clock();}
    });
    return cached.get(key);
  }});
}

/** A complete event is an engine acknowledgement, not proof of equal fsync policy. */
export function observeP2Transactions(prototype,current,clock){
  const original=prototype.transaction;
  prototype.transaction=function(...args){
    const cost=current(),beginNs=cost?clock():null;
    const tx=original.apply(this,args);
    if(cost){
      const stores=Array.from(tx.objectStoreNames),mode=tx.mode;
      const row={beginNs,mode,stores,facts:mode==='readwrite'&&stores.includes('appState')};cost.transactions.push(row);
      for(const [event,ok]of [['complete',true],['abort',false]])tx.addEventListener(event,()=>{row.endNs=clock();row.ok=ok;},{once:true});
    }
    return tx;
  };
  return ()=>{prototype.transaction=original;};
}
