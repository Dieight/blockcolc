import { StrictMode, useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { bootstrap } from './bootstrap';
import { LoadingPage } from './LoadingPage';
import { AppErrorBoundary } from './AppErrorBoundary';
import { completeStartupPresentation, startupPresentationSnapshot, subscribeStartupPresentation } from './startup-presentation';
import './styles/index.css';
import { installPerformanceProbe, markPerformancePhase } from './performance-probe';

installPerformanceProbe();

const root = createRoot(document.getElementById('root')!);
document.documentElement.dataset.inputMode='pointer';
document.addEventListener('pointerdown',()=>{document.documentElement.dataset.inputMode='pointer';},true);
document.addEventListener('keydown',event=>{if(['Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))document.documentElement.dataset.inputMode='keyboard';},true);
const appStartedAtMs = performance.now();
const logNativeStartup = (phase: string, durationMs: number): void => {
  const bridge = (window as typeof window & { BlockcolcNativeInput?: { logRenderDiagnostic?: (message: string) => void } }).BlockcolcNativeInput;
  bridge?.logRenderDiagnostic?.(`[blockcolc-startup] ${JSON.stringify({ phase, durationMs: Number(durationMs.toFixed(2)) })}`);
};
document.documentElement.dataset.bootstrapState = 'loading';
document.documentElement.dataset.coldStartup='true';
const loadingPagePainted = new Promise<void>((resolve) => {
  requestAnimationFrame(() => window.setTimeout(resolve, 0));
});
const boot=Promise.all([bootstrap(), loadingPagePainted]).then(([result]) => {
  document.documentElement.dataset.bootstrapDurationMs = (performance.now() - appStartedAtMs).toFixed(2);
  document.documentElement.dataset.bootstrapState = 'ready';
  markPerformancePhase('bootstrap-ready');
  logNativeStartup('bootstrap-ready', performance.now() - appStartedAtMs);
  return result;
});
function StartupShell(){
  const [configuration,setConfiguration]=useState<Awaited<ReturnType<typeof bootstrap>>|null>(null);
  const [failure,setFailure]=useState<string|null>(null);
  const presentation=useSyncExternalStore(subscribeStartupPresentation,startupPresentationSnapshot);
  useEffect(()=>{let alive=true;void boot.then(result=>{
    if(!alive)return;
    setConfiguration(result);
    // A new installation has no world to prepare yet; show its task creator.
    if(result.service.worldProjection().projects.length===0)completeStartupPresentation();
  requestAnimationFrame(() => {
    document.documentElement.dataset.appShellFrameMs = (performance.now() - appStartedAtMs).toFixed(2);
    markPerformancePhase('shell-frame');
    logNativeStartup('app-shell-frame', performance.now() - appStartedAtMs);
  });
  }).catch(error=>{
    if(!alive)return;
  document.documentElement.dataset.bootstrapState = 'failed';
    completeStartupPresentation();setFailure(String(error));
  });return()=>{alive=false;};},[]);
  return <>{failure?<div className="fatal"><strong>无法打开本地世界</strong><p>{failure}</p></div>:configuration&&<StrictMode><AppErrorBoundary><App {...configuration}/></AppErrorBoundary></StrictMode>}
    {presentation.active&&<LoadingPage stage={presentation.stage} status={presentation.status}/>}</>;
}
root.render(<StartupShell/>);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void import('@blockcolc/platform-capacitor').then(({ isCapacitorNative }) => {
      if (!isCapacitorNative()) return navigator.serviceWorker.register('/sw.js');
    });
  });
}
