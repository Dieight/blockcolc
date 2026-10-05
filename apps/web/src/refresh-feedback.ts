/** Keep a fast refresh indicator readable, without clearing the displayed value. */
export function finishRefreshFeedback(started:number):Promise<void> {
  const remaining=Math.max(0,300-(performance.now()-started));
  return remaining ? new Promise(resolve=>setTimeout(resolve,remaining)) : Promise.resolve();
}

/** Paint the pending state before work that can occupy the main thread. */
export function paintPendingFeedback():Promise<void> {
  return new Promise(resolve => {
    if (document.hidden) { setTimeout(resolve, 0); return; }
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}
