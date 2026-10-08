import { useEffect, useRef } from 'react';
import { TomatoLoading } from './TomatoLoading';
import { LAUNCH_BOOT_SCENE, type BootSceneKind } from './boot-scenes';

export type LoadingStage = 'storage' | 'resources' | 'scene' | 'environment' | 'page' | 'error';
const STAGE_LABELS: Record<LoadingStage, string> = {
  storage: '本机记录', resources: '世界资源', scene: '地形与建筑', environment: '光照与天气', page: '页面', error: '暂未准备好',
};
// A cold launch keeps the same house when the house family is selected.
const LAUNCH_HOUSE = Math.floor(Math.random() * 4);

export function BootHouse({ variant = LAUNCH_HOUSE }: { variant?: number }) {
  const house = ((Math.trunc(variant) % 4) + 4) % 4;
  return <div className="boot-page-model" data-boot-house={house} aria-hidden="true">
    <svg className="boot-site" viewBox="0 0 160 144" shapeRendering="crispEdges">
      <path className="boot-ground" d="M12 104 80 70 148 104 80 138Z"/>
      <path className="boot-path" d="m24 111 8-4 51 25-8 4Z"/>
      <path className="boot-shadow" d="m44 108 40 20 51-25-40-20Z"/>
      <path className="boot-wall boot-wall-left" d="M48 55 80 71V114L48 98Z"/>
      <path className="boot-wall boot-wall-right" d="M80 71 112 55V98L80 114Z"/>
      <path className="boot-foundation" d="m48 93 32 16 32-16v6l-32 16-32-16Z"/>
      {house===0?<g className="boot-roof"><path d="m40 55 14-27 36 18-12 28Z"/><path className="boot-roof-lit" d="m54 28 31-15 36 18-31 15Z"/><path className="boot-gable" d="m90 46 31-15-9 25-32 16Z"/><path className="boot-roof-seam" d="m48 44 3 1 33 17-1 3-34-17Zm7-13 3 1 32 16-1 3-34-17Z"/></g>
      :house===1?<g className="boot-roof"><path d="m40 53 40-35 9 32-9 23Z"/><path className="boot-roof-lit" d="m80 18 40 35-31-3Z"/><path className="boot-gable" d="m89 50 31 3-8 4-32 16Z"/><path className="boot-roof-seam" d="m57 42 3-2 19 19v4l-3-1Z"/></g>
      :house===2?<g className="boot-roof"><path d="m42 53 38-20 38 20-38 20Z"/><path className="boot-roof-lit" d="m51 49 29-14 29 14-29 15Z"/><path className="boot-gable" d="M42 53v7l38 19 38-19v-7L80 72Z"/><path className="boot-wall-left" d="m68 18 12-6 12 6v22l-12 6-12-6Z"/><path className="boot-roof-lit" d="m65 17 15-16 15 16-15 8Z"/></g>
      :<g className="boot-roof"><path d="m41 54 13-22 36 18-11 24Z"/><path className="boot-roof-lit" d="m54 32 31-16 36 18-31 16Z"/><path className="boot-gable" d="m90 50 31-16-9 23-32 17Z"/><path className="boot-chimney" d="m69 20 8-4 8 4v17l-8 4-8-4Z"/></g>}
      <path className="boot-timber" d="M48 55v4l30 15v36l4 2V75l30-15v-5L80 71Zm3 22 25 13v3L51 81Z"/>
      <g className="boot-dial"><path d="m55 62 18 9v24l-18-9Z"/><path className="boot-hand" d="m63 72 3 1v10l6 3v3l-9-5Z"/></g>
      <path className="boot-door" d="m87 91 10-5v19l-10 5Z"/>
      <path className="boot-window" d="m103 63 6-3v9l-6 3ZM83 74l6-3v9l-6 3Z"/>
      <path className="boot-tree-trunk" d="M124 108V92h4v16Z"/>
      <path className="boot-tree" d="M119 72h12v4h4v12h-4v4h-12v-4h-4V76h4Z"/>
      <path className="boot-crate" d="m29 107 8-4 8 4v8l-8 4-8-4Z"/>
      <path className="boot-flower" d="M46 115h3v3h3v3h-3v3h-3v-3h-3v-3h3Z"/>
    </svg>
    <div className="boot-windmill"><div className="boot-windmill-rotor"><svg viewBox="0 0 32 32" focusable="false"><path d="M14 1h4v9h-4zM17 11h14v5H20v3h-3zM14 18h4v13h-4zM1 16h11v-3h3v7H1z"/></svg></div><i/></div>
  </div>;
}

export function BootScene({ scene = LAUNCH_BOOT_SCENE }: { scene?: BootSceneKind }) {
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const update=()=>{if(root.current)root.current.dataset.paused=String(document.hidden);};
    update();document.addEventListener('visibilitychange',update);
    return()=>document.removeEventListener('visibilitychange',update);
  },[]);
  return <div ref={root} className="boot-scene" data-boot-scene={scene}>{scene==='tomato'?<TomatoLoading/>:<BootHouse/>}</div>;
}

/** Actual preparation stages, with no fabricated percentages or simulated progress. */
export function LoadingPage({ status, stage = 'page', scene }: { status: string; stage?: LoadingStage; scene?: BootSceneKind }) {
  return (
    <div className="boot-page" role="status" data-load-stage={stage} aria-live="polite">
      <div className="boot-page-inner">
        <BootScene scene={scene}/>
        <span className="boot-page-mark">方块钟<small>Blockcolc</small></span>
        <span className="boot-page-stage">{STAGE_LABELS[stage]}</span>
        <p className="boot-page-status">{status}</p>
      </div>
    </div>
  );
}
