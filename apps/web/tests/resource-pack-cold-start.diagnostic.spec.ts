import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { expect, test, type Page } from '@playwright/test';
import { projectWorldState } from '@blockcolc/application';
import { qualityLifecycleWorldIdentity } from '../../../packages/voxel/src/quality-lifecycle-world-identity';
import { toVoxelWorlds } from '../src/world-projection';
import { fixBusinessDate } from './fixed-business-date';
import { readPersistedDomainState } from './persisted-domain-state';

const JAR_BYTES = 41_483_720;
const JAR_SHA256 = '4508d006323f24fa02876310c192d739af56516eb259000ac50f0909a68c9a2d';
const FIXED_DATE = new Date('2026-09-22T12:00:00+08:00');
const FIXED_PROJECT_ID = 'project-00000000-0000-4000-8000-000000000004';
const SAMPLE_COUNT = 5;
const CAP = 64;

interface LifecyclePhase {
  stage: string;
  offsetMs: number;
  actionIndex: number | null;
  durationMs?: number;
  worldIdentityFingerprint?: number;
  worldRebuildCount?: number;
  renderedWorldRebuildCount?: number;
  renderedTriangleCount?: number;
  rendererGeneration?: number;
  atlasInstance?: number;
  atlasPageCount?: number;
  atlasTextureCount?: number;
  status?: string;
}
interface LifecycleSnapshot {
  status: string;
  elapsedMs: number;
  deadlineMs: number;
  overflowCount: { operations: number; actions: number; phases: number };
  operations: Array<{ kind: string; result: string; phases: LifecyclePhase[] }>;
}
interface RepositorySnapshot {
  status: string;
  elapsedMs: number;
  deadlineMs: number;
  overflowCount: { requests: number; phases: number; afterDeadline: number };
  requests: Array<{
    requestId: number;
    caller: 'list' | 'getActive' | 'getBase' | 'getSelectionMetadata';
    result: string;
    phases: Array<{ stage: 'start' | 'return'; offsetMs: number; result?: string }>;
  }>;
}
interface ColdProbeWindow {
  __blockcolcQualityLifecycle?: { read(): LifecycleSnapshot };
  __blockcolcResourcePackColdStartProbe?: { read(): RepositorySnapshot; dispose(): void };
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function sha256File(path: string): Promise<string> {
  const { createReadStream } = await import('node:fs');
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function installDeterministicInputs(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let uuidCounter = 0;
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      value: () => {
        uuidCounter += 1;
        return `00000000-0000-4000-8000-${uuidCounter.toString(16).padStart(12, '0')}`;
      },
    });
    document.addEventListener('click', event => {
      const button = (event.target as Element | null)?.closest('button');
      if (button?.textContent?.trim() === '开始建造') uuidCounter = 3;
    }, true);
  });
}

async function armColdPage(page: Page): Promise<void> {
  await fixBusinessDate(page, FIXED_DATE);
  await page.addInitScript(() => {
    sessionStorage.removeItem('blockcolc-cold-start-arm');
    (window as unknown as ColdProbeWindow & { __blockcolcQualityLifecyclePageStartAt?: number })
      .__blockcolcQualityLifecyclePageStartAt = performance.now();
  });
}

async function expectedWorldIdentity(page: Page): Promise<{
  fingerprint: number;
  domainContentSha256: string;
  factsAndRevisionSha256: string;
  revision: number;
}> {
  const { state, revision } = await readPersistedDomainState(page);
  const worlds = toVoxelWorlds(projectWorldState(state).projects, state);
  return {
    fingerprint: qualityLifecycleWorldIdentity(
      worlds,
      state.worldSettings.worldSeed,
      state.worldSettings.environmentStyle,
      state.worldSettings.terrainGenerationVersion,
    ),
    domainContentSha256: createHash('sha256').update(JSON.stringify(state)).digest('hex'),
    factsAndRevisionSha256: createHash('sha256').update(JSON.stringify({ state, revision })).digest('hex'),
    revision,
  };
}

