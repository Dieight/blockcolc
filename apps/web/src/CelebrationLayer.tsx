import {useEffect,useRef,useState} from 'react';
import type {ApplicationService} from '@blockcolc/application';
import {birthdayOnDate,localDateOf} from '@blockcolc/domain';
import {t} from './i18n';
import {CELEBRATION_DURATION_MS,CELEBRATION_PREVIEW_EVENT,celebrationEvents,pixelConfettiFrame,goalConfettiFrame,type CelebrationKind} from './celebrations';
import './styles/celebrations.css';

const COLORS=['#e3ad42','#4c9873','#cc6257','#73b2c8','#b98acb','#eee4c4'];
export function CelebrationLayer({service,refresh}:{service:ApplicationService;refresh:()=>void}){
  const [burst,setBurst]=useState<{kind:CelebrationKind;serial:number}|null>(null);
  const counter=useRef(0),canvas=useRef<HTMLCanvasElement>(null),pending=useRef<CelebrationKind[]>([]),active=useRef(false),seenGoals=useRef(new Set<string>());
  useEffect(()=>{
    let disposed=false,checking=false;
    const unsubscribe=service.subscribeEvents(events=>{
      const kind=celebrationEvents(events);if(kind&&kind!=='goal')pending.current.push(kind);
      for(const event of events)if(event.type==='DailyGoalReached'&&!seenGoals.current.has(event.date)){
        seenGoals.current.add(event.date);pending.current.push('goal');
      }
    });
    const preview=(event:Event)=>{if(!pending.current.some(kind=>kind==='preview'||kind==='goal-preview'))pending.current.push((event as CustomEvent).detail==='goal-preview'?'goal-preview':'preview');};window.addEventListener(CELEBRATION_PREVIEW_EVENT,preview);
    const check=async()=>{
      if(disposed||document.hidden||checking)return;
      checking=true;
      try{
        const state=service.snapshot(),date=localDateOf(new Date(),state.calendar.timeZone);
        if(birthdayOnDate(state.birthday,date)&&!state.birthdayRewards.some(reward=>reward.year===Number(date.slice(0,4)))){
          const result=await service.dispatch({type:'ObserveBirthday'});if(result.ok)refresh();
        }
      }catch{/* A failed save grants nothing; a later visible check can retry. */}finally{checking=false;}
      if(disposed)return;
      // Do not spend the birthday burst behind startup or an off-screen world.
      const ready=document.querySelector('.world-screen[data-world-ready="true"]');
      if(pending.current.length&&ready&&!document.hidden&&!active.current){active.current=true;setBurst({kind:pending.current.shift()!,serial:++counter.current});}
    };
    void check();const timer=window.setInterval(()=>void check(),1000);
    const visible=()=>{if(document.hidden){active.current=false;setBurst(null);}else void check();};
    document.addEventListener('visibilitychange',visible);
    return()=>{disposed=true;clearInterval(timer);unsubscribe();window.removeEventListener(CELEBRATION_PREVIEW_EVENT,preview);document.removeEventListener('visibilitychange',visible);};
  },[service,refresh]);
  useEffect(()=>{
    if(!burst)return;
    const media=matchMedia('(prefers-reduced-motion: reduce)');
    let frame=0,started:number|undefined;
    const finish=()=>{active.current=false;setBurst(current=>current?.serial===burst.serial?null:current);};
    const timeout=media.matches?window.setTimeout(finish,1200):undefined;
    if(!media.matches){
      const draw=(now:number)=>{
        started??=now;
        const target=canvas.current;if(!target||document.hidden)return;
        const width=innerWidth,height=innerHeight,ratio=Math.min(2,devicePixelRatio||1);
        if(target.width!==Math.round(width*ratio)||target.height!==Math.round(height*ratio)){target.width=Math.round(width*ratio);target.height=Math.round(height*ratio);}
        const context=target.getContext('2d');if(!context)return;
        context.setTransform(ratio,0,0,ratio,0,0);context.clearRect(0,0,width,height);
        const particles=(burst.kind==='goal'||burst.kind==='goal-preview'?goalConfettiFrame:pixelConfettiFrame)(now-started,width,height);
        for(const particle of particles){
          context.fillStyle=COLORS[particle.color]!;
          context.fillRect(particle.x,particle.y,particle.turn%2?particle.height:particle.width,particle.turn%2?particle.width:particle.height);
        }
        if(now-started<CELEBRATION_DURATION_MS)frame=requestAnimationFrame(draw);else finish();
      };frame=requestAnimationFrame(draw);
    }
    return()=>{cancelAnimationFrame(frame);clearTimeout(timeout);};
  },[burst]);
  return burst?<div className="celebration-layer" data-celebration={burst.kind} key={burst.serial}><canvas ref={canvas} aria-hidden="true"/><span className="celebration-announcement" role="status">{t(burst.kind==='birthday'?'生日快乐！小蛋糕已送到聚落。':burst.kind==='building'?'建筑落成！':burst.kind==='goal'?'今日目标达成！':'彩纸预览')}</span></div>:null;
}
