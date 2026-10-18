import type { Page } from '@playwright/test';

// Stop the next real transition at creation, rather than racing a screenshot
// against its 720 ms lifetime on software WebGL.
export async function holdModeTransition(page:Page,at=360){
  await page.evaluate(at=>{
    const original=Element.prototype.animate,motions:Animation[]=[];
    Element.prototype.animate=function(...args:Parameters<Element['animate']>){
      const motion=original.apply(this,args),tree=this.getRootNode();
      if(this.closest('.mode-transition')||(tree instanceof ShadowRoot&&tree.host.closest('.mode-transition'))){
        motion.pause();motion.currentTime=at;motions.push(motion);
      }
      return motion;
    };
    (window as any).releaseModeTransition=()=>{
      Element.prototype.animate=original;
      motions.forEach(motion=>motion.play());
      delete (window as any).releaseModeTransition;
    };
  },at);
}

export async function releaseModeTransition(page:Page){
  await page.evaluate(()=>(window as any).releaseModeTransition());
}
