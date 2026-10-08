export type GpuPreparationResult='complete'|'unsupported'|'cancelled'|'timeout'|'failed';
/** Queue completion, not gl.finish(): keep the loader animating while uploads finish. */
export async function waitForGpuCompletion(context:WebGLRenderingContext|WebGL2RenderingContext,
  current:()=>boolean,wait:()=>Promise<void>=()=>new Promise(resolve=>setTimeout(resolve,16)),
  now:()=>number=()=>performance.now(),timeoutMs=3000):Promise<GpuPreparationResult>{
  const gl=context as WebGL2RenderingContext;
  if(typeof gl.fenceSync!=='function')return 'unsupported';
  if(!current())return 'cancelled';
  const sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);
  if(!sync)return 'failed';
  const deadline=now()+timeoutMs;
  try{
    gl.flush();
    while(current()){
      const result=gl.clientWaitSync(sync,0,0);
      if(result===gl.ALREADY_SIGNALED||result===gl.CONDITION_SATISFIED)return 'complete';
      if(result===gl.WAIT_FAILED)return 'failed';
      if(now()>=deadline)return 'timeout';
      await wait();
    }
    return 'cancelled';
  }finally{gl.deleteSync(sync);}
}
