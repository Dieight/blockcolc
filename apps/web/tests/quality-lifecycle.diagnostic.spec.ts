import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { projectWorldState } from '@blockcolc/application';
import { qualityLifecycleWorldIdentity } from '../../../packages/voxel/src/quality-lifecycle-world-identity';
import { toVoxelWorlds } from '../src/world-projection';
import { fixBusinessDate } from './fixed-business-date';
import { readPersistedDomainState } from './persisted-domain-state';

const CLIENT_JAR_BYTES = 41_483_720;
const CLIENT_JAR_SHA256 = '4508d006323f24fa02876310c192d739af56516eb259000ac50f0909a68c9a2d';
const BUSINESS_EPOCH = new Date('2026-09-22T12:00:00+08:00').getTime();
const EXPECTED_WORLD_SEED = 'world-project-00000000-0000-4000-8000-000000000004';
const QUALITY_PAIRS = 5;
const ERROR_CAP = 64;
const NORMAL_GL_OBSERVATION_COUNTER_CAP = 1_000_000;
const CLICK_CAP = QUALITY_PAIRS * 2;
// One reload renderer + ten measured renderer generations; two context slots
// per such generation plus two setup contexts is bounded headroom. Generations
// can reuse a single canvas context, so this is capacity, not an assumed count.
const MAX_PROTOCOL_RENDERER_GENERATIONS = 1 + QUALITY_PAIRS * 2;
const CONTEXT_CAP = MAX_PROTOCOL_RENDERER_GENERATIONS * 2 + 2;
const CONTEXT_COUNT_CAP = 128;
const PHASE_DURATION_STAGES = [
  'selection-metadata-read-end', 'selection-read-end', 'manifest-layer-end', 'atlas-build-complete',
  'quality-projection-complete', 'world-rebuild-complete', 'visible-world-frame',
] as const;

type Preference = 'performance' | 'balanced';
type QualityExecutionOutcome = 'completed' | 'failed' | 'skipped';
interface QualitySnapshot {
  status: string;
  elapsedMs: number;
  deadlineMs: number;
  overflowCount: { operations: number; actions: number; phases: number };
  operations: Array<{
    kind: string;
    result: string;
    startedAtOffsetMs: number;
    endedAtOffsetMs: number | null;
    omittedRedundantPhaseCount: number;
    actions: Array<{ requestedPreference: string; startedAtOffsetMs: number; endedAtOffsetMs: number | null; result: string }>;
    phases: Array<Record<string, unknown> & { stage: string; actionIndex: number | null; offsetMs: number }>;
  }>;
}
interface QualityClickTrace {
  events: Array<{ operationIndex: number; actionIndex: number; preference: Preference; offsetMs: number }>;
  overflowCount: number;
}
interface QualityGpuDiagnostics {
  contexts: Array<{
    id: number; gl: WeakRef<WebGLRenderingContext | WebGL2RenderingContext>;
    drawingBufferWidth: number; drawingBufferHeight: number;
    vendorFingerprint: number; rendererFingerprint: number; versionFingerprint: number;
    attributes: { alpha: boolean; antialias: boolean; depth: boolean; stencil: boolean; preserveDrawingBuffer: boolean } | null;
  }>;
  contextOverflowCount: number;
  createdContextCount: number;
  createdContextOverflowCount: number;
  contextAcquisitionCount: number;
  contextAcquisitionOverflowCount: number;
  contextLostCount: number;
  contextLostOverflowCount: number;
  shaderCompileChecks: number;
  shaderCompileCheckOverflowCount: number;
  shaderCompileCalls: number;
  shaderCompileCallOverflowCount: number;
  shaderCompileFailures: number;
  shaderCompileOverflowCount: number;
  programLinkChecks: number;
  programLinkCheckOverflowCount: number;
  programLinkFailures: number;
  programLinkOverflowCount: number;
  programValidationChecks: number;
  programValidationCheckOverflowCount: number;
  programValidationFailures: number;
  programValidationOverflowCount: number;
  getErrorChecks: number;
  getErrorCheckOverflowCount: number;
  visibleFrameErrorSamples: number;
  visibleFrameErrorSampleOverflowCount: number;
  glErrors: Record<number, number>;
  glErrorOverflowCount: number;
  glErrorUnknownCount: number;
  glErrorUnknownOverflowCount: number;
  sampleVisibleFrameError(gl: WebGLRenderingContext | WebGL2RenderingContext): void;
}
interface QualityGpuSummary {
  contextStorageCap: number;
  contextCountCap: number;
  glObservationCounterCap: number;
  normalGlObservationCounterCap: number;
  contextCount: number;
  contextOverflowCount: number;
  createdContextCount: number;
  createdContextOverflowCount: number;
  contextAcquisitionCount: number;
  contextAcquisitionOverflowCount: number;
  contextLostCount: number;
  contextLostOverflowCount: number;
  shaderCompileChecks: number;
  shaderCompileCheckOverflowCount: number;
  shaderCompileCalls: number;
  shaderCompileCallOverflowCount: number;
  shaderCompileStatusInspection: 'direct-query-observed' | 'not-queried-on-successful-link-path';
  shaderCompileFailures: number;
  shaderCompileOverflowCount: number;
  programLinkChecks: number;
  programLinkCheckOverflowCount: number;
  programLinkFailures: number;
  programLinkOverflowCount: number;
  programValidationChecks: number;
  programValidationCheckOverflowCount: number;
  programValidationInspection: 'query-observed' | 'not-queried';
  programValidationFailures: number;
  programValidationOverflowCount: number;
  getErrorChecks: number;
  getErrorCheckOverflowCount: number;
  visibleFrameErrorSamples: number;
  visibleFrameErrorSampleOverflowCount: number;
  glErrors: Record<number, number>;
  glErrorOverflowCount: number;
  glErrorUnknownCount: number;
  glErrorUnknownOverflowCount: number;
  contexts: Array<{
    id: number;
    isContextLost: boolean | null;
    drawingBufferWidth: number;
    drawingBufferHeight: number;
    vendorFingerprint: number;
    rendererFingerprint: number;
    versionFingerprint: number;
    attributes: { alpha: boolean; antialias: boolean; depth: boolean; stencil: boolean; preserveDrawingBuffer: boolean } | null;
  }>;
}
interface ProbeWindow {
  __blockcolcQualityLifecyclePageStartAt?: number;
  __blockcolcQualityLifecycle?: {
    beginOperation(kind: 'boot' | 'quality-pair'): number | null;
    beginAction(preference: Preference): number | null;
    endAction(result: 'completed' | 'failed' | 'cancelled'): void;
    endOperation(result: 'completed' | 'failed' | 'cancelled'): void;
    read(): QualitySnapshot;
  };
  __blockcolcQualityClickTrace?: QualityClickTrace;
  __blockcolcQualityGpuDiagnostics?: QualityGpuDiagnostics;
}
interface QualityAutomationObservation {
  operationIndex: number;
  actionIndex: number;
  preference: Preference;
  actionStartOffsetMs: number;
  clickOffsetMs: number;
  qualityClickCallReturnedOffsetMs: number;
  qualityPressedAssertionCompletedOffsetMs: number;
  returnTimerCallReturnedOffsetMs: number;
  timerVisibilityAssertionCompletedOffsetMs: number;
  qualityProjectionOffsetMs: number;
  visibleFrameOffsetMs: number;
  visibleFrameLatencyMs: number;
  automationPollMs: number;
  twoNativeRafMs: number;
  actionEndCallOverheadMs: number;
  rendererGenerationBefore: number;
  rendererGenerationAfter: number;
  atlasInstanceBefore: number | null;
  atlasInstanceAfter: number | null;
}

