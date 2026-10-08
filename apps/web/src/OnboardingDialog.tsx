import {useEffect,useRef,useState} from 'react';
import {useBackLayer} from './back-layer';
import {PixelClose,PixelIcon} from './ui/PixelIcon';
import {TUTORIAL_PAGES} from './onboarding';

export function OnboardingDialog({onClose}:{onClose:()=>void}){
  const [step,setStep]=useState(0),sheet=useRef<HTMLElement>(null),heading=useRef<HTMLHeadingElement>(null);
  const page=TUTORIAL_PAGES[step]!;
  useBackLayer(true,()=>{onClose();return true;});
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();onClose();return;}
      if(event.key!=='Tab')return;
      const items=[...(sheet.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])')??[])];
      const first=items[0],last=items.at(-1);
      if(!first||!last)return;
      if(!sheet.current?.contains(document.activeElement)){event.preventDefault();first.focus();}
      else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    window.addEventListener('keydown',key);
    return()=>{window.removeEventListener('keydown',key);if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[onClose]);
  useEffect(()=>{heading.current?.focus({preventScroll:true});sheet.current?.scrollTo(0,0);},[step]);
  return <div className="dialog-backdrop edge-sheet-backdrop tutorial-backdrop"><section ref={sheet} className="confirm-dialog tutorial-sheet" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
    <header><span>新手教程 · {step+1} / {TUTORIAL_PAGES.length}</span><button type="button" aria-label="关闭新手教程" onClick={onClose}><PixelClose size={20}/></button></header>
    <div className="tutorial-heading"><PixelIcon name={page.icon} size={36}/><h2 id="tutorial-title" ref={heading} tabIndex={-1}>{page.title}</h2></div>
    <dl className="tutorial-features">{page.lines.map(([title,text],index)=><div key={title}><dt><span className="tutorial-feature-index" aria-hidden="true">{String(index+1).padStart(2,'0')}</span>{title}</dt><dd>{text}</dd></div>)}</dl>
    <footer><button type="button" disabled={step===0} onClick={()=>setStep(step-1)}>上一页</button><button type="button" className="primary" onClick={()=>step===TUTORIAL_PAGES.length-1?onClose():setStep(step+1)}>{step===TUTORIAL_PAGES.length-1?'开始使用':'下一页'}</button></footer>
  </section></div>;
}
