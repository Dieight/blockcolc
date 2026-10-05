/** A saved setting is not a prepared scene. Only the current renderer generation
 * may acknowledge its target; late generations cannot end a newer loading page. */
export function createScenePreparation<T>(changed:(target:T|null)=>void, timeoutMs=120_000) {
  let pending:{target:T;resolve:()=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}|null=null;
  const finish=(error?:Error)=>{
    const owner=pending;if(!owner)return;
    pending=null;clearTimeout(owner.timer);changed(null);
    if(error)owner.reject(error);else owner.resolve();
  };
  return {
    begin(target:T) {
      finish(new Error('Scene preparation superseded'));
      const prepared=new Promise<void>((resolve,reject)=>{
        pending={target,resolve,reject,timer:setTimeout(()=>finish(new Error('世界准备超时，请回到计时页重试。')),timeoutMs)};
      });
      // A command can still be saving when the renderer reports a failure.
      void prepared.catch(()=>undefined);changed(target);return prepared;
    },
    ready(target:T) {if(pending?.target===target)finish();},
    failed(target:T) {if(pending?.target===target)finish(new Error('世界准备未完成，请回到计时页重试。'));},
    cancel() {finish(new Error('Scene preparation cancelled'));},
  };
}
