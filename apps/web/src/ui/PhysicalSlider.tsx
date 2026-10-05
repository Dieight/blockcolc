import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { sliderBounceOffset, sliderFlight, sliderFlightPosition, sliderValueAt, sliderLandingValueAt, sliderFirstBounceDuration, type SliderFlight } from './physical-slider';

export function PhysicalSlider({label,value,min=0,max=100,step=5,onChange,onPreviewChange}:{label:string;value:number;min?:number;max?:number;step?:number;onChange:(value:number)=>void;onPreviewChange?:(value:number|null)=>void}) {
  const rail=useRef<HTMLDivElement>(null),frame=useRef(0),flightRef=useRef<SliderFlight|null>(null);
  const input=useRef<HTMLInputElement>(null),valueRef=useRef(value),callback=useRef(onChange),previewCallback=useRef(onPreviewChange),announced=useRef<number|null>(null);
  valueRef.current=value;callback.current=onChange;previewCallback.current=onPreviewChange;
  const drag=useRef<{id:number;x:number;y:number;origin:number;width:number;pullX:number;pullY:number;vertical:boolean}|null>(null);
  const [pose,setPose]=useState<{x:number;y:number}|null>(null),[preview,setPreview]=useState<SliderFlight|null>(null);
  const announce=(next:number|null)=>{if(next!==announced.current){announced.current=next;previewCallback.current?.(next);}};
  useEffect(()=>()=>{cancelAnimationFrame(frame.current);previewCallback.current?.(null);},[]);
  const clear=()=>{cancelAnimationFrame(frame.current);flightRef.current=null;setPose(null);setPreview(null);announce(null);};
  const commit=(x:number,width:number)=>callback.current(sliderValueAt(x,width,min,max,step));
  const begin=(event:React.PointerEvent<HTMLDivElement>)=>{
    if(!event.isPrimary||event.button!==0||drag.current)return;
    clear();event.preventDefault();event.stopPropagation();
    const bounds=rail.current!.getBoundingClientRect(),width=bounds.width;
    const origin=(valueRef.current-min)/(max-min)*width;
    const ball=Math.abs(event.clientX-bounds.left-origin)<22;
    // Tapping the rail is an ordinary adjustment, not a launch from a distant ball.
    const x=ball?origin:Math.max(0,Math.min(width,event.clientX-bounds.left));
    if(!ball)commit(x,width);
    drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,origin:x,width,pullX:0,pullY:0,vertical:false};
    setPose({x,y:0});event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move=(event:React.PointerEvent<HTMLDivElement>)=>{
    const d=drag.current;if(!d||d.id!==event.pointerId)return;
    event.preventDefault();event.stopPropagation();d.pullX=event.clientX-d.x;d.pullY=Math.max(-110,Math.min(110,event.clientY-d.y));
    if(Math.abs(d.pullY)>14)d.vertical=true;
    if(d.vertical){d.pullX=Math.max(-160,Math.min(160,d.pullX));setPose({x:Math.max(0,Math.min(d.width,d.origin+d.pullX)),y:d.pullY});const f=sliderFlight(d.origin,d.pullX,d.pullY,d.width);setPreview(f);announce(sliderLandingValueAt(f.landing,d.width,min,max,step,f.vx));}
    else {const x=Math.max(0,Math.min(d.width,d.origin+d.pullX));setPose({x,y:0});commit(x,d.width);}
  };
  const release=(event:React.PointerEvent<HTMLDivElement>)=>{
    const d=drag.current;if(!d||d.id!==event.pointerId)return;
    drag.current=null;event.stopPropagation();event.currentTarget.releasePointerCapture(event.pointerId);
    if(!d.vertical){clear();return;}
    const f=sliderFlight(d.origin,d.pullX,d.pullY,d.width);setPreview(null);announce(null);flightRef.current=f;
    const landingValue=sliderLandingValueAt(f.landing,d.width,min,max,step,f.vx);
    const alignedX=(landingValue-min)/(max-min)*d.width;
    const impact=f.vy+f.gravity*f.duration,bounceDuration=sliderFirstBounceDuration(impact);
    if(matchMedia('(prefers-reduced-motion: reduce)').matches){callback.current(landingValue);clear();return;}
    const start=performance.now();let landed=false;
    const tick=(now:number)=>{
      if(flightRef.current!==f)return;
      const elapsed=(now-start)/1000;
      if(elapsed<f.duration)setPose(sliderFlightPosition(f,elapsed));
      else {
        const bounceTime=elapsed-f.duration,alignment=Math.min(1,bounceTime/Math.max(.001,bounceDuration));
        setPose({x:f.landing+(alignedX-f.landing)*alignment,y:sliderBounceOffset(bounceTime,impact)});
        if(!landed&&alignment===1){callback.current(landingValue);landed=true;}
      }
      if(elapsed<f.duration+bounceDuration*1.5)frame.current=requestAnimationFrame(tick);else {if(!landed)callback.current(landingValue);clear();}
    };frame.current=requestAnimationFrame(tick);
  };
  const predicted=preview?sliderLandingValueAt(preview.landing,rail.current?.clientWidth??1,min,max,step,preview.vx):null;
  const pendingFlight=preview??flightRef.current;
  const displayedValue=pendingFlight?sliderLandingValueAt(pendingFlight.landing,rail.current?.clientWidth??1,min,max,step,pendingFlight.vx):value;
  const predictedX=predicted===null?0:(predicted-min)/(max-min)*(rail.current?.clientWidth??1);
  const path=preview?Array.from({length:25},(_,i)=>sliderFlightPosition(preview,preview.duration*i/24)):[];
  return <div className="physical-slider" data-flight={flightRef.current?'flying':preview?'aiming':'idle'}
    onPointerDown={begin} onPointerMove={move} onPointerUp={release}
    onPointerCancel={()=>{drag.current=null;clear();}} onLostPointerCapture={()=>{if(drag.current){drag.current=null;clear();}}}>
    <input ref={input} className="sr-only" aria-label={label} type="range" min={min} max={max} step={step} value={value}
      aria-valuetext={`${predicted??value}%${predicted===null?'':'，预计落点'}`} onChange={event=>{clear();onChange(Number(event.target.value));}}/>
    <div ref={rail} className="physical-slider-rail" style={{'--range-progress':`${(displayedValue-min)/(max-min)*100}%`} as CSSProperties}>
      <span className="physical-slider-progress" aria-hidden="true"/>
      <i className="physical-slider-ball" aria-hidden="true" style={pose?{left:pose.x,transform:`translate(-50%,${pose.y}px)`}:{left:`${(value-min)/(max-min)*100}%`}}/>
      {preview&&<><svg className="physical-slider-arc" aria-hidden="true"><path d={path.map((point,i)=>`${i?'L':'M'}${point.x},${point.y+180}`).join(' ')}/></svg><i className="physical-slider-ball is-predicted" aria-hidden="true" style={{left:predictedX}}/>{!onPreviewChange&&<output className="physical-slider-preview">预计 {predicted}%</output>}</>}
    </div>
  </div>;
}
