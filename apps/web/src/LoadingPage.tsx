import { t, useI18n } from './i18n';
import { useEffect, useRef } from 'react';
import { TomatoLoading } from './TomatoLoading';
import { LAUNCH_BOOT_SCENE, type BootSceneKind } from './boot-scenes';

export type LoadingStage = 'storage' | 'resources' | 'scene' | 'environment' | 'page' | 'error';
const STAGE_LABELS: Record<LoadingStage, string> = {
  storage: "本机记录", resources: "世界资源", scene: "地形与建筑", environment: "光照与天气", page: "页面", error: "暂未准备好",
};
// A cold launch keeps the same house when the house family is selected.
const LAUNCH_HOUSE = Math.floor(Math.random() * 4);

export function BootHouse({ variant = LAUNCH_HOUSE }: { variant?: number }) {
  useI18n();
  const house = ((Math.trunc(variant) % 4) + 4) % 4;
  const rows = ['   rrrr   ', '  rrrrrr  ', ' rrrrrrrr ', 'rrrwwwwrrr', '  wwgwww  ', '  wwwwgw  ', '  wgddww  ', '  wwddww  ', '  ssssss  '];
  const colors: Record<string,string> = {r:['#a7664c','#72936b','#638a99','#bd674e'][house]!,w:'#d3b58b',g:'#b9dad1',d:'#775740',s:'#8f9987'};
  return <div className="boot-page-model boot-pixel-house" data-boot-house={house} aria-hidden="true">
    <svg className="boot-site" viewBox="0 0 160 144" shapeRendering="crispEdges">
      <path className="boot-ground" d="M16 126h128v4H16z"/>
      {rows.flatMap((row,y)=>[...row].map((cell,x)=>cell===' '?null:<rect key={`${x}:${y}`} className="boot-house-block"
        x={20+x*12} y={18+y*12} width={12} height={12} fill={colors[cell]}
        style={{animationDelay:`${((8-y)*10+x)*.026}s`}}/>))}
    </svg>
  </div>;
}

export function BootScene({ scene = LAUNCH_BOOT_SCENE }: { scene?: BootSceneKind }) {
  useI18n();
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const update=()=>{if(root.current)root.current.dataset.paused=String(document.hidden);};
    update();document.addEventListener('visibilitychange',update);
    return()=>document.removeEventListener('visibilitychange',update);
  },[]);
  return <div ref={root} className="boot-scene" data-boot-scene={scene}>{scene==='tomato'?<TomatoLoading/>:<BootHouse/>}</div>;
}

/** Actual preparation stages, with no fabricated percentages or simulated progress. */
export function LoadingPage({ status, stage = 'page', scene, embedded=false }: { status: string; stage?: LoadingStage; scene?: BootSceneKind; embedded?: boolean }) {
  useI18n();
  return (
    <div className={`boot-page${embedded?' boot-page--world':''}`} role="status" data-load-stage={stage} aria-live="polite">
      <div className="boot-page-inner">
        <BootScene scene={scene}/>
        {!embedded&&<><span className="boot-page-mark">{t("方块钟")}<small>Blockcolc</small></span><span className="boot-page-stage">{t(STAGE_LABELS[stage])}</span></>}
        <p className="boot-page-status">{embedded?(stage==='error'?t("世界暂不可用"):stage==='environment'?t("准备光照…"):t("准备世界…")):t(status)}</p>
      </div>
    </div>
  );
}