const lifecycleSourceFiles = [
  '../../apps/web/src/WorldCanvasV7.tsx',
  '../../apps/web/src/resource-pack-selection.ts',
  '../../apps/web/src/renderer-generation.ts',
  '../../apps/web/src/renderer-bootstrap.ts',
  '../../apps/web/src/browser-adapters.ts',
  '../../apps/web/src/App.tsx',
  '../../apps/web/src/main.tsx',
  '../../apps/web/src/world-projection.ts',
  '../../packages/application/src/application-service.ts',
  '../../packages/application/src/model.ts',
  '../../apps/web/src/quality-lifecycle-performance.ts',
  '../../packages/voxel/src/renderer.ts',
  '../../packages/voxel/src/quality.ts',
  '../../packages/voxel/src/quality-projection.ts',
  '../../packages/voxel/src/lighting-postprocess.ts',
  '../../packages/voxel/src/quality-lifecycle-probe.ts',
  '../../packages/voxel/src/quality-lifecycle-world-identity.ts',
  '../../packages/resource-pack-indexeddb/src/index.ts',
  '../../packages/resource-pack-indexeddb/test/repository.test.ts',
  '../../packages/voxel/test/lighting-postprocess.test.ts',
  '../../apps/web/tests/quality-hot-switch.diagnostic.spec.ts',
  '../../packages/storage-indexeddb/src/repository.ts',
  '../../packages/domain/src/domain.ts',
  'playwright.diagnostics.config.ts',
  'tests/fixed-business-date.ts',
  'tests/persisted-domain-state.ts',
  'tests/quality-lifecycle.diagnostic.spec.ts',
] as const;

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolvePromise);
  });
  return hash.digest('hex');
}

async function sourceFingerprint(): Promise<string> {
  const hash = createHash('sha256');
  for (const sourceFile of lifecycleSourceFiles) {
    const bytes = await readFile(resolve(process.cwd(), sourceFile));
    hash.update(bytes);
  }
  return hash.digest('hex');
}

async function readProbe(page: Page): Promise<QualitySnapshot | null> {
  return page.evaluate(() => (window as unknown as ProbeWindow).__blockcolcQualityLifecycle?.read() ?? null);
}

async function readElapsed(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as ProbeWindow).__blockcolcQualityLifecycle?.read().elapsedMs ?? 0);
}

async function readClickTrace(page: Page): Promise<QualityClickTrace> {
  return page.evaluate(() => (window as unknown as ProbeWindow).__blockcolcQualityClickTrace ?? { events: [], overflowCount: 0 });
}

async function waitForCurrentVisibleQualityFrame(
  page: Page, actionIndex: number, preference: Preference, expectedWorldIdentityFingerprint: number,
) {
  const matched: { value: { projection: QualitySnapshot['operations'][number]['phases'][number]; frame: QualitySnapshot['operations'][number]['phases'][number]; elapsedMs: number } | null } = { value: null };
  await expect.poll(async () => {
    const currentGeneration = Number(await page.getByLabel('项目建筑世界').getAttribute('data-renderer-generation'));
    const currentAtlasPageCount = Number(await page.getByLabel('项目建筑世界').getAttribute('data-atlas-page-count'));
    const snapshot = await readProbe(page);
    const operation = [...(snapshot?.operations ?? [])].reverse().find(item => item.kind === 'quality-pair');
    const phases = operation?.phases.filter(phase => phase.actionIndex === actionIndex) ?? [];
    const projection = [...phases].reverse().find(phase => phase.stage === 'quality-projection-complete'
      && phase.requestedPreference === preference && typeof phase.effectiveTier === 'string'
      && phase.worldIdentityFingerprint === expectedWorldIdentityFingerprint
      && phase.rendererGeneration === currentGeneration
      && typeof phase.atlasInstance === 'number' && typeof phase.atlasPageCount === 'number'
      && phase.atlasPageCount === currentAtlasPageCount);
    if (!projection) return false;
    const frame = [...phases].reverse().find(phase => phase.stage === 'visible-world-frame'
      && phase.requestedPreference === preference && phase.effectiveTier === projection.effectiveTier
      && phase.rendererGeneration === currentGeneration
      && phase.atlasInstance === projection.atlasInstance
      && phase.atlasPageCount === projection.atlasPageCount
      && phase.worldIdentityFingerprint === expectedWorldIdentityFingerprint
      && typeof phase.worldRebuildCount === 'number'
      && phase.worldRebuildCount === phase.renderedWorldRebuildCount
      && typeof phase.renderedTriangleCount === 'number' && phase.renderedTriangleCount > 0
      && phase.offsetMs >= projection.offsetMs);
    if (!frame) return false;
    matched.value = { projection, frame, elapsedMs: snapshot?.elapsedMs ?? 0 };
    return true;
  }, { timeout: 60_000, intervals: [50, 100, 250, 500] }).toBe(true);
  if (!matched.value) throw new Error('No current-generation, non-empty visible quality frame matched this action.');
  return matched.value;
}

async function readGpuSummary(page: Page): Promise<QualityGpuSummary | null> {
  return page.evaluate((normalGlObservationCounterCap) => {
    const diagnostics = (window as unknown as ProbeWindow).__blockcolcQualityGpuDiagnostics;
    if (!diagnostics) return null;
    return {
      contextStorageCap: 24,
      contextCountCap: 128,
      glObservationCounterCap: 64,
      normalGlObservationCounterCap,
      contextCount: diagnostics.contexts.length,
      contextOverflowCount: diagnostics.contextOverflowCount,
      createdContextCount: diagnostics.createdContextCount,
      createdContextOverflowCount: diagnostics.createdContextOverflowCount,
      contextAcquisitionCount: diagnostics.contextAcquisitionCount,
      contextAcquisitionOverflowCount: diagnostics.contextAcquisitionOverflowCount,
      contextLostCount: diagnostics.contextLostCount,
      contextLostOverflowCount: diagnostics.contextLostOverflowCount,
      shaderCompileChecks: diagnostics.shaderCompileChecks,
      shaderCompileCheckOverflowCount: diagnostics.shaderCompileCheckOverflowCount,
      shaderCompileCalls: diagnostics.shaderCompileCalls,
      shaderCompileCallOverflowCount: diagnostics.shaderCompileCallOverflowCount,
      shaderCompileStatusInspection: diagnostics.shaderCompileChecks > 0
        ? 'direct-query-observed' as const : 'not-queried-on-successful-link-path' as const,
      shaderCompileFailures: diagnostics.shaderCompileFailures,
      shaderCompileOverflowCount: diagnostics.shaderCompileOverflowCount,
      programLinkChecks: diagnostics.programLinkChecks,
      programLinkCheckOverflowCount: diagnostics.programLinkCheckOverflowCount,
      programLinkFailures: diagnostics.programLinkFailures,
      programLinkOverflowCount: diagnostics.programLinkOverflowCount,
      programValidationChecks: diagnostics.programValidationChecks,
      programValidationCheckOverflowCount: diagnostics.programValidationCheckOverflowCount,
      programValidationInspection: diagnostics.programValidationChecks > 0 ? 'query-observed' as const : 'not-queried' as const,
      programValidationFailures: diagnostics.programValidationFailures,
      programValidationOverflowCount: diagnostics.programValidationOverflowCount,
      getErrorChecks: diagnostics.getErrorChecks,
      getErrorCheckOverflowCount: diagnostics.getErrorCheckOverflowCount,
      visibleFrameErrorSamples: diagnostics.visibleFrameErrorSamples,
      visibleFrameErrorSampleOverflowCount: diagnostics.visibleFrameErrorSampleOverflowCount,
      glErrors: { ...diagnostics.glErrors },
      glErrorOverflowCount: diagnostics.glErrorOverflowCount,
      glErrorUnknownCount: diagnostics.glErrorUnknownCount,
      glErrorUnknownOverflowCount: diagnostics.glErrorUnknownOverflowCount,
      contexts: diagnostics.contexts.map(({ id, gl, drawingBufferWidth, drawingBufferHeight, vendorFingerprint, rendererFingerprint, versionFingerprint, attributes }) => {
        const context = gl.deref();
        return {
          id,
          isContextLost: context ? context.isContextLost() : null,
          drawingBufferWidth,
          drawingBufferHeight,
          vendorFingerprint,
          rendererFingerprint,
          versionFingerprint,
          attributes,
        };
      }),
    };
  }, NORMAL_GL_OBSERVATION_COUNTER_CAP);
}

