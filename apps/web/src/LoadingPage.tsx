export type LoadingStage = 'storage' | 'resources' | 'scene' | 'environment' | 'page' | 'error';
const STAGE_LABELS: Record<LoadingStage, string> = {
  storage: '本机记录', resources: '世界资源', scene: '地形与建筑', environment: '光照与天气', page: '页面', error: '暂未准备好',
};

/** Actual preparation stages, with no fabricated percentages or simulated progress. */
export function LoadingPage({ status, stage = 'page' }: { status: string; stage?: LoadingStage }) {
  return (
    <div className="boot-page" role="status" data-load-stage={stage} aria-live="polite">
      <div className="boot-page-inner">
        <div className="boot-page-model" aria-hidden="true">
          <svg className="boot-site" viewBox="0 0 160 144" shapeRendering="crispEdges">
            <path className="boot-ground" d="M12 104 80 70 148 104 80 138Z"/>
            <path className="boot-shadow" d="m50 106 30 15 44-22-30-15Z"/>
            <g className="boot-wall boot-wall-left"><path d="M48 54 80 70V114L48 98Z"/></g>
            <g className="boot-wall boot-wall-right"><path d="M80 70 112 54V98L80 114Z"/></g>
            <g className="boot-roof"><path d="m42 52 38-20 38 20-38 20Z"/></g>
            <g className="boot-dial"><path d="m55 61 20 10v30L55 91Z"/><path className="boot-hand" d="m64 73 3 2v10l7 3v3l-10-5Z"/></g>
            <g className="boot-tree"><path d="M123 101V85h4v16Z"/><path d="M119 72h12v4h4v12h-4v4h-12v-4h-4V76h4Z"/></g>
            <g className="boot-crate"><path d="m24 112 8-4 8 4v8l-8 4-8-4Z"/></g>
            <path className="boot-spark" d="M106 28h4v8h8v4h-8v8h-4v-8h-8v-4h8Z"/>
            <path className="boot-scan" d="M40 60 80 80l40-20v4L80 84 40 64Z"/>
          </svg>
        </div>
        <span className="boot-page-mark">方块钟<small>Blockcolc</small></span>
        <span className="boot-page-stage">{STAGE_LABELS[stage]}</span>
        <p className="boot-page-status">{status}</p>
      </div>
    </div>
  );
}