async function readStoredSelectionSummary(page: Page): Promise<{
  activeIdSha256: string | null;
  activeRecordKind: 'stored-id' | 'none';
  baseIdSha256: string | null;
  selectionRevisionSha256: string;
}> {
  const records = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('blockcolc-resource-packs-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const tx = database.transaction('metadata', 'readonly');
      const store = tx.objectStore('metadata');
      const read = (key: string) => new Promise<unknown>((resolve, reject) => {
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const [active, base, selectionRevision] = await Promise.all([
        read('active-pack'), read('base-pack'), read('selection-revision'),
      ]);
      return {
        activeId: (active as { packId?: unknown } | undefined)?.packId,
        baseId: (base as { packId?: unknown } | undefined)?.packId,
        selectionRevision: (selectionRevision as { revision?: unknown } | undefined)?.revision,
      };
    } finally { database.close(); }
  });
  expect(records.activeId === null || typeof records.activeId === 'string').toBe(true);
  expect(typeof records.baseId).toBe('string');
  expect(typeof records.selectionRevision).toBe('string');
  return {
    activeIdSha256: typeof records.activeId === 'string' ? createHash('sha256').update(records.activeId).digest('hex') : null,
    activeRecordKind: typeof records.activeId === 'string' ? 'stored-id' : 'none',
    baseIdSha256: createHash('sha256').update(records.baseId as string).digest('hex'),
    selectionRevisionSha256: createHash('sha256').update(records.selectionRevision as string).digest('hex'),
  };
}

