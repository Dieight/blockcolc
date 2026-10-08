import { createRoot } from 'react-dom/client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BUILTIN_BLUEPRINT_CATALOG, createVoxelRenderer, type VoxelRenderer } from '@blockcolc/voxel';
import { PixelBrand, PixelCalendar, PixelClock, PixelTasks, PixelChart, PixelSettings } from '../ui/PixelIcon';
import { BootHouse } from '../LoadingPage';
import '../styles/index.css';
import { createModeMotion, REVIEW_MOTIONS, type ReviewMotion } from './mode-motion';
import './mode-motion.css';
import './v260-review.css';

type Environment='ocean-island'|'mosaic-coast';
const date=Date.parse('2026-10-07T07:00:00Z');
const worlds=Array.from({length:12},(_,i)=>({projectId:`review-${i}`,settlementIndex:i,
  blueprintId:BUILTIN_BLUEPRINT_CATALOG[i%3]!.id,buildingCompletionBasisPoints:[10000,6800,8800][i%3]!,
  buildingConditionBasisPoints:10000,isMonument:false}));

function Review(){
  const [motion,setMotion]=useState<ReviewMotion>('clock');
  const [environment,setEnvironment]=useState<Environment>('ocean-island');
  const [theme,setTheme]=useState<'light'|'dark'>('light'),[busy,setBusy]=useState(true),[error,setError]=useState('');
  const canvas=useRef<HTMLCanvasElement>(null),renderer=useRef<VoxelRenderer|null>(null),phone=useRef<HTMLDivElement>(null);
  const controller=useRef<ReturnType<typeof createModeMotion>|null>(null);
  useLayoutEffect(()=>{document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;},[theme]);
  useLayoutEffect(()=>{
    const element=phone.current;if(!element)return;
    const motionController=createModeMotion(element);controller.current=motionController;
    return()=>{motionController.dispose();controller.current=null;};
  },[]);
  useLayoutEffect(()=>{
    const choice=REVIEW_MOTIONS.find(item=>item.id===motion)!;
    controller.current?.configure(motion,choice.duration);
  },[motion]);
  useEffect(()=>{
    let alive=true;const c=canvas.current;if(!c)return;
    setBusy(true);setError('');
    const world=createVoxelRenderer(c,{lightingQuality:'cinematic',
      environmentStyle:environment,worldSeed:'world-default',terrainGenerationVersion:4,
      initialEnvironment:{weather:{kind:'clear'},astronomy:null,debug:{date}}});
    renderer.current=world;world.setReducedMotion(true);
    void world.initializeWorlds(worlds,null).then(()=>world.prepareInitialPresentation()).then(()=>{
      if(alive){world.setVisible(true);setBusy(false);c.dataset.reviewReady='true';}
    }).catch(cause=>{if(alive){setError(cause instanceof Error?cause.message:'画面未准备好');setBusy(false);}});
    return()=>{alive=false;world.dispose();renderer.current=null;c.dataset.reviewReady='false';};
  },[environment]);
  return <div className="review-layout">
    <header className="review-heading"><h1>v2.6.0 · 转场第二稿</h1><p>真实世界 · 只演示界面，不读取或修改本机任务</p></header>
    <div className="review-options">
      <fieldset><legend>过渡动画</legend>{REVIEW_MOTIONS.map(choice=><button key={choice.id} type="button" aria-pressed={motion===choice.id} onClick={()=>setMotion(choice.id)}>{choice.label}</button>)}</fieldset>
      <fieldset><legend>实际世界</legend><button type="button" disabled={busy} aria-pressed={environment==='ocean-island'} onClick={()=>setEnvironment('ocean-island')}>海岛</button><button type="button" disabled={busy} aria-pressed={environment==='mosaic-coast'} onClick={()=>setEnvironment('mosaic-coast')}>海岸</button><button type="button" aria-pressed={theme==='dark'} onClick={()=>setTheme(theme==='light'?'dark':'light')}>浅 / 深色</button></fieldset>
    </div>
    <div ref={phone} className="motion-phone" data-mode="normal" data-review-motion={motion}>
      <canvas className="motion-world" ref={canvas} aria-label="v2.6.0 实际世界预览"/>
      <header className="motion-topbar"><PixelBrand/><b>方块钟</b><span><PixelCalendar size={18}/>10月7日</span></header>
      <div className="motion-glass" aria-hidden="true"/>
      <p className="motion-workline motion-normal-part">当前施工 · 林间工坊</p>
      <h2 className="motion-title motion-normal-part">给下一步留点时间</h2>
      <div className="motion-progress motion-normal-part" aria-hidden="true"><i/><i/><i/><i/><i/><i/><i/><i/></div>
      <p className="motion-minimal-kicker motion-minimal-part">把今天，建成一小步</p>
      <strong className="motion-clock">15:00</strong>
      <p className="motion-minimal-meta motion-minimal-part">今天专注 1 小时 30 分 · 3 / 6 轮</p>
      <button className="motion-toggle" type="button"><span className="motion-normal-label">进入极简模式</span><span className="motion-minimal-label">返回完整模式</span></button>
      <nav className="motion-nav" aria-label="预览导航">{[[PixelClock,'计时'],[PixelTasks,'任务'],[PixelChart,'统计'],[PixelSettings,'设置']].map(([Icon,label])=>{const Glyph=Icon as typeof PixelClock;return <span className="motion-nav-item" key={label as string}><Glyph/><small>{label as string}</small></span>;})}</nav>
      {busy&&<div className="review-loading" role="status"><BootHouse/><span>正在准备真实画面…</span></div>}
      {error&&<p className="review-error" role="alert">{error}</p>}
    </div>
    <p className="review-duration">{REVIEW_MOTIONS.find(choice=>choice.id===motion)!.label} · {REVIEW_MOTIONS.find(choice=>choice.id===motion)!.duration/1000} 秒</p>
  </div>;
}
createRoot(document.getElementById('review-root')!).render(<Review/>);