async function readInputSummary(page: Page, jarSha256: string, sourceSha256: string) {
  const { state, revision } = await readPersistedDomainState(page);
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const worldSettings = state.worldSettings;
  const projectFacts = state.projects.map(project => {
    const condition = state.projectConditions.find(candidate => candidate.projectId === project.id);
    const stableProject = {
      id: project.id,
      title: project.title,
      kind: project.kind,
      settlementIndex: project.settlementIndex,
      blueprintId: project.blueprintId,
      status: project.status,
      subtaskStructureLocked: project.subtaskStructureLocked,
      subtasks: project.subtasks.map(({ id, title, order, progressBasisPoints }) => ({ id, title, order, progressBasisPoints })),
      habit: project.habit,
      importedBlueprint: project.importedBlueprint,
      condition: condition ?? null,
    };
    return {
      kind: project.kind,
      settlementIndex: project.settlementIndex,
      status: project.status,
      subtaskCount: project.subtasks.length,
      subtaskProgressBasisPoints: project.subtasks.map(subtask => subtask.progressBasisPoints),
      subtaskStructureLocked: project.subtaskStructureLocked,
      habitCycleNumber: project.habit?.cycleNumber ?? null,
      habitTargetRounds: project.habit?.targetRounds ?? null,
      habitAwaitingNextBuilding: project.habit?.awaitingNextBuilding ?? null,
      buildingConditionBasisPoints: condition?.conditionBasisPoints ?? null,
      idSha256: digest(project.id),
      titleSha256: digest(project.title),
      blueprintIdSha256: digest(project.blueprintId),
      importedBlueprintSha256: project.importedBlueprint === null ? null : digest(project.importedBlueprint),
      stableFactsSha256: digest(stableProject),
    };
  });
  const projectConditionFacts = state.projectConditions.map(condition => ({
    projectIdSha256: digest(condition.projectId),
    conditionBasisPoints: condition.conditionBasisPoints,
    inactivityAnchorAt: condition.inactivityAnchorAt,
    assessedMissedPlannedDays: condition.assessedMissedPlannedDays,
  }));
  const decorationFactsSha256 = digest({
    rewards: state.decorationRewards,
    blueprints: state.decorationBlueprintResources,
    goals: state.dailyGoals.map(({ date, reachedAt }) => ({ date, reachedAt })),
    focusCompletionOwners: state.focusHistory.map(session => ({
      completedAt: session.status === 'interrupted' ? null : session.completedAt,
      projectId: session.projectId,
      status: session.status,
    })),
  });
  const worldSeed = worldSettings.worldSeed;
  const firstProjectId = state.projects[0]?.id ?? '';
  const syntheticWorldFactsSha256 = digest({
    worldSettings,
    activeProjectIdSha256: state.activeProjectId === null ? null : digest(state.activeProjectId),
    projects: projectFacts.map(({ stableFactsSha256, ...safeFacts }) => ({ ...safeFacts, stableFactsSha256 })),
    projectConditionFacts,
    decorationFactsSha256,
    buildingBlueprintResourceFactsSha256: digest(state.buildingBlueprintResources),
  });
  const persisted = {
    syntheticWorldFactsSha256,
    worldSeedSha256: createHash('sha256').update(worldSeed).digest('hex'),
    projectCount: state.projects.length,
    activeProjectKind: state.projects.find(project => project.id === state.activeProjectId)?.kind ?? 'missing',
    worldSeedDerivedFromFirstProject: state.projects.length > 0 && worldSeed === `world-${firstProjectId}`,
    firstProjectIdMatchesFixedFixture: firstProjectId === EXPECTED_WORLD_SEED.slice('world-'.length),
    worldSettings: {
      environmentStyle: worldSettings.environmentStyle,
      terrainGenerationVersion: worldSettings.terrainGenerationVersion,
    },
    projectFacts,
    repositoryRevision: revision,
  };
  const projectedWorlds = toVoxelWorlds(projectWorldState(state).projects, state);
  const worldIdentityFingerprint = qualityLifecycleWorldIdentity(
    projectedWorlds,
    worldSettings.worldSeed,
    worldSettings.environmentStyle,
    worldSettings.terrainGenerationVersion,
  );
  const world = await page.getByLabel('项目建筑世界').evaluate((element, fixedJarSha256) => {
    const canvas = element as HTMLCanvasElement;
    const number = (key: string) => {
      const value = Number(canvas.dataset[key]);
      return Number.isFinite(value) ? value : 0;
    };
    const environmentStyle = ['natural-valley', 'classic-island', 'ocean-island'].includes(canvas.dataset.environmentStyle ?? '')
      ? canvas.dataset.environmentStyle : 'unknown';
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_VENDOR_WEBGL: number; UNMASKED_RENDERER_WEBGL: number } | null;
    const fingerprint = (value: string | null | undefined) => {
      let hash = 2166136261;
      for (const character of value ?? '') hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
      return hash >>> 0;
    };
    const stableWorldFields = {
      environmentStyle,
      terrainGenerationVersion: number('terrainGenerationVersion'),
      terrainCellCount: number('terrainCellCount'),
      naturalTreeCount: number('naturalTreeCount'),
      waterTriangleCount: number('terrainWaterTriangles'),
      nearCellCount: number('terrainNearCellCount'),
      middleCellCount: number('terrainMiddleCellCount'),
      farCellCount: number('terrainFarCellCount'),
      oceanIsletCount: number('oceanIsletCount'),
      texturedVoxelCount: number('texturedVoxelCount'),
    };
    const lifecycleValues = {
      atlasPageCount: number('atlasPageCount'),
      rendererGeneration: number('rendererGeneration'),
      worldRebuildCount: number('worldRebuildCount'),
    };
    const webglVersion = gl?.getParameter(gl.VERSION) as string | null | undefined;
    const userAgent = navigator.userAgent;
    return {
      stableWorldFields,
      lifecycleValues,
      width: window.innerWidth,
      height: window.innerHeight,
      screenWidth: screen.width,
      screenHeight: screen.height,
      devicePixelRatio: window.devicePixelRatio,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      userAgentFingerprint: fingerprint(userAgent),
      gpuVendorFingerprint: debug && gl ? fingerprint(String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL))) : 0,
      gpuRendererFingerprint: debug && gl ? fingerprint(String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL))) : 0,
      webglVersionFingerprint: fingerprint(webglVersion),
      activePackMatchesFixedJar: canvas.dataset.activeResourcePackId === `sha256:${fixedJarSha256}`,
    };
  }, jarSha256);
  const geometryFingerprint = createHash('sha256').update(JSON.stringify(world.stableWorldFields)).digest('hex');
  const worldProjectionFingerprint = createHash('sha256').update(JSON.stringify({
    syntheticWorldFactsSha256: persisted.syntheticWorldFactsSha256,
    stableWorldGeometrySha256: geometryFingerprint,
  })).digest('hex');
  const browser = page.context().browser();
  const browserVersion = browser?.version() ?? 'unknown';
  const browserMajorVersion = Number.parseInt(browserVersion.split('.')[0] ?? '', 10) || 0;
  return {
    documentStartKind: 'new-document-and-renderer-only',
    businessDateEpochMs: BUSINESS_EPOCH,
    qualityControlFixture: { initialRequestedPreference: 'balanced', measuredPreferenceSequence: ['performance', 'balanced'] },
    jarBytes: CLIENT_JAR_BYTES,
    jarSha256,
    baseSource: 'fixed-26.3-client-jar',
    activeSource: 'original-materials',
    activePackMatchesFixedJar: world.activePackMatchesFixedJar,
    syntheticWorldFactsSha256: persisted.syntheticWorldFactsSha256,
    worldSeedSha256: persisted.worldSeedSha256,
    persistedRepositoryRevision: persisted.repositoryRevision,
    projectCount: persisted.projectCount,
    activeProjectKind: persisted.activeProjectKind,
    worldSeedDerivedFromFirstProject: persisted.worldSeedDerivedFromFirstProject,
    firstProjectIdMatchesFixedFixture: persisted.firstProjectIdMatchesFixedFixture,
    persistedWorldSettings: persisted.worldSettings,
    persistedProjectFacts: persisted.projectFacts,
    worldIdentityFingerprint,
    worldProjectionFingerprint,
    geometryFingerprint,
    stableWorldFields: world.stableWorldFields,
    lifecycleValues: world.lifecycleValues,
    sourceFingerprintSha256: sourceSha256,
    machine: { platform: process.platform, architecture: process.arch, logicalCpuCount: cpus().length, memoryBytes: totalmem() },
    browser: { engine: browser?.browserType().name() ?? 'unknown', project: 'diagnostic-mobile-chromium', majorVersion: browserMajorVersion },
    gpu: { vendorFingerprint: world.gpuVendorFingerprint, rendererFingerprint: world.gpuRendererFingerprint, webglVersionFingerprint: world.webglVersionFingerprint },
    viewport: {
      width: world.width, height: world.height, screenWidth: world.screenWidth, screenHeight: world.screenHeight,
      devicePixelRatio: world.devicePixelRatio, reducedMotion: world.reducedMotion,
    },
  };
}

