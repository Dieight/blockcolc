import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { sliderBounceOffset, sliderFlight, sliderFlightPosition, sliderValueAt, sliderLandingValueAt, sliderFirstBounceDuration, type SliderFlight } from './physical-slider';

interface PhysicalSliderProps {
  label: string; value: number; min?: number; max?: number; step?: number;
  id?: string; unit?: string; disabled?: boolean; commitOnRelease?: boolean;
  onChange: (value: number) => void;
  onPreviewChange?: (value: number | null) => void;
}

/** Ball and rail preview are transient. Persisted values always come from the owner. */
export function PhysicalSlider({ label, value, min = 0, max = 100, step = 5, id, unit = '%',
  disabled = false, commitOnRelease = false, onChange, onPreviewChange }: PhysicalSliderProps) {
  const rail = useRef<HTMLDivElement>(null), frame = useRef(0), flightRef = useRef<SliderFlight | null>(null);
  const widthRef = useRef(1), valueRef = useRef(value), callback = useRef(onChange);
  const previewCallback = useRef(onPreviewChange), announced = useRef<number | null>(null);
  valueRef.current = value; callback.current = onChange; previewCallback.current = onPreviewChange;
  const drag = useRef<{ id: number; x: number; y: number; origin: number; width: number; pullX: number; pullY: number; vertical: boolean } | null>(null);
  const [pose, setPose] = useState<{ x: number; y: number } | null>(null);
  const [preview, setPreview] = useState<SliderFlight | null>(null), [directPreview, setDirectPreview] = useState<number | null>(null);
  const announce = (next: number | null) => {
    if (next !== announced.current) { announced.current = next; previewCallback.current?.(next); }
  };
  const clear = () => {
    cancelAnimationFrame(frame.current); flightRef.current = null;
    setPose(null); setPreview(null); setDirectPreview(null); announce(null);
  };
  useEffect(() => () => { cancelAnimationFrame(frame.current); previewCallback.current?.(null); }, []);
  useEffect(() => {
    const cancel = () => { if (document.hidden) { drag.current = null; clear(); } };
    document.addEventListener('visibilitychange', cancel);
    return () => document.removeEventListener('visibilitychange', cancel);
  }, []);
  useEffect(() => { if (disabled) { drag.current = null; clear(); } }, [disabled]);
  const direct = (x: number, width: number) => {
    const next = sliderValueAt(x, width, min, max, step);
    if (commitOnRelease) { setDirectPreview(next); announce(next); }
    else if (next !== valueRef.current) callback.current(next);
  };
  const begin = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || !event.isPrimary || event.button !== 0 || drag.current) return;
    clear(); event.preventDefault(); event.stopPropagation();
    const bounds = rail.current!.getBoundingClientRect(), width = bounds.width;
    widthRef.current = width;
    const origin = Math.max(0, Math.min(1, (valueRef.current - min) / (max - min))) * width;
    const ball = Math.abs(event.clientX - bounds.left - origin) < 22;
    const x = ball ? origin : Math.max(0, Math.min(width, event.clientX - bounds.left));
    if (!ball) direct(x, width);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: x, width, pullX: 0, pullY: 0, vertical: false };
    setPose({ x, y: 0 }); event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (!d || d.id !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    d.pullX = event.clientX - d.x; d.pullY = Math.max(-110, Math.min(110, event.clientY - d.y));
    if (Math.abs(d.pullY) > 14) d.vertical = true;
    if (d.vertical) {
      d.pullX = Math.max(-160, Math.min(160, d.pullX));
      setDirectPreview(null); setPose({ x: Math.max(0, Math.min(d.width, d.origin + d.pullX)), y: d.pullY });
      const flight = sliderFlight(d.origin, d.pullX, d.pullY, d.width);
      setPreview(flight); announce(sliderLandingValueAt(flight.landing, d.width, min, max, step, flight.vx));
    } else {
      const x = Math.max(0, Math.min(d.width, d.origin + d.pullX)); setPose({ x, y: 0 }); direct(x, d.width);
    }
  };
  const release = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (!d || d.id !== event.pointerId) return;
    drag.current = null; event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!d.vertical) {
      if (commitOnRelease) callback.current(sliderValueAt(d.origin + d.pullX, d.width, min, max, step));
      clear(); return;
    }
    const flight = sliderFlight(d.origin, d.pullX, d.pullY, d.width);
    setPreview(null); announce(null); flightRef.current = flight;
    const landingValue = sliderLandingValueAt(flight.landing, d.width, min, max, step, flight.vx);
    const alignedX = (landingValue - min) / (max - min) * d.width;
    const impact = flight.vy + flight.gravity * flight.duration, bounceDuration = sliderFirstBounceDuration(impact);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { callback.current(landingValue); clear(); return; }
    const start = performance.now(); let landed = false;
    const tick = (now: number) => {
      if (flightRef.current !== flight) return;
      const elapsed = (now - start) / 1000;
      if (elapsed < flight.duration) setPose(sliderFlightPosition(flight, elapsed));
      else {
        const bounceTime = elapsed - flight.duration, alignment = Math.min(1, bounceTime / Math.max(.001, bounceDuration));
        setPose({ x: flight.landing + (alignedX - flight.landing) * alignment, y: sliderBounceOffset(bounceTime, impact) });
        if (!landed && alignment === 1) { callback.current(landingValue); landed = true; }
      }
      if (elapsed < flight.duration + bounceDuration * 1.5) frame.current = requestAnimationFrame(tick);
      else { if (!landed) callback.current(landingValue); clear(); }
    };
    frame.current = requestAnimationFrame(tick);
  };
  const predicted = preview ? sliderLandingValueAt(preview.landing, widthRef.current, min, max, step, preview.vx) : directPreview;
  const pendingFlight = preview ?? flightRef.current;
  const displayedValue = pendingFlight ? sliderLandingValueAt(pendingFlight.landing, widthRef.current, min, max, step, pendingFlight.vx) : directPreview ?? Math.max(min, Math.min(max, value));
  const predictedX = predicted === null ? 0 : (predicted - min) / (max - min) * widthRef.current;
  const path = preview ? Array.from({ length: 25 }, (_, i) => sliderFlightPosition(preview, preview.duration * i / 24)) : [];
  return <div className="physical-slider" data-flight={flightRef.current ? 'flying' : preview ? 'aiming' : 'idle'}
    data-disabled={disabled ? 'true' : undefined} onPointerDown={begin} onPointerMove={move} onPointerUp={release}
    onPointerCancel={() => { drag.current = null; clear(); }}
    onLostPointerCapture={() => { if (drag.current) { drag.current = null; clear(); } }}>
    <input id={id} className="sr-only" aria-label={label} type="range" min={min} max={max} step={step}
      value={Math.max(min, Math.min(max, value))} disabled={disabled}
      aria-valuetext={`${predicted ?? value}${unit}${predicted === null ? '' : '，预计落点'}`}
      onChange={event => { clear(); onChange(Number(event.target.value)); }}/>
    <div ref={rail} className="physical-slider-rail" style={{ '--range-progress': `${(displayedValue - min) / (max - min) * 100}%` } as CSSProperties}>
      <span className="physical-slider-progress" aria-hidden="true"/>
      <i className="physical-slider-ball" aria-hidden="true" style={pose ? { left: pose.x, transform: `translate(-50%,${pose.y}px)` } : { left: `${(displayedValue - min) / (max - min) * 100}%` }}/>
      {preview && <><svg className="physical-slider-arc" aria-hidden="true"><path d={path.map((point, i) => `${i ? 'L' : 'M'}${point.x},${point.y + 180}`).join(' ')}/></svg>
        <i className="physical-slider-ball is-predicted" aria-hidden="true" style={{ left: predictedX }}/>
        {!onPreviewChange && <output className="physical-slider-preview">预计 {predicted}{unit}</output>}</>}
    </div>
  </div>;
}
