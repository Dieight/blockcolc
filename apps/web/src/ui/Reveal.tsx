import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
export function Reveal({open,children,overflowVisible=false,motion='grid'}:{open:boolean;children:ReactNode;overflowVisible?:boolean;motion?:'grid'|'measured'}){
  const [settled,setSettled]=useState(open),owner=useRef<HTMLDivElement>(null);
  const initialOpen=useRef(open),previousOpen=useRef(open),animation=useRef<Animation|null>(null);
  useLayoutEffect(()=>{
    if(motion!=='measured'||!owner.current||previousOpen.current===open)return;
    previousOpen.current=open;
    const element=owner.current;
    // Read each endpoint once. Animating fr tracks re-resolves every row's
    // intrinsic size on every frame, which is costly in long task catalogs.
    const from=element.getBoundingClientRect().height;
    animation.current?.cancel();
    const to=open?element.firstElementChild!.getBoundingClientRect().height:0;
    element.style.height=open?'auto':'0px';
    if(matchMedia('(prefers-reduced-motion: reduce)').matches||typeof element.animate!=='function')return;
    const current=element.animate([{height:`${from}px`},{height:`${to}px`}],{duration:220,easing:'cubic-bezier(.2,.75,.25,1)'});
    animation.current=current;
    current.onfinish=()=>{current.cancel();if(animation.current===current)animation.current=null;};
  },[open,motion]);
  useEffect(()=>()=>animation.current?.cancel(),[]);
  useEffect(()=>{
    if(!overflowVisible)return;
    setSettled(false);
    if(!open)return;
    const delay=matchMedia('(prefers-reduced-motion: reduce)').matches?0:300;
    const timer=window.setTimeout(()=>setSettled(true),delay);
    return()=>window.clearTimeout(timer);
  },[open,overflowVisible]);
  return <div ref={owner} className={`content-reveal${open?' is-open':''}`} data-motion={motion==='measured'?'measured':undefined} style={motion==='measured'?{height:initialOpen.current?'auto':0}:undefined} data-overflow={overflowVisible&&open&&settled?'visible':undefined} inert={!open} aria-hidden={!open}
    onTransitionEnd={event=>{if(overflowVisible&&event.target===owner.current&&event.propertyName==='grid-template-rows'&&open)setSettled(true);}}><div>{children}</div></div>;
}