async function collectSnapshot(page: Page, expectedFingerprint: number, browserName: string, browserVersion: string) {
  const canvas = page.getByLabel('项目建筑世界');
  await expect(canvas).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => page.evaluate((expected) => {
    const lifecycle = (window as unknown as ColdProbeWindow).__blockcolcQualityLifecycle?.read();
    const operation = lifecycle?.operations.find(candidate => candidate.kind === 'boot');
    const frame = [...(operation?.phases ?? [])].reverse().find(phase => phase.stage === 'visible-world-frame'
      && phase.worldIdentityFingerprint === expected
      && typeof phase.worldRebuildCount === 'number'
      && phase.worldRebuildCount > 0
      && phase.worldRebuildCount === phase.renderedWorldRebuildCount
      && typeof phase.renderedTriangleCount === 'number'
      && phase.renderedTriangleCount > 0
      && typeof phase.atlasPageCount === 'number'
      && phase.atlasPageCount > 0
      && typeof phase.atlasTextureCount === 'number'
      && phase.atlasTextureCount > 0);
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="项目建筑世界"]');
    return Boolean(frame && canvas
      && canvas.dataset.activeResourcePackId === `sha256:${'4508d006323f24fa02876310c192d739af56516eb259000ac50f0909a68c9a2d'}`
      && Number(canvas.dataset.worldRebuildCount) === frame.worldRebuildCount
      && Number(canvas.dataset.renderedWorldRebuildCount) === frame.renderedWorldRebuildCount
      && Number(canvas.dataset.renderTriangles) > 0);
  }, expectedFingerprint), { timeout: 120_000, intervals: [100, 250, 500, 1_000] }).toBe(true);
  await expect.poll(async () => page.evaluate(() => {
    const lifecycle = (window as unknown as ColdProbeWindow).__blockcolcQualityLifecycle?.read();
    return lifecycle?.operations.find(candidate => candidate.kind === 'boot')?.result ?? null;
  }), { timeout: 60_000, intervals: [100, 250, 500] }).toBe('completed');

  return page.evaluate(({ expected, browserName, browserVersion }) => {
    const lifecycle = (window as unknown as ColdProbeWindow).__blockcolcQualityLifecycle?.read();
    const repository = (window as unknown as ColdProbeWindow).__blockcolcResourcePackColdStartProbe?.read();
    const operation = lifecycle?.operations.find(candidate => candidate.kind === 'boot');
    const phases = operation?.phases ?? [];
    const frame = [...phases].reverse().find(phase => phase.stage === 'visible-world-frame'
      && phase.worldIdentityFingerprint === expected
      && phase.worldRebuildCount === phase.renderedWorldRebuildCount
      && (phase.renderedTriangleCount ?? 0) > 0);
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="项目建筑世界"]')!;
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    const glMaxTextureSize = gl ? Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) : null;
    const fingerprint = (value: string) => {
      let hash = 2166136261;
      for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
      return hash >>> 0;
    };
    const debug = gl?.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_VENDOR_WEBGL: number; UNMASKED_RENDERER_WEBGL: number } | null;
    const listCalls = repository?.requests.filter(request => request.caller === 'list') ?? [];
    const strictReads = repository?.requests.filter(request => ['getSelectionMetadata', 'getActive', 'getBase'].includes(request.caller)) ?? [];
    const intervalsOverlap = (left: RepositorySnapshot['requests'][number], right: RepositorySnapshot['requests'][number]) => {
      const leftStart = left.phases.find(phase => phase.stage === 'start')?.offsetMs;
      const leftEnd = left.phases.find(phase => phase.stage === 'return')?.offsetMs;
      const rightStart = right.phases.find(phase => phase.stage === 'start')?.offsetMs;
      const rightEnd = right.phases.find(phase => phase.stage === 'return')?.offsetMs;
      return leftStart !== undefined && leftEnd !== undefined && rightStart !== undefined && rightEnd !== undefined
        && Math.max(leftStart, rightStart) <= Math.min(leftEnd, rightEnd);
    };
    const overlaps = listCalls.flatMap(list => strictReads.filter(read => intervalsOverlap(list, read)).map(read => ({
      listRequestId: list.requestId,
      strictRequestId: read.requestId,
      strictMethod: read.caller,
    })));
    return {
      lifecycle,
      repository,
      validFrame: frame ?? null,
      canvas: {
        activeResourcePackId: canvas.dataset.activeResourcePackId ?? '',
        atlasPageCount: Number(canvas.dataset.atlasPageCount ?? 0),
        gpuFacingTextureCount: frame?.atlasTextureCount ?? null,
        worldRebuildCount: Number(canvas.dataset.worldRebuildCount ?? 0),
        worldRebuildStagesMs: JSON.parse(canvas.dataset.worldRebuildStagesMs ?? '{}') as Record<string, number>,
        sceneryBuildStagesMs: JSON.parse(canvas.dataset.sceneryBuildStagesMs ?? '{}') as Record<string, number>,
        terrainGenerationCacheHit: canvas.dataset.terrainGenerationCacheHit === 'true',
        renderedWorldRebuildCount: Number(canvas.dataset.renderedWorldRebuildCount ?? 0),
        triangleCount: Number(canvas.dataset.renderTriangles ?? 0),
        rendererGeneration: Number(canvas.dataset.rendererGeneration ?? 0),
        glMaxTextureSize,
      },
      environment: {
        browserName,
        browserVersion,
        userAgentFingerprint: fingerprint(navigator.userAgent),
        viewport: { width: window.innerWidth, height: window.innerHeight, screenWidth: screen.width, screenHeight: screen.height, devicePixelRatio: window.devicePixelRatio },
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        webglVersionFingerprint: gl ? fingerprint(String(gl.getParameter(gl.VERSION))) : null,
        gpuVendorFingerprint: debug && gl ? fingerprint(String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL))) : null,
        gpuRendererFingerprint: debug && gl ? fingerprint(String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL))) : null,
      },
      textureLimit: {
        requestedMaximum: 2048,
        glMaximum: glMaxTextureSize,
        effectiveMaximum: glMaxTextureSize === null ? null : Math.min(2048, glMaxTextureSize),
        queryOverridePresent: new URLSearchParams(location.search).has('__atlasPageSize'),
      },
      overlap: {
        listCallCount: listCalls.length,
        strictReadCount: strictReads.length,
        listStrictIntervals: overlaps,
        anyOverlap: overlaps.length > 0,
        interpretation: 'whole repository method wall intervals only; no internal transaction or copy/validation attribution',
      },
      initialRevealCompleteAtMs: [...phases].reverse().find(phase => phase.stage === 'initial-reveal-complete')?.offsetMs ?? null,
      probeDeadline: repository ? { elapsedMs: repository.elapsedMs, deadlineMs: repository.deadlineMs, overflowCount: repository.overflowCount } : null,
    };
  }, { expected: expectedFingerprint, browserName, browserVersion });
}

