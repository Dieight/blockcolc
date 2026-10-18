import {useEffect,useRef,useState,type ReactNode} from 'react';
export function Reveal({open,children,overflowVisible=false}:{open:boolean;children:ReactNode;overflowVisible?:boolean}){
  const [settled,setSettled]=useState(open),owner=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!overflowVisible)return;
    setSettled(false);
    if(!open)return;
    const delay=matchMedia('(prefers-reduced-motion: reduce)').matches?0:300;
    const timer=window.setTimeout(()=>setSettled(true),delay);
    return()=>window.clearTimeout(timer);
  },[open,overflowVisible]);
  return <div ref={owner} className={`content-reveal${open?' is-open':''}`} data-overflow={overflowVisible&&open&&settled?'visible':undefined} inert={!open} aria-hidden={!open}
    onTransitionEnd={event=>{if(overflowVisible&&event.target===owner.current&&event.propertyName==='grid-template-rows'&&open)setSettled(true);}}><div>{children}</div></div>;
}
