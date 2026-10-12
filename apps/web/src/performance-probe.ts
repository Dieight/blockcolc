import type { ApplicationService } from '@blockcolc/application';
import type { RendererDiagnostics, RendererFramePerformance } from '@blockcolc/voxel';
import { durationSamples } from './performance-samples';
import { unsettledMarathonSessions } from './marathon-settlement';
import { ROUND_PLAN_KEY } from './round-plan-store';

interface ProbeBridge { isEnabled(): boolean; publish(payload: string): void; startupProgressiveOverride?():boolean }
type ProbeWindow = 'startup' | 'idle' | 'rotation-first' | 'rotation-repeat' | 'zoom' | 'navigation' | 'return';
const WINDOWS = new Set<ProbeWindow>(['startup', 'idle', 'rotation-first', 'rotation-repeat', 'zoom', 'navigation', 'return']);
const STAGES = new Set(['js-entry', 'native-bars', 'storage-load', 'resume', 'builtin-rewards', 'lifecycle', 'bootstrap-ready', 'shell-frame', 'progressive-ui-frame', 'world-ready', 'opening-start', 'opening-complete']);
const RENDER_KEYS = ['pixelRatio', 'worldRebuildCount', 'renderedWorldRebuildCount', 'worldRebuildLastMs', 'worldRebuildTotalMs', 'worldRebuildMaxMs', 'firstNonemptyFrameMs', 'interactionP95Ms', 'interactionTotalP95Ms', 'interactionTotalMaxMs', 'interactionAnimationFrameP95Ms', 'interactionAnimationFrameMaxMs', 'interactionDelayedFrameCount', 'gpuRenderP95Ms', 'gpuRenderMaxMs', 'gpuRenderSampleCount', 'pointerMoveCount', 'resizeCount', 'shadowRefreshCount', 'atlasPageCount', 'texturedVoxelCount', 'fallbackVoxelCount', 'geometryVoxelCount', 'openingRevealStartedCount', 'openingRevealCompletedCount', 'openingRevealCancelledCount'] as const;
const CANVAS_KEYS = ['initialModuleLoadMs', 'initialEnvironmentWaitMs', 'initialModuleAndEnvironmentMs', 'initialShaderPreparationMs', 'initialPresentationPreparationMs', 'initialGpuPreparationMs', 'openingPreparedFrames', 'worldSceneCacheReadMs', 'buildingCpuCacheReadMs', 'buildingCpuCacheHits', 'buildingCpuCacheMisses', 'originalGeometryCacheHits', 'buildingMeshCacheHits'] as const;
/** Per-launch diagnostic override, never a persisted user preference. */
export function diagnosticProgressiveStartup():boolean{
  if(import.meta.env.VITE_BLOCKCOLC_PERFORMANCE_DIAGNOSTICS!=='true')return false;
  try{return (globalThis as {BlockcolcPerformance?:ProbeBridge}).BlockcolcPerformance?.startupProgressiveOverride?.()===true;}catch{return false;}
}
export function diagnosticStateDatabase():string {
  const value=(globalThis as {__blockcolcDiagnosticStorage?:unknown}).__blockcolcDiagnosticStorage;
  return import.meta.env.VITE_BLOCKCOLC_PERFORMANCE_DIAGNOSTICS==='true'&&typeof value==='string'&&/^blockcolc-diagnostic-[a-f0-9-]{36}$/.test(value)?value:'blockcolc-v1';
}
export const diagnosticStorageIsolation=()=>diagnosticStateDatabase()!=='blockcolc-v1';
let bridge: ProbeBridge | null = null;
let service: ApplicationService | null = null;
let readRenderer: (() => RendererDiagnostics) | null = null;
let raf = 0, observer: PerformanceObserver | null = null, lastFrame: number | null = null;
let enabled = false, expiresAt = 0, windowStarted = 0, windowLabel: ProbeWindow = 'startup';
let rafIntervals = durationSamples(), longTasks = durationSamples(), rendererCpu = durationSamples();
let errors = 0;
let holdQuality = false;
let frameTrace: (RendererFramePerformance & { cpuMs: number })[] = [];
const phases: Record<string, number> = {};
const durations: Record<string, number> = {};
// Do not make a synchronous Java bridge round-trip for every animation frame.
// Native enforces its own lease on publication; stop/expiry also cancel this loop.
const probeIsActive = () => enabled && performance.now() < expiresAt;