async function installBoundedPageDiagnostics(page: Page) {
  await page.addInitScript(({ errorCap, normalCounterCap, clickCap, contextCap, contextCountCap }) => {
    let uuidCounter = 0;
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      value: () => {
        uuidCounter += 1;
        return `00000000-0000-4000-8000-${uuidCounter.toString(16).padStart(12, '0')}`;
      },
    });
    const w = window as unknown as ProbeWindow;
    const clicks: QualityClickTrace = { events: [], overflowCount: 0 };
    w.__blockcolcQualityClickTrace = clicks;
    if (sessionStorage.getItem('blockcolc-quality-lifecycle-arm') === '1') {
      sessionStorage.removeItem('blockcolc-quality-lifecycle-arm');
      w.__blockcolcQualityLifecyclePageStartAt = performance.now();
    }
    document.addEventListener('click', event => {
      const button = (event.target as Element | null)?.closest('button');
      if (button?.textContent?.trim() === '开始建造') {
        // The real application materializes the project ID before its three
        // subtask IDs. Anchor that command boundary to UUID #4 regardless of
        // unrelated React draft-row UUID calls during development rendering.
        uuidCounter = 3;
      }
      if (!button || !button.closest('[role="group"][aria-label="光影质量"]')) return;
      const text = button.textContent?.trim();
      const preference: Preference | null = text === '流畅' ? 'performance' : text === '均衡' ? 'balanced' : null;
      if (!preference) return;
      const snapshot = w.__blockcolcQualityLifecycle?.read();
      const operationIndex = (snapshot?.operations.length ?? 0) - 1;
      const operation = snapshot?.operations[operationIndex];
      const actionIndex = (operation?.actions.length ?? 0) - 1;
      const action = operation?.actions[actionIndex];
      if (operation?.kind !== 'quality-pair' || action?.result !== 'pending' || action.requestedPreference !== preference) return;
      if (clicks.events.length >= clickCap) { clicks.overflowCount += 1; return; }
      clicks.events.push({ operationIndex, actionIndex, preference, offsetMs: snapshot?.elapsedMs ?? 0 });
    }, true);

    const anomalyCap = errorCap;
    const gpu: QualityGpuDiagnostics = {
      contexts: [], contextOverflowCount: 0,
      createdContextCount: 0, createdContextOverflowCount: 0,
      contextAcquisitionCount: 0, contextAcquisitionOverflowCount: 0,
      contextLostCount: 0, contextLostOverflowCount: 0,
      shaderCompileChecks: 0, shaderCompileCheckOverflowCount: 0,
      shaderCompileCalls: 0, shaderCompileCallOverflowCount: 0,
      shaderCompileFailures: 0, shaderCompileOverflowCount: 0,
      programLinkChecks: 0, programLinkCheckOverflowCount: 0,
      programLinkFailures: 0, programLinkOverflowCount: 0,
      programValidationChecks: 0, programValidationCheckOverflowCount: 0,
      programValidationFailures: 0, programValidationOverflowCount: 0,
      getErrorChecks: 0, getErrorCheckOverflowCount: 0,
      visibleFrameErrorSamples: 0, visibleFrameErrorSampleOverflowCount: 0,
      glErrors: { 1280: 0, 1281: 0, 1282: 0, 1285: 0, 1286: 0, 37442: 0 },
      glErrorOverflowCount: 0, glErrorUnknownCount: 0, glErrorUnknownOverflowCount: 0,
      sampleVisibleFrameError(gl) {
        if (gpu.visibleFrameErrorSamples >= anomalyCap) {
          gpu.visibleFrameErrorSampleOverflowCount += 1;
          return;
        }
        gpu.visibleFrameErrorSamples += 1;
        gl.getError();
      },
    };
    w.__blockcolcQualityGpuDiagnostics = gpu;
    const contextIds = new WeakMap<WebGLRenderingContext | WebGL2RenderingContext, number>();
    let nextContextId = 1;
    const increment = (field: string, overflowField: string, limit = normalCounterCap) => {
      const counters = gpu as unknown as Record<string, number>;
      if (counters[field]! < limit) counters[field] = counters[field]! + 1;
      else counters[overflowField] = counters[overflowField]! + 1;
    };
    const fingerprint = (value: string) => {
      let hash = 2166136261;
      for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
      return hash >>> 0;
    };
    const count = (field: 'shaderCompileFailures' | 'programLinkFailures' | 'programValidationFailures') => {
      const overflowField = field === 'shaderCompileFailures' ? 'shaderCompileOverflowCount'
        : field === 'programLinkFailures' ? 'programLinkOverflowCount' : 'programValidationOverflowCount';
      if (gpu[field] < anomalyCap) gpu[field] += 1;
      else gpu[overflowField] += 1;
    };
    const rememberContext = (canvas: HTMLCanvasElement, gl: WebGLRenderingContext | WebGL2RenderingContext) => {
      if (contextIds.has(gl)) return;
      const id = nextContextId++;
      contextIds.set(gl, id);
      increment('createdContextCount', 'createdContextOverflowCount', contextCountCap);
      const debug = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_VENDOR_WEBGL: number; UNMASKED_RENDERER_WEBGL: number } | null;
      const attributes = gl.getContextAttributes();
      if (gpu.contexts.length < contextCap) {
        gpu.contexts.push({
          id, gl: new WeakRef(gl),
          drawingBufferWidth: gl.drawingBufferWidth,
          drawingBufferHeight: gl.drawingBufferHeight,
          vendorFingerprint: debug ? fingerprint(String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL))) : 0,
          rendererFingerprint: debug ? fingerprint(String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL))) : 0,
          versionFingerprint: fingerprint(String(gl.getParameter(gl.VERSION))),
          attributes: attributes ? {
            alpha: attributes.alpha === true,
            antialias: attributes.antialias === true,
            depth: attributes.depth === true,
            stencil: attributes.stencil === true,
            preserveDrawingBuffer: attributes.preserveDrawingBuffer === true,
          } : null,
        });
      } else gpu.contextOverflowCount += 1;
      canvas.addEventListener('webglcontextlost', () => {
        if (gpu.contextLostCount < anomalyCap) gpu.contextLostCount += 1;
        else gpu.contextLostOverflowCount += 1;
      });
    };
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof originalGetContext>) {
      if (args[0] === 'webgl' || args[0] === 'webgl2' || args[0] === 'experimental-webgl') {
        increment('contextAcquisitionCount', 'contextAcquisitionOverflowCount', contextCountCap);
      }
      const result = originalGetContext.apply(this, args);
      if (result && (args[0] === 'webgl' || args[0] === 'webgl2' || args[0] === 'experimental-webgl')) {
        rememberContext(this, result as WebGLRenderingContext | WebGL2RenderingContext);
      }
      return result;
    } as typeof HTMLCanvasElement.prototype.getContext;

    const patched = new Set<string>();
    const patch = (name: string, callback: (gl: WebGLRenderingContext | WebGL2RenderingContext, args: unknown[], result: unknown) => void) => {
      if (patched.has(name)) return;
      for (const prototype of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
        if (!descriptor || typeof descriptor.value !== 'function') continue;
        const original = descriptor.value as (...args: unknown[]) => unknown;
        Object.defineProperty(prototype, name, { ...descriptor, value: function (this: WebGLRenderingContext | WebGL2RenderingContext, ...args: unknown[]) {
          const result = original.apply(this, args);
          callback(this, args, result);
          return result;
        } });
      }
      patched.add(name);
    };
    patch('compileShader', () => {
      increment('shaderCompileCalls', 'shaderCompileCallOverflowCount');
    });
    patch('getShaderParameter', (gl, args, result) => {
      if (args[1] !== gl.COMPILE_STATUS) return;
      increment('shaderCompileChecks', 'shaderCompileCheckOverflowCount');
      if (result === false) count('shaderCompileFailures');
    });
    patch('getProgramParameter', (gl, args, result) => {
      if (args[1] === gl.LINK_STATUS) {
        increment('programLinkChecks', 'programLinkCheckOverflowCount');
        if (result === false) count('programLinkFailures');
      }
      if (args[1] === gl.VALIDATE_STATUS) {
        increment('programValidationChecks', 'programValidationCheckOverflowCount');
        if (result === false) count('programValidationFailures');
      }
    });
    patch('getError', (gl, _args, result) => {
      increment('getErrorChecks', 'getErrorCheckOverflowCount');
      const error = Number(result);
      if (!error || error === gl.NO_ERROR) return;
      if (!Object.prototype.hasOwnProperty.call(gpu.glErrors, error)) {
        if (gpu.glErrorUnknownCount < anomalyCap) gpu.glErrorUnknownCount += 1;
        else gpu.glErrorUnknownOverflowCount += 1;
        return;
      }
      const current = gpu.glErrors[error] ?? 0;
      if (current < anomalyCap) gpu.glErrors[error] = current + 1;
      else gpu.glErrorOverflowCount += 1;
    });
  }, {
    errorCap: ERROR_CAP,
    normalCounterCap: NORMAL_GL_OBSERVATION_COUNTER_CAP,
    clickCap: CLICK_CAP,
    contextCap: CONTEXT_CAP,
    contextCountCap: CONTEXT_COUNT_CAP,
  });
}

