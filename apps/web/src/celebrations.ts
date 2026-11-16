import type { DomainEvent } from '@blockcolc/domain';

export type CelebrationKind = 'building' | 'birthday' | 'goal' | 'preview' | 'goal-preview';
export const CELEBRATION_DURATION_MS=3400;
export interface PixelConfettiParticle {x:number;y:number;width:number;height:number;turn:number;color:number}

/** Analytic motion: no accumulating integration error, timers or mutable particles. */
export function pixelConfettiFrame(elapsedMs:number,width:number,height:number):PixelConfettiParticle[]{
  if(elapsedMs<0||elapsedMs>CELEBRATION_DURATION_MS||width<=0||height<=0)return [];
  const result:PixelConfettiParticle[]=[];
  for(let i=0;i<112;i++){
    const delay=(i%7)*.027,t=elapsedMs/1000-delay;if(t<0)continue;
    const side=i%2===0?1:-1,seed=((i*16807+17389)%65521)/65521;
    const speed=width*(.18+seed*.26),flight=height*(.58+((i*31)%83)/160);
    const x=width*(side===1?.07:.93)+side*speed*t+Math.sin(t*3+i)*t*11;
    const y=height*.78-flight*t+height*.43*t*t;
    if(y>height+20||x< -20||x>width+20)continue;
    result.push({x:Math.round(x),y:Math.round(y),width:4+(i%3)*2,height:Math.max(2,Math.round((5+i%4)*Math.abs(Math.cos(t*5+i)))),turn:Math.floor(t*(2+i%3)+i)%4,color:i%6});
  }
  return result;
}
export function celebrationEvents(events:readonly DomainEvent[]):CelebrationKind|null{
  if(events.some(event=>event.type==='BirthdayRewardGranted'))return'birthday';
  if(events.some(event=>event.type==='ProjectSealedAsMonument'||event.type==='HabitBuildingCompleted'))return'building';
  return events.some(event=>event.type==='DailyGoalReached')?'goal':null;
}
/** A smaller, overhead shower; distinct from the two-sided building burst. */
export function goalConfettiFrame(elapsedMs:number,width:number,height:number):PixelConfettiParticle[]{
  if(elapsedMs<0||elapsedMs>CELEBRATION_DURATION_MS||width<=0||height<=0)return[];
  const result:PixelConfettiParticle[]=[];
  for(let i=0;i<84;i++){
    const delay=Math.floor(i/28)*.28,t=elapsedMs/1000-delay;if(t<0)continue;
    const seed=((i*16807+17389)%65521)/65521;
    const x=width*.5+(seed-.5)*width*.76*t+Math.sin(t*3+i)*7*t;
    const y=height*.15-height*(.15+seed*.11)*t+height*.31*t*t;
    if(y>height+12||x< -12||x>width+12)continue;
    result.push({x:Math.round(x),y:Math.round(y),width:4+(i%2)*2,height:2+2*Math.round(Math.abs(Math.cos(t*6+i))),turn:Math.floor(t*3+i)%4,color:i%3===0?0:i%3===1?1:5});
  }return result;
}
export const CELEBRATION_PREVIEW_EVENT='blockcolc-celebration-preview';
export function previewCelebration(goal=false):void{window.dispatchEvent(new CustomEvent(CELEBRATION_PREVIEW_EVENT,{detail:goal?'goal-preview':'preview'}));}
