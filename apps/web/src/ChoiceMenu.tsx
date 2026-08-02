import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface ChoiceOption { id:string; label:string; detail?:string }

export function ChoiceMenu({label,value,options,disabled,onChange}:{label:string;value:string;options:readonly ChoiceOption[];disabled?:boolean;onChange:(id:string)=>void}) {
  const [open,setOpen]=useState(false); const root=useRef<HTMLDivElement>(null); const listId=useId();
  const selected=options.find(option=>option.id===value)??options[0];
  useEffect(()=>{const close=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape);};},[]);
  return <div className="choice-menu" ref={root}><span className="choice-menu-label">{label}</span><button type="button" className="choice-menu-trigger" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} disabled={disabled||options.length===0} onClick={()=>setOpen(value=>!value)}><span><strong>{selected?.label??'没有可选项'}</strong>{selected?.detail&&<small>{selected.detail}</small>}</span><ChevronDown aria-hidden="true"/></button>{open&&<div id={listId} className="choice-menu-options" role="listbox" aria-label={label}>{options.map(option=><button key={option.id} type="button" role="option" aria-selected={option.id===value} onClick={()=>{onChange(option.id);setOpen(false);}}><span><strong>{option.label}</strong>{option.detail&&<small>{option.detail}</small>}</span>{option.id===value&&<Check aria-hidden="true"/>}</button>)}</div>}</div>;
}