function beginWindow(label: ProbeWindow) {
  if (!probeIsActive() || !WINDOWS.has(label)) return;
  observer?.takeRecords().forEach(entry => longTasks.add(entry.duration));
  windowLabel = label; windowStarted = performance.now(); lastFrame = null;
  rafIntervals = durationSamples(); longTasks = durationSamples(); rendererCpu = durationSamples();
  frameTrace = [];
}
function stop() {
  holdQuality = false;
  enabled = false; cancelAnimationFrame(raf); raf = 0; observer?.disconnect(); observer = null;
  document.removeEventListener('visibilitychange', visibilityChanged);
  window.removeEventListener('error', errorObserved); window.removeEventListener('unhandledrejection', errorObserved);
}
const visibilityChanged = () => { lastFrame = null; };
const errorObserved = () => { errors++; }; // Intentionally never read an error message or rejection payload.
function start() {
  if (enabled || !bridge?.isEnabled()) return;
  enabled = true; expiresAt = performance.now() + 240_000;
  beginWindow('startup');
  try {
    observer = new PerformanceObserver(list => {
      if (!probeIsActive()) return;
      for (const entry of list.getEntries()) {
        if (entry.startTime >= windowStarted) longTasks.add(entry.duration);
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
  } catch { observer = null; }
  document.addEventListener('visibilitychange', visibilityChanged);
  window.addEventListener('error', errorObserved); window.addEventListener('unhandledrejection', errorObserved);
  const tick = (at: number) => {
    if (!probeIsActive()) { stop(); return; }
    if (!document.hidden && lastFrame !== null) rafIntervals.add(at - lastFrame);
    lastFrame = document.hidden ? null : at; raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

export function installPerformanceProbe() {
  // The bridge is attached only to explicitly opted-in diagnostic APKs. A
  // normal build installs no observer, animation loop, timers or global API.
  if (import.meta.env.VITE_BLOCKCOLC_PERFORMANCE_DIAGNOSTICS !== 'true') return;
  const candidate = (globalThis as { BlockcolcPerformance?: ProbeBridge }).BlockcolcPerformance;
  if (!candidate || typeof candidate.isEnabled !== 'function' || typeof candidate.publish !== 'function') return;
  bridge = candidate;
  Object.assign(window, { __blockcolcPerformanceProbe: {
    start, stop, beginWindow,
    snapshot: performanceProbeSnapshot,
    target: performanceProbeTarget,
    // Read only through the explicitly enabled WebView debugger, not the native
    // publication protocol. A bounded numeric trace cannot include task text.
    frameTrace: () => frameTrace.slice(),
    async prepareFocusExperiment(){
      if(!probeIsActive()||!service||!performanceProbeSafety().idle)throw new Error('Idle diagnostic application required');
      return (await import('./diagnostic-focus-experiment')).prepareFocusExperiment(service.snapshot());
    },
    experimentStatus(){
      if(!diagnosticStorageIsolation()||!service)throw new Error('Isolated experiment required');
      const state=service.snapshot(),plan=JSON.parse(localStorage.getItem(ROUND_PLAN_KEY)??'null');
      return{historyCount:state.focusHistory.length,active:state.activeFocusSession?{startsAt:state.activeFocusSession.startedAt,endsAt:state.activeFocusSession.endsAt}:null,
        plan:plan?{status:plan.status,completedRounds:plan.completedRounds,totalRounds:plan.totalRounds}:null,
        reportVisible:!!document.querySelector('.focus-report-surface')};
    },
    async cancelExperiment(authorizationId:string){
      if(!/^diagnostic-[a-f0-9-]{36}$/.test(authorizationId))throw new Error('Diagnostic authorization required');
      const {cancelAutomaticContinuations}=await import('@blockcolc/platform-capacitor');
      await cancelAutomaticContinuations(authorizationId);
    },
    holdQuality(value: boolean) { holdQuality = probeIsActive() && value === true; },
    zoom(direction: string) {
      if (!probeIsActive() || !performanceProbeSafety().idle || !['in', 'out'].includes(direction)) return;
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-world-canvas]');
      const rect = canvas?.getBoundingClientRect();
      if (canvas && rect) canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
        clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, deltaY: direction === 'in' ? -120 : 120 }));
    },
  } });
  start(); markPerformancePhase('js-entry');
}
export function bindPerformanceApplication(value: ApplicationService) { if (bridge) service = value; }
export function bindPerformanceRenderer(read: () => RendererDiagnostics): () => void {
  if (!bridge) return () => undefined;
  readRenderer = read;
  return () => { if (readRenderer === read) readRenderer = null; };
}
export function diagnosticHoldQuality(): boolean { return probeIsActive() && holdQuality; }
export function performanceProbeFrameCallback(): ((ms: number, frame?: RendererFramePerformance) => void) | undefined {
  return bridge ? (ms, frame) => {
    if (!probeIsActive()) return;
    rendererCpu.add(ms);
    if (frame) {
      frameTrace.push({ ...frame, cpuMs: ms });
      if (frameTrace.length > 480) frameTrace.shift();
    }
  } : undefined;
}
export function markPerformancePhase(phase: string) {
  if (probeIsActive() && STAGES.has(phase) && phases[phase] === undefined) {
    phases[phase] = performance.now();
    if (phase === 'world-ready') requestAnimationFrame(performanceProbeSnapshot);
  }
}
export async function measurePerformanceStage<T>(stage: string, operation: () => Promise<T>): Promise<T> {
  if (!probeIsActive() || !STAGES.has(stage)) return operation();
  const started = performance.now();
  try { return await operation(); } finally { durations[stage] = performance.now() - started; markPerformancePhase(stage); }
}
export function performanceProbeSafety() {
  if (!service) return { known: false, idle: false };
  try {
    const state = service.snapshot();
    const plan = localStorage.getItem(ROUND_PLAN_KEY);
    const hasPlan = plan !== null && plan !== 'null';
    const pending = (service.activeProjectProjection()?.unreportedCompletedSessions.length ?? 0) + unsettledMarathonSessions(state).length;
    return { known: true, idle: state.activeFocusSession === null && !hasPlan && pending === 0,
      activeFocus: state.activeFocusSession !== null, hasPlan, pendingReports: pending,
      projectCount: state.projects.filter(p => p.status !== 'deleted').length, focusHistoryCount: state.focusHistory.length,
      importedBlueprintCount: state.buildingBlueprintResources.length, progressReportCount: state.progressReports.length };
  } catch { return { known: false, idle: false }; }
}
function performanceProbeSnapshot() {
  if (!probeIsActive()) return;
  observer?.takeRecords().forEach(entry => { if (entry.startTime >= windowStarted) longTasks.add(entry.duration); });
  const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-world-canvas]');
  const stages: Record<string, number> = {};
  if (canvas) for (const key of CANVAS_KEYS) {
    const value = canvas.dataset[key]; if (value !== undefined && Number.isFinite(Number(value))) stages[key] = Number(value);
  }
  if (canvas?.dataset.worldRebuildStagesMs) {
    try {
      const values = JSON.parse(canvas.dataset.worldRebuildStagesMs) as Record<string, unknown>;
      for (const key of ['clear', 'layout', 'terrainGeneration', 'terrainMesh', 'roadsAndLamps', 'buildings', 'naturalDecorations', 'lightingAndFinalize']) {
        if (typeof values[key] === 'number' && Number.isFinite(values[key])) stages[key] = values[key];
      }
    } catch { /* Incomplete diagnostics during an interrupted generation. */ }
  }
  const renderer: Record<string, number | string | boolean | null> = {};
  const cacheRead=canvas?.dataset.worldSceneCacheRead;
  if(cacheRead&&['restored','miss','invalid','unavailable'].includes(cacheRead))renderer.worldSceneCacheRead=cacheRead;
  const buildingRead=canvas?.dataset.buildingCpuCacheRead;
  if(buildingRead&&['restored','miss','invalid','unavailable'].includes(buildingRead))renderer.buildingCpuCacheRead=buildingRead;
  renderer.progressiveStartup=document.documentElement.dataset.progressiveStartup==='true';
  for(const key of ['terrainGenerationCacheHit','sceneryPlanCacheHit'] as const){
    const value=canvas?.dataset[key];if(value==='true'||value==='false')renderer[key]=value==='true';
  }
  if (canvas?.dataset.sceneryBuildStagesMs) {
    try {
      const values = JSON.parse(canvas.dataset.sceneryBuildStagesMs);
      for (const [source, target] of [['planning', 'sceneryPlanning'], ['geometry', 'sceneryGeometry']]) {
        if (typeof values[source!] === 'number' && Number.isFinite(values[source!])) stages[target!] = values[source!];
      }
    } catch { /* Only complete numeric measurements are accepted. */ }
  }
  try {
    const diagnostics = readRenderer?.();
    if (diagnostics) {
      for (const key of RENDER_KEYS) renderer[key] = diagnostics[key];
      Object.assign(renderer, { gpuTimerAvailable: diagnostics.gpuTimerAvailable, qualityTier: diagnostics.qualityTier,
        resourcePackActive: diagnostics.activeResourcePackId !== null, drawCalls: diagnostics.render.calls,
        triangles: diagnostics.render.triangles, geometries: diagnostics.memory.geometries, textures: diagnostics.memory.textures });
    }
  } catch { /* The current generation can have been disposed between callbacks. */ }
  const result = { schemaVersion: 1, windowLabel, measuredAtMs: performance.now(), windowDurationMs: performance.now() - windowStarted,
    pageVisible: !document.hidden, worldReady: document.documentElement.dataset.coldStartup === 'false' && !!renderer.worldRebuildCount,
    phases: { ...phases }, durations: { ...durations }, stages, raf: rafIntervals.summary(), longTasks: longTasks.summary(),
    rendererCpu: rendererCpu.summary(), renderer, safety: performanceProbeSafety(), errors,
    viewport: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio } };
  bridge?.publish(JSON.stringify(result));
  return result;
}
/** Read-only rectangles; the script uses real ADB touch events, not JS clicks. */
function performanceProbeTarget(target: string) {
  if (!probeIsActive()) return;
  const nav = ['world', 'tasks', 'stats', 'settings'];
  const index = nav.indexOf(target);
  const element = target === 'canvas' ? document.querySelector('canvas[data-world-canvas]')
    : index >= 0 ? document.querySelectorAll('.bottom-nav button')[index] : null;
  const rect = element?.getBoundingClientRect();
  bridge?.publish(JSON.stringify({ schemaVersion: 1, target: index >= 0 || target === 'canvas' ? target : 'none',
    visible: !!rect && rect.width > 0 && rect.height > 0 && !element?.closest('[hidden]'),
    rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
    viewport: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio } }));
}
