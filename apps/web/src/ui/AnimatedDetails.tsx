import { useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { Reveal } from './Reveal';

/** Keep native disclosure semantics, but let the shared reveal finish closing. */
export function AnimatedDetails({summary,summaryProps,defaultOpen=false,overflowVisible=false,children,...props}:
  Omit<ComponentPropsWithoutRef<'details'>,'open'|'onToggle'|'children'> & {
    summary:ReactNode; summaryProps?:ComponentPropsWithoutRef<'summary'>; defaultOpen?:boolean;
    overflowVisible?:boolean; children:ReactNode;
  }){
  const [expanded,setExpanded]=useState(defaultOpen),[visible,setVisible]=useState(defaultOpen),[revealed,setRevealed]=useState(defaultOpen);
  const body=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    if(expanded===visible&&expanded===revealed)return;
    if(matchMedia('(prefers-reduced-motion: reduce)').matches){setVisible(expanded);setRevealed(expanded);return;}
    let first=0,timer=0;
    if(expanded){
      setVisible(true);
      // Establish the collapsed layout once, without a second idle frame.
      first=requestAnimationFrame(()=>{body.current?.getBoundingClientRect();setRevealed(true);});
    }else{
      setRevealed(false);
      timer=window.setTimeout(()=>setVisible(false),280);
    }
    return()=>{cancelAnimationFrame(first);clearTimeout(timer);};
  },[expanded]);
  return <details {...props} open={visible} data-animated-details data-expanded={expanded}>
    <summary {...summaryProps} aria-expanded={expanded} onClick={event=>{
      summaryProps?.onClick?.(event);if(event.defaultPrevented)return;
      event.preventDefault();
      if(expanded&&body.current?.contains(document.activeElement))event.currentTarget.focus({preventScroll:true});
      setExpanded(value=>!value);
    }}>{summary}</summary>
    <Reveal open={revealed} overflowVisible={overflowVisible}><div ref={body} className="disclosure-body">{children}</div></Reveal>
  </details>;
}