async function readStoredBaseTextureCount(page: Page): Promise<number | null> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('blockcolc-resource-packs-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<number | null>((resolve, reject) => {
        const tx = database.transaction(['resourcePacks', 'metadata'], 'readonly');
        const packs = tx.objectStore('resourcePacks');
        const metadata = tx.objectStore('metadata');
        const baseRequest = metadata.get('base-pack');
        baseRequest.onerror = () => reject(baseRequest.error);
        baseRequest.onsuccess = () => {
          const id = (baseRequest.result as { packId?: unknown } | undefined)?.packId;
          if (typeof id !== 'string') { resolve(null); return; }
          const packRequest = packs.get(id);
          packRequest.onerror = () => reject(packRequest.error);
          packRequest.onsuccess = () => {
            const manifest = (packRequest.result as { manifest?: { textures?: unknown[]; specialTextures?: unknown[] } } | undefined)?.manifest;
            resolve(Array.isArray(manifest?.textures) ? manifest.textures.length + (manifest.specialTextures?.length ?? 0) : null);
          };
        };
      });
    } finally { database.close(); }
  });
}

test('measures five default-atlas new-document boots with bounded repository overlap observations', async ({ page }, testInfo) => {
  test.setTimeout(1_200_000);
  const jarPath = process.env.BLOCKCOLC_MC263_CLIENT_JAR;
  test.skip(!jarPath || !existsSync(jarPath), 'The fixed local 26.3 client JAR input is unavailable.');
  await expect(stat(jarPath!)).resolves.toMatchObject({ size: JAR_BYTES });
  expect(await sha256File(jarPath!)).toBe(JAR_SHA256);

  await installDeterministicInputs(page);
  await fixBusinessDate(page, FIXED_DATE);
  await page.goto('/');
  await page.getByLabel('大型任务').fill('质量生命周期固定样本');
  await page.getByRole('button', { name: '开始建造', exact: true }).click();
  const canvas = page.getByLabel('项目建筑世界');
  await expect(canvas).toBeVisible();
  await expect.poll(async () => Number(await canvas.getAttribute('data-rendered-world-rebuild-count'))).toBeGreaterThan(0);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('导入 Java 资源包 ZIP').setInputFiles(jarPath!);
  await expect(page.locator('.resource-pack-panel .backup-notice')).toContainText('已导入并启用', { timeout: 180_000 });
  const basePack = page.locator('.resource-pack-list li').first();
  await expect(basePack).toContainText('外观层');
  await page.locator('.resource-pack-original').getByRole('button', { name: '使用', exact: true }).click();
  await expect(page.locator('.resource-pack-original')).toContainText('正在使用');
  await basePack.getByRole('button', { name: '设为基础', exact: true }).click();
  await expect(basePack).toContainText('基础层');
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect.poll(async () => canvas.getAttribute('data-active-resource-pack-id')).toBe(`sha256:${JAR_SHA256}`);
  const sourceTextureCount = await readStoredBaseTextureCount(page);
  expect(sourceTextureCount).toBeGreaterThan(0);
  const setupSelection = await readStoredSelectionSummary(page);
  const input = await expectedWorldIdentity(page);
  expect(input.fingerprint).toBeGreaterThan(0);
  const state = await readPersistedDomainState(page);
  expect(state.state.projects[0]?.id).toBe(FIXED_PROJECT_ID);
  expect(state.state.projects).toHaveLength(1);
  const browserContext = page.context();
  await page.close();
  const samples: Array<Record<string, unknown>> = [];
  const setupMismatches: Array<Record<string, unknown>> = [];
  const browser = browserContext.browser();
  const browserName = browser?.browserType().name() ?? 'unknown';
  const browserVersion = browser?.version() ?? 'unknown';
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const samplePage = await browserContext.newPage();
    await armColdPage(samplePage);
    await samplePage.addInitScript(() => {
      let uuidCounter = 0;
      Object.defineProperty(crypto, 'randomUUID', {
        configurable: true,
        value: () => `00000000-0000-4000-8000-${(++uuidCounter).toString(16).padStart(12, '0')}`,
      });
    });
    const errors = { pageErrors: 0, pageErrorOverflowCount: 0, consoleErrors: 0, consoleErrorOverflowCount: 0 };
    samplePage.on('pageerror', () => {
      if (errors.pageErrors < CAP) errors.pageErrors += 1;
      else errors.pageErrorOverflowCount += 1;
    });
    samplePage.on('console', message => {
      if (message.type() !== 'error') return;
      if (errors.consoleErrors < CAP) errors.consoleErrors += 1;
      else errors.consoleErrorOverflowCount += 1;
    });
    await samplePage.goto('/?__resourcePackColdStartProbe=1');
    const observation = await collectSnapshot(samplePage, input.fingerprint, browserName, browserVersion);
    // All persistence reads below deliberately happen after frame and reveal timing has been collected.
    const actualInput = await expectedWorldIdentity(samplePage);
    const actualSelection = await readStoredSelectionSummary(samplePage);
    const clockCheck = await samplePage.evaluate(() => ({
      businessDateNowMs: Date.now(),
      businessDateIso: new Date().toISOString(),
      nativePerformanceNow: /\[native code\]/.test(Function.prototype.toString.call(performance.now)),
      performanceNowMs: performance.now(),
    }));
    const domainContentMatch = actualInput.domainContentSha256 === input.domainContentSha256;
    const revisionMatch = actualInput.revision === input.revision;
    const factsAndRevisionMatch = actualInput.factsAndRevisionSha256 === input.factsAndRevisionSha256
      && revisionMatch;
    const selectionMatchesSetup = JSON.stringify(actualSelection) === JSON.stringify(setupSelection);
    if (!domainContentMatch || !factsAndRevisionMatch || !selectionMatchesSetup) {
      setupMismatches.push({
        sampleIndex: index + 1,
        domainContentMatch,
        revisionMatch,
        factsAndRevisionMatch,
        setupRevision: input.revision,
        actualRevision: actualInput.revision,
        setupDomainContentSha256: input.domainContentSha256,
        actualDomainContentSha256: actualInput.domainContentSha256,
        setupFactsAndRevisionSha256: input.factsAndRevisionSha256,
        actualFactsAndRevisionSha256: actualInput.factsAndRevisionSha256,
        selectionMatchesSetup,
        setupSelection,
        actualSelection,
      });
    }
    expect(clockCheck.businessDateNowMs).toBe(FIXED_DATE.getTime());
    expect(clockCheck.businessDateIso).toBe(FIXED_DATE.toISOString());
    expect(clockCheck.nativePerformanceNow).toBe(true);
    const repo = observation.repository as RepositorySnapshot | undefined;
    const lifecycle = observation.lifecycle as LifecycleSnapshot | undefined;
    expect(repo).toBeDefined();
    expect(lifecycle?.operations.find(candidate => candidate.kind === 'boot')?.result).toBe('completed');
    expect(lifecycle?.overflowCount).toEqual({ operations: 0, actions: 0, phases: 0 });
    expect(repo?.status).toBe('recording');
    expect(repo?.overflowCount).toEqual({ requests: 0, phases: 0, afterDeadline: 0 });
    expect(observation.validFrame).not.toBeNull();
    expect((observation.textureLimit as { queryOverridePresent: boolean }).queryOverridePresent).toBe(false);
    expect((observation.canvas as { activeResourcePackId: string }).activeResourcePackId).toBe(`sha256:${JAR_SHA256}`);
    expect(errors).toEqual({ pageErrors: 0, pageErrorOverflowCount: 0, consoleErrors: 0, consoleErrorOverflowCount: 0 });
    const sample = {
      schemaVersion: 1,
      sampleIndex: index + 1,
      documentStartKind: 'new top-level document; same Playwright browser context, IndexedDB, and browser cache; prior page closed',
      input: {
        businessDate: FIXED_DATE.toISOString(),
        jarBytes: JAR_BYTES,
        jarSha256: JAR_SHA256,
        base: 'fixed-26.3-client-jar',
        active: 'original-materials',
        projectCount: 1,
        projectIdSha256: createHash('sha256').update(FIXED_PROJECT_ID).digest('hex'),
        persistedRevision: actualInput.revision,
        persistedDomainContentSha256: actualInput.domainContentSha256,
        persistedFactsAndRevisionSha256: actualInput.factsAndRevisionSha256,
        worldIdentityFingerprint: actualInput.fingerprint,
        selection: actualSelection,
        selectionMatchesSetup,
        factsAndRevisionMatch,
        setupComparison: {
          setupRevision: input.revision,
          setupDomainContentSha256: input.domainContentSha256,
          setupFactsAndRevisionSha256: input.factsAndRevisionSha256,
          revisionMatches: revisionMatch,
          worldIdentityFingerprintMatches: actualInput.fingerprint === input.fingerprint,
        },
        sourceTextureCount,
        sourceTextureCountSource: 'setup base-manifest read; each measured page records whether its read-only base ID and selection revision still match setup; the manifest is not reread per page',
      },
      machine: { platform: process.platform, architecture: process.arch, logicalCpuCount: cpus().length, memoryBytes: totalmem() },
      measurement: observation,
      clockCheck,
      errors,
    };
    const probe = await samplePage.evaluate(() => (window as unknown as ColdProbeWindow).__blockcolcResourcePackColdStartProbe?.read() ?? null);
    await samplePage.evaluate(() => (window as unknown as ColdProbeWindow).__blockcolcResourcePackColdStartProbe?.dispose());
    samples.push(sample);
    const sampleName = `cold-default-sample-${String(index + 1).padStart(2, '0')}.json`;
    const samplePath = testInfo.outputPath(sampleName);
    await writeFile(samplePath, JSON.stringify(sample, null, 2));
    await testInfo.attach(sampleName, {
      contentType: 'application/json',
      path: samplePath,
    });
    expect(probe?.requests.length ?? 0).toBeLessThanOrEqual(8);
    await samplePage.close();
  }

  const durations = samples.map(sample => {
    const measurement = sample.measurement as { validFrame: LifecyclePhase | null };
    return measurement.validFrame?.offsetMs ?? null;
  });
  const completeDurations = durations.filter((value): value is number => value !== null);
  const final = {
    schemaVersion: 1,
    outcome: completeDurations.length === SAMPLE_COUNT ? 'complete' : 'incomplete',
    expectedSamples: SAMPLE_COUNT,
    measuredSamples: completeDurations.length,
    rawFirstValidFrameMs: durations,
    fixedFactsContractPassed: setupMismatches.length === 0,
    fixedFactsMismatchCount: setupMismatches.length,
    medianFirstValidFrameMs: completeDurations.length === SAMPLE_COUNT ? median(completeDurations) : null,
    nearestRankP95FirstValidFrameMs: completeDurations.length === SAMPLE_COUNT ? Math.max(...completeDurations) : null,
    p95Interpretation: 'nearest-rank p95 of five observations is the maximum; not a stable tail estimate',
    sourceTextureCount,
    setupBaseline: {
      persistedRevision: input.revision,
      persistedDomainContentSha256: input.domainContentSha256,
      persistedFactsAndRevisionSha256: input.factsAndRevisionSha256,
      worldIdentityFingerprint: input.fingerprint,
      selection: setupSelection,
    },
    setupMismatches,
    sourceTextureCountSource: 'setup base-manifest read; each measured page records whether its read-only base ID and selection revision still match setup; the manifest is not reread per page',
    atlasPageSize: null,
    atlasPageSizeLimitation: 'No existing test-visible surface reports CPU atlas page dimensions; no renderer or atlas API was added or instrumented.',
    reuse: 'same browser context and origin storage/cache; every measured top-level page was closed before opening the next; browser process was kept alive',
    samples,
  };
  const aggregatePath = testInfo.outputPath('cold-default-aggregate.json');
  await writeFile(aggregatePath, JSON.stringify(final, null, 2));
  await testInfo.attach('cold-default-aggregate.json', {
    contentType: 'application/json',
    path: aggregatePath,
  });
  expect(setupMismatches).toEqual([]);
  expect(final.outcome).toBe('complete');
});
