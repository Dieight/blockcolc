import type { CSSProperties } from 'react';

export type LoadingStage = 'storage' | 'resources' | 'scene' | 'environment' | 'page' | 'error';
const STAGE_LABELS: Record<LoadingStage, string> = {
  storage: '本机记录', resources: '世界资源', scene: '地形与建筑', environment: '光照与天气', page: '页面', error: '暂未准备好',
};

/** Actual preparation stages, with no fabricated percentages or simulated progress. */
export function LoadingPage({ status, stage = 'page' }: { status: string; stage?: LoadingStage }) {
  return (
    <div className="boot-page" role="status" data-load-stage={stage} aria-live="polite">
      <div className="boot-page-inner">
        <div className="boot-page-model" aria-hidden="true"><div className="boot-page-site">
          {Array.from({ length: 9 }, (_, i) => <i key={i} className="boot-cube" style={{
            '--cube-x': `${(i % 3) * 21}px`, '--cube-y': `${Math.floor(i / 3) * 21}px`,
            '--cube-delay': `${i * .12}s`,
          } as CSSProperties}/>)}
        </div></div>
        <span className="boot-page-mark">方块钟<small>Blockcolc</small></span>
        <span className="boot-page-stage">{STAGE_LABELS[stage]}</span>
        <p className="boot-page-status">{status}</p>
      </div>
    </div>
  );
}
