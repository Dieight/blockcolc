export interface SliderFlight { origin: number; startY: number; vx: number; vy: number; gravity: number; duration: number; landing: number }
export const SLIDER_GRAVITY = 1800;
const clamp = (value:number,min:number,max:number) => Math.max(min,Math.min(max,value));
export function sliderValueAt(x:number,width:number,min:number,max:number,step:number):number {
  const value = min + clamp(x / Math.max(1,width),0,1) * (max-min);
  return clamp(min + Math.round((value-min)/step)*step,min,max);
}
/** Align during the first rebound, never against the flight's direction. */
export function sliderLandingValueAt(x:number,width:number,min:number,max:number,step:number,direction:number):number {
  const steps=clamp(x/Math.max(1,width),0,1)*(max-min)/step;
  const index=direction>0?Math.ceil(steps-1e-8):direction<0?Math.floor(steps+1e-8):Math.round(steps);
  return clamp(min+index*step,min,max);
}
/** Below the rail is a pulled sling; above it is a thrown ball with reversed velocity. */
export function sliderFlight(origin:number,pullX:number,pullY:number,width:number):SliderFlight {
  const polarity=pullY<0?1:-1;
  const vy = polarity*clamp(Math.sqrt(2*SLIDER_GRAVITY*Math.abs(pullY))+Math.abs(pullY)*4.8,110,1000);
  const duration = (-vy+Math.sqrt(vy*vy-2*SLIDER_GRAVITY*pullY))/SLIDER_GRAVITY;
  const startX=clamp(origin+pullX,0,width);
  const landing = clamp(startX+polarity*clamp(pullX*6,-1200,1200)*duration,0,width);
  return {origin:startX,startY:pullY,vx:(landing-startX)/duration,vy,gravity:SLIDER_GRAVITY,duration,landing};
}
/** Analytical path: independent of display refresh rate or a long frame. */
export function sliderFlightPosition(flight:SliderFlight,seconds:number) {
  const t=clamp(seconds,0,flight.duration);
  return {x:flight.origin+flight.vx*t,y:flight.startY+flight.vy*t+.5*flight.gravity*t*t};
}
export function sliderBounceOffset(seconds:number,impactSpeed:number):number {
  let speed=sliderReboundSpeed(impactSpeed),t=Math.max(0,seconds);
  for(let bounce=0;bounce<3;bounce++) {
    const duration=2*speed/SLIDER_GRAVITY;
    if(t<duration)return -speed*t+.5*SLIDER_GRAVITY*t*t;
    t-=duration;speed*=.34;
  }
  return 0;
}
export function sliderReboundSpeed(impactSpeed:number):number {return Math.min(380,Math.abs(impactSpeed)*.48);}
export function sliderFirstBounceDuration(impactSpeed:number):number {return 2*sliderReboundSpeed(impactSpeed)/SLIDER_GRAVITY;}
