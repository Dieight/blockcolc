import { pushBackLayer } from './back-layer';
import { captureModeSnapshot } from './mode-snapshot';
import { t } from './i18n';

export type ModeDirection='enter'|'leave';
export const MODE_TRANSITION_MS=720;
export interface ViewportBounds {left:number;top:number;width:number;height:number}
export function modeViewport(from:ViewportBounds,to:ViewportBounds,progress:number):ViewportBounds {
  const p=Math.min(1,Math.max(0,progress)),mix=(a:number,b:number)=>a+(b-a)*p;
  return {left:mix(from.left,to.left),top:mix(from.top,to.top),width:mix(from.width,to.width),height:mix(from.height,to.height)};
}
export function modeViewportClip(rect:ViewportBounds,width:number,height:number){
  return `inset(${Math.max(0,rect.top)}px ${Math.max(0,width-rect.left-rect.width)}px ${Math.max(0,height-rect.top-rect.height)}px ${Math.max(0,rect.left)}px)`;
}

/** Reframe once behind a last-frame cover; animate the viewport, never resize WebGL per frame. */
export function createModeTransition(root:HTMLElement,commit:(minimal:boolean)=>void,onFailure:()=>void){
  let active:AbortController|null=null,disposed=false;
  async function travel(direction:ModeDirection){
    if(active||disposed||document.hidden)return;
    const requested=direction==='enter',previous=root.querySelector<HTMLElement>('.world-screen')?.dataset.minimalMode==='true';
    if(requested===previous)return;
    const owner=new AbortController();active=owner;
    const motions:Animation[]=[];
    let source:ReturnType<typeof captureModeSnapshot>|null=null,target:ReturnType<typeof captureModeSnapshot>|null=null;
    let committed=false,preparing=true;
    const inert=root.inert,initialWidth=innerWidth,initialHeight=innerHeight;
    const layer=document.createElement('div');layer.className='mode-transition';layer.dataset.direction=direction;layer.setAttribute('aria-hidden','true');
    layer.style.backgroundColor=getComputedStyle(document.body).backgroundColor;
    const pending=document.createElement('span');pending.className='mode-transition__pending';pending.textContent=t('正在准备世界…');pending.hidden=true;
    const pendingTimer=window.setTimeout(()=>{pending.hidden=false;},300);
    const phase=(value:string)=>{root.dataset.modeTransitionPhase=value;root.dataset.modePortalPhase=value;layer.dataset.phase=value;};
    const cancel=()=>owner.abort();
    const hidden=()=>{if(document.hidden)cancel();};
    const resized=()=>{if(preparing&&Math.abs(innerWidth-initialWidth)<3&&Math.abs(innerHeight-initialHeight)<100)return;cancel();};
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();cancel();}};
    const removeBack=pushBackLayer(()=>{cancel();return true;});
    const check=()=>{if(owner.signal.aborted||disposed)throw new DOMException('Cancelled','AbortError');};
    owner.signal.addEventListener('abort',()=>motions.forEach(motion=>motion.cancel()),{once:true});
    document.addEventListener('visibilitychange',hidden);window.addEventListener('resize',resized);window.addEventListener('keydown',key);
    const animate=(element:Element|null|undefined,frames:Keyframe[],options:Partial<KeyframeAnimationOptions>={})=>{
      if(!element)return;
      const motion=element.animate(frames,{duration:MODE_TRANSITION_MS,easing:'cubic-bezier(.4,0,.2,1)',fill:'both',...options});motions.push(motion);
    };
    const frameCount=()=>Number(root.querySelector<HTMLCanvasElement>('canvas[data-world-canvas]')?.dataset.renderFrameCount??0);
    const ready=(before:number)=>new Promise<void>((resolve,reject)=>{
      let raf=0,stable=0,last='',ended=false;
      const finish=(error?:Error)=>{if(ended)return;ended=true;cancelAnimationFrame(raf);clearTimeout(timer);owner.signal.removeEventListener('abort',aborted);error?reject(error):resolve();};
      const aborted=()=>finish(new DOMException('Cancelled','AbortError'));
      const timer=window.setTimeout(()=>finish(new Error('World presentation timed out')),10_000);
      const tick=()=>{const screen=root.querySelector<HTMLElement>('.world-screen'),canvas=screen?.querySelector<HTMLCanvasElement>('canvas[data-world-canvas]'),rect=canvas?.getBoundingClientRect();
        const size=`${rect?.left}:${rect?.top}:${rect?.width}:${rect?.height}:${innerWidth}:${innerHeight}`;
        const usable=screen?.dataset.worldReady==='true'&&screen.dataset.minimalMode===String(requested)&&canvas&&rect&&rect.width>0&&rect.height>0&&frameCount()>before;
        stable=usable&&last===size?stable+1:0;last=size;if(stable>=3)finish();else raf=requestAnimationFrame(tick);
      };
      owner.signal.addEventListener('abort',aborted,{once:true});raf=requestAnimationFrame(tick);
    });
    try{
      root.dataset.modePortalActive='true';root.dataset.modeTransitionActive='true';phase('preparing');root.inert=true;
      if(matchMedia('(prefers-reduced-motion: reduce)').matches||!layer.animate){commit(requested);committed=true;return;}
      try{source=captureModeSnapshot(root);}catch{commit(requested);committed=true;return;}
      const world=document.createElement('div');world.className='mode-transition__world';
      const position=(bitmap:HTMLCanvasElement,bounds:ViewportBounds)=>{Object.assign(bitmap.style,{position:'absolute',left:`${bounds.left}px`,top:`${bounds.top}px`,width:`${bounds.width}px`,height:`${bounds.height}px`});};
      position(source.bitmap,source.bounds);world.append(source.bitmap);
      world.style.clipPath=modeViewportClip(source.bounds,innerWidth,innerHeight);
      layer.append(world,source.host,pending);document.body.append(layer);
      const before=frameCount();commit(requested);committed=true;check();await ready(before);check();
      target=captureModeSnapshot(root);preparing=false;clearTimeout(pendingTimer);pending.remove();
      const from=source.bounds,to=target.bounds,dx=to.left+to.width/2-from.left-from.width/2,dy=to.top+to.height/2-from.top-from.height/2;
      position(target.bitmap,to);world.prepend(target.bitmap);layer.append(target.host);
      phase(requested?'opening':'closing');
      animate(world,[{clipPath:modeViewportClip(from,innerWidth,innerHeight)},{clipPath:modeViewportClip(to,innerWidth,innerHeight)}]);
      animate(source.bitmap,[{transform:'none'},{transform:`translate(${dx}px,${dy}px)`}]);
      animate(target.bitmap,[{transform:`translate(${-dx}px,${-dy}px)`},{transform:'none'}]);
      animate(source.bitmap,requested?[{opacity:1},{opacity:0,offset:.36},{opacity:0}]:[{opacity:1},{opacity:1,offset:.6},{opacity:0}]);
      const sourcePanel=source.panel?.element,targetPanel=target.panel?.element;
      if(requested){
        const shift=Math.max(24,to.top+to.height-from.top-from.height);
        animate(sourcePanel,[{opacity:1,transform:'none'},{opacity:0,transform:`translateY(${shift*.6}px)`,offset:.7},{opacity:0,transform:`translateY(${shift}px)`}]);
        animate(targetPanel,[{opacity:0,transform:'translateY(24px)'},{opacity:0,transform:'translateY(24px)',offset:.5},{opacity:1,transform:'none'}]);
      }else{
        const shift=Math.max(24,from.top+from.height-to.top-to.height);
        animate(sourcePanel,[{opacity:1,transform:'none'},{opacity:0,transform:'translateY(20px)',offset:.45},{opacity:0,transform:'translateY(20px)'}]);
        animate(targetPanel,[{opacity:0,transform:`translateY(${shift}px)`},{opacity:0,transform:`translateY(${shift*.55}px)`,offset:.35},{opacity:1,transform:'none'}]);
      }
      for(const part of [source.header,source.navigation,source.hud])animate(part?.element,[{opacity:1},{opacity:0,offset:.32},{opacity:0}]);
      for(const part of [target.header,target.navigation,target.hud])animate(part?.element,[{opacity:0},{opacity:0,offset:.66},{opacity:1}]);
      const seam=document.createElement('div');seam.className='mode-transition__seam';layer.append(seam);
      animate(seam,[{left:`${from.left}px`,top:`${from.top+from.height-3}px`,width:`${from.width}px`,opacity:0},{opacity:.32,offset:.5},{left:`${to.left}px`,top:`${to.top+to.height-3}px`,width:`${to.width}px`,opacity:0}]);
      await Promise.all(motions.map(motion=>motion.finished));check();
    }catch{
      if(committed&&!disposed)commit(previous);
      if(!owner.signal.aborted&&!disposed)onFailure();
    }finally{
      clearTimeout(pendingTimer);motions.forEach(motion=>motion.cancel());source?.dispose();target?.dispose();layer.remove();removeBack();
      root.inert=inert;root.dataset.modePortalActive='false';root.dataset.modeTransitionActive='false';phase('idle');
      document.removeEventListener('visibilitychange',hidden);window.removeEventListener('resize',resized);window.removeEventListener('keydown',key);
      if(active===owner)active=null;
    }
  }
  return {travel,dispose(){disposed=true;active?.abort();}};
}
