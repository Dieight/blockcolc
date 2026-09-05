import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { bootstrap } from './bootstrap';
import { LoadingPage } from './LoadingPage';
import './styles/index.css';

const root = createRoot(document.getElementById('root')!);
const appStartedAtMs = performance.now();
const logNativeStartup = (phase: string, durationMs: number): void => {
  const bridge = (window as typeof window & { BlockcolcNativeInput?: { logRenderDiagnostic?: (message: string) => void } }).BlockcolcNativeInput;
  bridge?.logRenderDiagnostic?.(`[blockcolc-startup] ${JSON.stringify({ phase, durationMs: Number(durationMs.toFixed(2)) })}`);
};
document.documentElement.dataset.bootstrapState = 'loading';
root.render(<LoadingPage status="正在恢复你的世界…"/>);
const loadingPagePainted = new Promise<void>((resolve) => {
  requestAnimationFrame(() => window.setTimeout(resolve, 0));
});
Promise.all([bootstrap(), loadingPagePainted]).then(([{service,resourcePacks}]) => {
  document.documentElement.dataset.bootstrapDurationMs = (performance.now() - appStartedAtMs).toFixed(2);
  document.documentElement.dataset.bootstrapState = 'ready';
  logNativeStartup('bootstrap-ready', performance.now() - appStartedAtMs);
  root.render(<StrictMode><App service={service} resourcePacks={resourcePacks}/></StrictMode>);
  requestAnimationFrame(() => {
    document.documentElement.dataset.appShellFrameMs = (performance.now() - appStartedAtMs).toFixed(2);
    logNativeStartup('app-shell-frame', performance.now() - appStartedAtMs);
  });
}).catch(error => {
  document.documentElement.dataset.bootstrapState = 'failed';
  root.render(<div className="fatal"><strong>无法打开本地世界</strong><p>{String(error)}</p></div>);
});

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void import('@tomato-clock/platform-capacitor').then(({ isCapacitorNative }) => {
      if (!isCapacitorNative()) return navigator.serviceWorker.register('/sw.js');
    });
  });
}