async function attachEvidence(
  testInfo: TestInfo,
  page: Page,
  evidence: { inputVerified: boolean; inputSummary: unknown; sourceFingerprintSha256: string | null; automation: QualityAutomationObservation[] },
  errors: { pageErrors: number; pageErrorOverflowCount: number; consoleErrors: number; consoleErrorOverflowCount: number; shaderErrors: number; shaderErrorOverflowCount: number },
  executionOutcome: QualityExecutionOutcome,
) {
  const snapshot = await readProbe(page).catch(() => null);
  const clickTrace = await readClickTrace(page).catch(() => null);
  const gpu = await readGpuSummary(page).catch(() => null);
  const pairOperations = snapshot?.operations.filter(operation => operation.kind === 'quality-pair') ?? [];
  function percentile95(values: Array<number | null>): number | null {
    const sorted = values.filter((value): value is number => value !== null).sort((left, right) => left - right);
    return sorted.length === 0 ? null : sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null;
  }
  function median(values: Array<number | null>): number | null {
    const sorted = values.filter((value): value is number => value !== null).sort((left, right) => left - right);
    if (sorted.length === 0) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[middle] ?? null : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  }
  const summarize = (rawSamplesMs: Array<number | null>, protocolExpectedSampleCount = rawSamplesMs.length) => {
    const measured = rawSamplesMs.filter((value): value is number => value !== null);
    return {
      rawSamplesMs,
      observedEntryCount: rawSamplesMs.length,
      expectedSampleCount: protocolExpectedSampleCount,
      measuredSampleCount: measured.length,
      missingSampleCount: Math.max(0, protocolExpectedSampleCount - measured.length),
      unmeasuredEntryCount: rawSamplesMs.length - measured.length,
      medianOfMeasuredMs: median(rawSamplesMs),
      p95OfMeasuredMs: percentile95(rawSamplesMs),
      allExpectedSamplesMeasured: protocolExpectedSampleCount > 0
        && rawSamplesMs.length === protocolExpectedSampleCount && measured.length === protocolExpectedSampleCount,
    };
  };
  const pairSamples = pairOperations.map((operation, pairIndex) => ({
    pairIndex,
    result: operation.result,
    durationMs: operation.endedAtOffsetMs === null ? null : operation.endedAtOffsetMs - operation.startedAtOffsetMs,
  }));
  const actionSamples = pairOperations.flatMap((operation, operationIndex) => operation.actions.map((action, actionIndex) => ({
    operationIndex: operationIndex + 1,
    actionIndex,
    result: action.result,
    durationMs: action.endedAtOffsetMs === null ? null : action.endedAtOffsetMs - action.startedAtOffsetMs,
  })));
  const visibleFrameLatencySamples = actionSamples.map(action => {
    const measured = evidence.automation.find(item => item.operationIndex === action.operationIndex && item.actionIndex === action.actionIndex);
    const value = measured && typeof measured.visibleFrameLatencyMs === 'number' ? measured.visibleFrameLatencyMs : null;
    return { ...action, visibleFrameLatencyMs: value };
  });
  const phaseDurationStats = Object.fromEntries(PHASE_DURATION_STAGES.map(stage => {
    const samplesByAction = actionSamples.map(action => {
      const operation = pairOperations[action.operationIndex - 1];
      const phases = operation?.phases.filter(phase => phase.actionIndex === action.actionIndex && phase.stage === stage) ?? [];
      return {
        operationIndex: action.operationIndex,
        actionIndex: action.actionIndex,
        actionResult: action.result,
        phaseObserved: phases.length > 0,
        samplesMs: phases.length === 0 ? [null] : phases.map(phase => typeof phase.durationMs === 'number' ? phase.durationMs : null),
      };
    });
    return [stage, {
      samplesByAction,
      ...summarize(samplesByAction.flatMap(sample => sample.samplesMs)),
      protocolExpectedActionCount: QUALITY_PAIRS * 2,
      observedActionCount: samplesByAction.length,
      actionsWithoutObservedPhase: samplesByAction.filter(sample => !sample.phaseObserved).length,
      allProtocolActionsHaveMeasuredPhase: samplesByAction.length === QUALITY_PAIRS * 2
        && samplesByAction.every(sample => sample.phaseObserved && sample.samplesMs.every(value => value !== null)),
    }];
  }));
  await testInfo.attach('quality-lifecycle-observations.json', {
    contentType: 'application/json',
    body: JSON.stringify({
      schemaVersion: 3,
      testOutcome: {
        status: executionOutcome,
        expectedStatus: testInfo.expectedStatus,
        failed: executionOutcome === 'failed',
      },
      inputVerified: evidence.inputVerified,
      inputSummary: evidence.inputSummary,
      sourceFingerprintSha256: evidence.sourceFingerprintSha256,
      errors,
      gl: gpu,
      clickTrace,
      automation: evidence.automation,
      summary: {
        documentStartKind: 'new-document-and-renderer-only',
        probeDeadlineMs: snapshot?.deadlineMs ?? 60_000,
        timingSemantics: 'pair/action bracket durations include UI control and waits; visible-frame latency is a separate native click-to-frame interval.',
        latencyInterpretation: 'visible-frame latency is native frame offset minus captured quality-button click offset; automation timings are separate overhead, not frame latency.',
        pairCount: pairSamples.length,
        pairSamples,
        expectedPairCount: QUALITY_PAIRS,
        pairDurationStats: summarize(pairSamples.map(sample => sample.durationMs), QUALITY_PAIRS),
        actionSamples,
        expectedActionCount: QUALITY_PAIRS * 2,
        missingActionCount: Math.max(0, QUALITY_PAIRS * 2 - actionSamples.length),
        qualityActionBracketDurationStats: summarize(actionSamples.map(sample => sample.durationMs), QUALITY_PAIRS * 2),
        visibleFrameLatencySamples,
        visibleFrameLatencyStats: summarize(visibleFrameLatencySamples.map(sample => sample.visibleFrameLatencyMs), QUALITY_PAIRS * 2),
        phaseDurationStats,
        phaseDurationMetric: 'Renderer/selection durationMs values only; absent phase or missing duration remains null in raw per-action samples.',
      },
      snapshot,
    }, null, 2),
  });
}

