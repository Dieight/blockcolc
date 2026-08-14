import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { bootstrap } from './bootstrap';
import { LoadingPage } from './LoadingPage';
import './styles.css';
import './styles-overrides.css';

const root = createRoot(document.getElementById('root')!);
root.render(<LoadingPage status="正在恢复你的世界…"/>);
bootstrap().then(({service,resourcePacks}) => root.render(<StrictMode><App service={service} resourcePacks={resourcePacks}/></StrictMode>)).catch(error => root.render(<div className="fatal"><strong>无法打开本地世界</strong><p>{String(error)}</p></div>));

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void import('@tomato-clock/platform-capacitor').then(({ isCapacitorNative }) => {
      if (!isCapacitorNative()) return navigator.serviceWorker.register('/sw.js');
    });
  });
}