test('measures real-UI boot and warmed paired lighting-quality changes with bounded observations', async ({ page }, testInfo) => {
  test.setTimeout(1_200_000);
  const errors = {
    pageErrors: 0, pageErrorOverflowCount: 0,
    consoleErrors: 0, consoleErrorOverflowCount: 0,
    shaderErrors: 0, shaderErrorOverflowCount: 0,
  };
  const automation: QualityAutomationObservation[] = [];
  const evidence: { inputVerified: boolean; inputSummary: unknown; sourceFingerprintSha256: string | null; automation: QualityAutomationObservation[] } = {
    inputVerified: false, inputSummary: null, sourceFingerprintSha256: null, automation,
  };
  const shaderErrorPattern = /THREE\.WebGLProgram|shader|glsl|program.{0,24}(?:link|validat|compil)|(?:link|validat|compil).{0,24}program|webgl|gl_invalid_operation|invalid_operation|context.?lost/i;
  page.on('pageerror', error => {
    if (errors.pageErrors < ERROR_CAP) errors.pageErrors += 1;
    else errors.pageErrorOverflowCount += 1;
    if (shaderErrorPattern.test(error.message)) {
      if (errors.shaderErrors < ERROR_CAP) errors.shaderErrors += 1;
      else errors.shaderErrorOverflowCount += 1;
    }
  });
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (errors.consoleErrors < ERROR_CAP) errors.consoleErrors += 1;
    else errors.consoleErrorOverflowCount += 1;
    if (shaderErrorPattern.test(message.text())) {
      if (errors.shaderErrors < ERROR_CAP) errors.shaderErrors += 1;
      else errors.shaderErrorOverflowCount += 1;
    }
  });

  let jarSha256: string | null = null;
  let executionOutcome: QualityExecutionOutcome = 'failed';
  let executionError: unknown;
  let hasExecutionError = false;
  try {
    const clientJar = process.env.BLOCKCOLC_MC263_CLIENT_JAR;
    if (!clientJar || !existsSync(clientJar)) {
      executionOutcome = 'skipped';
      test.skip(true, 'The fixed local 26.3 client JAR input is unavailable.');
    }
    await expect(stat(clientJar!)).resolves.toMatchObject({ size: CLIENT_JAR_BYTES });
    jarSha256 = await sha256File(clientJar!);
    expect(jarSha256).toBe(CLIENT_JAR_SHA256);
    evidence.inputVerified = true;
    await fixBusinessDate(page, new Date(BUSINESS_EPOCH));
    await installBoundedPageDiagnostics(page);
    evidence.sourceFingerprintSha256 = await sourceFingerprint();

    await page.goto('/');
    await page.getByLabel('大型任务').fill('质量生命周期固定样本');
    await page.getByRole('button', { name: '开始建造', exact: true }).click();
    const canvas = page.getByLabel('项目建筑世界');
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute('data-first-nonempty-frame-ms', /\d/, { timeout: 60_000 });
    await expect(canvas).toHaveAttribute('data-initial-reveal-completed-count', '1', { timeout: 60_000 });

    await page.getByRole('button', { name: '设置', exact: true }).click();
    const quality = page.getByRole('group', { name: '光影质量' });
    await quality.getByRole('button', { name: '均衡', exact: true }).click();
    await page.getByRole('button', { name: '计时', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-requested-lighting-quality', 'balanced', { timeout: 60_000 });

    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('导入 Java 资源包 ZIP').setInputFiles(clientJar!);
    await expect(page.locator('.resource-pack-panel .backup-notice')).toContainText('已导入并启用', { timeout: 180_000 });
    const base = page.locator('.resource-pack-list li').first();
    await expect(page.locator('.resource-pack-list li')).toHaveCount(1);
    await expect(base).toContainText('外观层');
    await page.locator('.resource-pack-original').getByRole('button', { name: '使用', exact: true }).click();
    await expect(page.locator('.resource-pack-original')).toContainText('正在使用');
    await expect(base).not.toContainText('基础层');
    await page.getByRole('button', { name: '计时', exact: true }).click();
    await expect.poll(async () => {
      const activePackId = await canvas.getAttribute('data-active-resource-pack-id');
      const rendererGeneration = Number(await canvas.getAttribute('data-renderer-generation'));
      const worldRebuildCount = Number(await canvas.getAttribute('data-world-rebuild-count'));
      const renderedWorldRebuildCount = Number(await canvas.getAttribute('data-rendered-world-rebuild-count'));
      const renderedTriangles = Number(await canvas.getAttribute('data-render-triangles'));
      return activePackId === '' && rendererGeneration > 0
        && worldRebuildCount > 0 && renderedWorldRebuildCount === worldRebuildCount && renderedTriangles > 0;
    }, { timeout: 120_000 }).toBe(true);

    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.locator('.resource-pack-list li')).toHaveCount(1);
    const generationBeforeBaseSelection = Number(await canvas.getAttribute('data-renderer-generation'));
    await base.getByRole('button', { name: '设为基础', exact: true }).click();
    await expect(base).toContainText('基础层');
    await page.getByRole('button', { name: '计时', exact: true }).click();
    await expect.poll(async () => {
      const activePackId = await canvas.getAttribute('data-active-resource-pack-id');
      const atlasPageCount = Number(await canvas.getAttribute('data-atlas-page-count'));
      const rendererGeneration = Number(await canvas.getAttribute('data-renderer-generation'));
      const worldRebuildCount = Number(await canvas.getAttribute('data-world-rebuild-count'));
      const renderedWorldRebuildCount = Number(await canvas.getAttribute('data-rendered-world-rebuild-count'));
      const renderedTriangles = Number(await canvas.getAttribute('data-render-triangles'));
      return activePackId === `sha256:${CLIENT_JAR_SHA256}` && atlasPageCount > 0
        && rendererGeneration === generationBeforeBaseSelection
        && worldRebuildCount > 0 && renderedWorldRebuildCount === worldRebuildCount && renderedTriangles > 0;
    }, { timeout: 120_000 }).toBe(true);
    // Base adoption replaces the atlas in the resident generation. It must not
    // replay the initial reveal or create a new renderer generation.

    // A reload is only a new document/renderer run. Same profile, IndexedDB
    // world and selected 26.3 base; it is not an OS/browser-process cold start.
    await page.evaluate(() => sessionStorage.setItem('blockcolc-quality-lifecycle-arm', '1'));
    await page.reload();
    await expect(canvas).toHaveAttribute('data-first-nonempty-frame-ms', /\d/, { timeout: 120_000 });
    await expect(canvas).toHaveAttribute('data-initial-reveal-completed-count', '1', { timeout: 120_000 });
    await expect(canvas).toHaveAttribute('data-requested-lighting-quality', 'balanced');
    const nativeClockElapsedMs = await page.evaluate(async () => {
      const started = performance.now();
      await new Promise<void>(resolvePromise => requestAnimationFrame(() => resolvePromise()));
      return performance.now() - started;
    });
    expect(nativeClockElapsedMs).toBeGreaterThan(0);
    expect((await readGpuSummary(page))?.contextOverflowCount).toBe(0);

    await expect.poll(async () => (await readProbe(page))?.operations[0]?.result, { timeout: 60_000 }).toBe('completed');
    const boot = await readProbe(page);
    expect(boot?.operations[0]).toMatchObject({ kind: 'boot', result: 'completed' });
    expect(boot?.overflowCount).toEqual({ operations: 0, actions: 0, phases: 0 });
    const inputSummary = await readInputSummary(page, jarSha256!, evidence.sourceFingerprintSha256!);
    evidence.inputSummary = inputSummary;
    expect(inputSummary.activePackMatchesFixedJar).toBe(true);
    expect(inputSummary.projectCount).toBe(1);
    expect(inputSummary.activeProjectKind).toBe('finite');
    expect(inputSummary.worldSeedDerivedFromFirstProject).toBe(true);
    expect(inputSummary.firstProjectIdMatchesFixedFixture).toBe(true);
    expect(inputSummary.persistedWorldSettings).toEqual({ environmentStyle: 'natural-valley', terrainGenerationVersion: 4 });
    expect(inputSummary.worldProjectionFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(inputSummary.syntheticWorldFactsSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(inputSummary.worldSeedSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(inputSummary.worldSeedSha256).toBe(createHash('sha256').update(EXPECTED_WORLD_SEED).digest('hex'));
    expect(Number.isInteger(inputSummary.worldIdentityFingerprint)).toBe(true);
    expect(inputSummary.lifecycleValues.rendererGeneration).toBeGreaterThan(0);
    await expect(canvas).toHaveAttribute('data-requested-lighting-quality', 'balanced');

    for (let pair = 0; pair < QUALITY_PAIRS; pair += 1) {
      const operationIndex = await page.evaluate(() =>
        (window as unknown as ProbeWindow).__blockcolcQualityLifecycle?.beginOperation('quality-pair') ?? null);
      expect(operationIndex).not.toBeNull();
      for (const preference of ['performance', 'balanced'] as const) {
        await page.getByRole('button', { name: '设置', exact: true }).click();
        const measuredQuality = page.getByRole('group', { name: '光影质量' });
        const oldSnapshot = await readProbe(page);
        const actionIndex = await page.evaluate(value =>
          (window as unknown as ProbeWindow).__blockcolcQualityLifecycle?.beginAction(value) ?? null, preference);
        expect(actionIndex).not.toBeNull();
        const actionSnapshot = await readProbe(page);
        const action = actionSnapshot?.operations[operationIndex!]?.actions[actionIndex!];
        if (!action) throw new Error('Tracker did not retain the started quality action.');
        const rendererGenerationBefore = Number(await canvas.getAttribute('data-renderer-generation')) || 0;
        const phasesBefore = oldSnapshot?.operations.flatMap(item => item.phases) ?? [];
        const previousVisible = [...phasesBefore].reverse().find(phase => phase.stage === 'visible-world-frame'
          && phase.rendererGeneration === rendererGenerationBefore);
        const atlasInstanceBefore = typeof previousVisible?.atlasInstance === 'number' ? previousVisible.atlasInstance : null;

        await measuredQuality.getByRole('button', { name: preference === 'performance' ? '流畅' : '均衡', exact: true }).click();
        const qualityClickCallReturnedOffsetMs = await readElapsed(page);
        await expect(measuredQuality.getByRole('button', { name: preference === 'performance' ? '流畅' : '均衡', exact: true })).toHaveAttribute('aria-pressed', 'true');
        const qualityPressedAssertionCompletedOffsetMs = await readElapsed(page);
        await expect(canvas).toHaveAttribute('data-requested-lighting-quality', preference, { timeout: 60_000 });
        await page.getByRole('button', { name: '计时', exact: true }).click();
        const returnTimerCallReturnedOffsetMs = await readElapsed(page);
        await expect(canvas).toBeVisible();
        const timerVisibilityAssertionCompletedOffsetMs = await readElapsed(page);
        const matched = await waitForCurrentVisibleQualityFrame(
          page, actionIndex!, preference, inputSummary.worldIdentityFingerprint,
        );
        const automationPollMs = Math.max(0, matched.elapsedMs - timerVisibilityAssertionCompletedOffsetMs);
        const twoRafStartedOffsetMs = await readElapsed(page);
        await page.evaluate(() => new Promise<void>(resolvePromise => requestAnimationFrame(() => requestAnimationFrame(() => resolvePromise()))));
        const twoRafCompletedOffsetMs = await readElapsed(page);
        const actionEndCallStartOffsetMs = await readElapsed(page);
        await page.evaluate(() => (window as unknown as ProbeWindow).__blockcolcQualityLifecycle?.endAction('completed'));
        const actionEndCallCompletedOffsetMs = await readElapsed(page);
        const actualClick = (await readClickTrace(page)).events.find(event =>
          event.operationIndex === operationIndex && event.actionIndex === actionIndex && event.preference === preference);
        if (!actualClick) throw new Error('No bounded native click timestamp matched the requested quality action.');
        const { projection, frame } = matched;
        automation.push({
          operationIndex: operationIndex!,
          actionIndex: actionIndex!,
          preference,
          actionStartOffsetMs: action.startedAtOffsetMs,
          clickOffsetMs: actualClick.offsetMs,
          qualityClickCallReturnedOffsetMs,
          qualityPressedAssertionCompletedOffsetMs,
          returnTimerCallReturnedOffsetMs,
          timerVisibilityAssertionCompletedOffsetMs,
          qualityProjectionOffsetMs: projection.offsetMs,
          visibleFrameOffsetMs: frame.offsetMs,
          visibleFrameLatencyMs: frame.offsetMs - actualClick.offsetMs,
          automationPollMs,
          twoNativeRafMs: twoRafCompletedOffsetMs - twoRafStartedOffsetMs,
          actionEndCallOverheadMs: actionEndCallCompletedOffsetMs - actionEndCallStartOffsetMs,
          rendererGenerationBefore,
          rendererGenerationAfter: Number(await canvas.getAttribute('data-renderer-generation')) || 0,
          atlasInstanceBefore,
          atlasInstanceAfter: typeof frame.atlasInstance === 'number' ? frame.atlasInstance : null,
        });
        expect(Number(await canvas.getAttribute('data-renderer-generation')) || 0).toBe(rendererGenerationBefore);
        expect(typeof frame.atlasInstance === 'number' ? frame.atlasInstance : null).toBe(atlasInstanceBefore);
        const actionPhases = (await readProbe(page))?.operations[operationIndex!]?.phases
          .filter(phase => phase.actionIndex === actionIndex) ?? [];
        expect(actionPhases.filter(phase => ['manifest-layer-end', 'atlas-build-complete', 'atlas-disposed', 'world-rebuild-complete']
          .includes(phase.stage))).toHaveLength(0);
        expect(actionPhases.filter(phase => phase.stage === 'selection-read-end')).toHaveLength(0);
        expect(actionPhases.filter(phase => phase.stage === 'selection-metadata-read-end').length).toBeGreaterThan(0);
      }
      await page.evaluate(() => (window as unknown as ProbeWindow).__blockcolcQualityLifecycle?.endOperation('completed'));
    }
    const result = await readProbe(page);
    const clickTrace = await readClickTrace(page);
    expect(clickTrace.overflowCount).toBe(0);
    expect(clickTrace.events).toHaveLength(QUALITY_PAIRS * 2);
    expect(result?.status).toBe('recording');
    expect(result?.overflowCount).toEqual({ operations: 0, actions: 0, phases: 0 });
    expect(result?.operations).toHaveLength(1 + QUALITY_PAIRS);
    for (const operation of result?.operations.slice(1) ?? []) {
      expect(operation).toMatchObject({ kind: 'quality-pair', result: 'completed' });
      expect(operation.actions).toHaveLength(2);
      expect(operation.actions.every(action => action.result === 'completed')).toBe(true);
      expect(operation.phases.length).toBeLessThanOrEqual(16);
      expect(operation.omittedRedundantPhaseCount).toBeGreaterThanOrEqual(0);
      for (const actionIndex of [0, 1]) {
        const phases = operation.phases.filter(phase => phase.actionIndex === actionIndex);
        const projection = [...phases].reverse().find(phase => phase.stage === 'quality-projection-complete');
        const frame = [...phases].reverse().find(phase => phase.stage === 'visible-world-frame');
        expect(projection).toBeDefined();
        expect(frame).toBeDefined();
        expect(projection?.requestedPreference).toBe(operation.actions[actionIndex]?.requestedPreference);
        expect(frame?.requestedPreference).toBe(projection?.requestedPreference);
        expect(frame?.effectiveTier).toBe(projection?.effectiveTier);
        expect(frame?.rendererGeneration).toBe(projection?.rendererGeneration);
        expect(frame?.atlasInstance).toBe(projection?.atlasInstance);
        expect(frame?.atlasPageCount).toBe(projection?.atlasPageCount);
        expect(frame?.worldRebuildCount).toBe(frame?.renderedWorldRebuildCount);
        expect(frame?.renderedTriangleCount).toBeGreaterThan(0);
        expect(projection?.worldIdentityFingerprint).toBe(inputSummary.worldIdentityFingerprint);
        expect(frame?.worldIdentityFingerprint).toBe(inputSummary.worldIdentityFingerprint);
        expect(frame?.offsetMs).toBeGreaterThanOrEqual(projection?.offsetMs ?? Number.POSITIVE_INFINITY);
      }
      expect(operation.phases.filter(phase => phase.stage === 'selection-read-end')).toHaveLength(0);
      expect(operation.phases.filter(phase => phase.stage === 'selection-metadata-read-end').length).toBeGreaterThan(0);
      expect(operation.phases.filter(phase => ['manifest-layer-end', 'atlas-build-complete', 'atlas-disposed', 'world-rebuild-complete']
        .includes(phase.stage))).toHaveLength(0);
    }
    expect(result?.operations[0]?.phases.filter(phase => phase.stage === 'selection-read-end').length).toBeGreaterThan(0);
    expect(errors).toEqual({ pageErrors: 0, pageErrorOverflowCount: 0, consoleErrors: 0, consoleErrorOverflowCount: 0, shaderErrors: 0, shaderErrorOverflowCount: 0 });
    const gpu = await readGpuSummary(page);
    expect(gpu).not.toBeNull();
    expect(gpu?.contextStorageCap).toBe(CONTEXT_CAP);
    expect(gpu?.contextCountCap).toBe(CONTEXT_COUNT_CAP);
    expect(gpu?.glObservationCounterCap).toBe(ERROR_CAP);
    expect(gpu?.normalGlObservationCounterCap).toBe(NORMAL_GL_OBSERVATION_COUNTER_CAP);
    expect(gpu?.contextCount).toBeLessThanOrEqual(CONTEXT_CAP);
    expect(gpu?.createdContextCount).toBeGreaterThan(0);
    expect(gpu?.contextAcquisitionCount).toBeGreaterThan(0);
    expect(gpu?.contextOverflowCount).toBe(0);
    expect(gpu?.createdContextOverflowCount).toBe(0);
    expect(gpu?.contextAcquisitionOverflowCount).toBe(0);
    expect(gpu?.contextLostCount).toBe(0);
    expect(gpu?.contextLostOverflowCount).toBe(0);
    expect(gpu?.shaderCompileCalls).toBeGreaterThan(0);
    expect(gpu?.shaderCompileCallOverflowCount).toBe(0);
    // Three only queries COMPILE_STATUS on its failure path; a successful
    // link is normal-path compile evidence, so status checks may be zero.
    expect(gpu?.shaderCompileCheckOverflowCount).toBe(0);
    expect(gpu?.shaderCompileStatusInspection).toBe(gpu?.shaderCompileChecks ? 'direct-query-observed' : 'not-queried-on-successful-link-path');
    expect(gpu?.shaderCompileFailures).toBe(0);
    expect(gpu?.shaderCompileOverflowCount).toBe(0);
    expect(gpu?.programLinkChecks).toBeGreaterThan(0);
    expect(gpu?.programLinkCheckOverflowCount).toBe(0);
    expect(gpu?.programLinkFailures).toBe(0);
    expect(gpu?.programLinkOverflowCount).toBe(0);
    // VALIDATE_STATUS is optional on the production path; queried failures
    // remain fatal and the raw number of checks is attached.
    expect(gpu?.programValidationCheckOverflowCount).toBe(0);
    expect(gpu?.programValidationInspection).toBe(gpu?.programValidationChecks ? 'query-observed' : 'not-queried');
    expect(gpu?.programValidationFailures).toBe(0);
    expect(gpu?.programValidationOverflowCount).toBe(0);
    expect(gpu?.getErrorChecks).toBeGreaterThan(0);
    expect(gpu?.getErrorCheckOverflowCount).toBe(0);
    expect(gpu?.visibleFrameErrorSamples).toBeGreaterThan(0);
    expect(gpu?.visibleFrameErrorSampleOverflowCount).toBe(0);
    expect(gpu?.glErrorOverflowCount).toBe(0);
    expect(gpu?.glErrorUnknownCount).toBe(0);
    expect(gpu?.glErrorUnknownOverflowCount).toBe(0);
    expect(Object.values(gpu?.glErrors ?? {}).every(count => count === 0)).toBe(true);
    expect(gpu?.contexts.every(context => context.isContextLost !== true)).toBe(true);
    executionOutcome = 'completed';
  } catch (error) {
    if (executionOutcome !== 'skipped') executionOutcome = 'failed';
    executionError = error;
    hasExecutionError = true;
  } finally {
    try {
      await attachEvidence(testInfo, page, evidence, errors, executionOutcome);
    } catch (attachmentError) {
      if (hasExecutionError) {
        throw new AggregateError([executionError, attachmentError], 'The test and its evidence attachment both failed.');
      }
      throw attachmentError;
    }
  }
  if (hasExecutionError) throw executionError;
});
