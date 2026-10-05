import { expect, test, type Locator, type Page } from '@playwright/test';
import { chooseDebugWeather } from './world-debug-controls';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { syntheticFlowerPack } from './synthetic-flower-pack';
import { fixBusinessDate } from './fixed-business-date';

type ShaderDiagnosticWindow = Window & { __shaderDiagnosticStage?: string; __shaderDiagnostic?: unknown };
const EVENT_CAP = 1024;
const CONTEXT_CAP = 8;
const CONSOLE_ERROR_CAP = 64;
const LOG_CAP = 1000;
const SOURCE_EXCERPT_CAP = 512;

async function pinch(page: Page, canvas: Locator, inward: boolean) {
  const bounds = (await canvas.boundingBox())!;
  const center = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height * 0.6;
  const points = (distance: number) => [
    { id: 71, x: center - distance / 2, y, radiusX: 1, radiusY: 1, force: 1 },
    { id: 72, x: center + distance / 2, y, radiusX: 1, radiusY: 1, force: 1 },
  ];
  const start = inward ? 40 : 250;
  const end = inward ? 250 : 20;
  await expect.poll(() => canvas.evaluate((element, coordinates) => coordinates.every(({ x, y }) =>
    document.elementFromPoint(x, y) === element), [...points(start), ...points(end)])).toBe(true);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(start) });
    for (let step = 1; step <= 10; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(start + (end - start) * step / 10) });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await cdp.detach(); }
}

async function routeSnapshot(canvas: Locator) {
  return canvas.evaluate(element => {
    const d = (element as HTMLCanvasElement).dataset;
    return { pack: Number(d.naturalFlowerPackPlacementCount), fallback: Number(d.naturalFlowerOriginalFallbackCount),
      visibleBatches: Number(d.naturalFlowerVisibleBatchCount),
      lods: JSON.parse(d.sceneryLods ?? '[]') as { id: string; lod: string; projectedWidth: number }[],
      rebuilds: Number(d.worldRebuildCount) };
  });
}

async function expectProjectedLods(canvas: Locator) {
  await expect.poll(async () => {
    const { lods } = await routeSnapshot(canvas);
    return lods.length > 0 && lods.every(o => o.projectedWidth < 30 ? o.lod === 'distant'
      : o.projectedWidth > 42 ? o.lod === 'full' : true);
  }).toBe(true);
}

test('captures WebGL link, error, and context state at natural flower routing stages', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const shaderErrors: Array<{ stage: string; text: string }> = [];
  let shaderErrorOverflowCount = 0;
  let currentStage = 'playwright-bootstrap';
  page.on('console', message => {
    if (message.type() === 'error' && /THREE.WebGLProgram|shader error|INVALID_OPERATION/i.test(message.text())) {
      if (shaderErrors.length < CONSOLE_ERROR_CAP) shaderErrors.push({ stage: currentStage, text: message.text().slice(0, 2000) });
      else shaderErrorOverflowCount += 1;
    }
  });
  await page.addInitScript(() => {
    const w = window as ShaderDiagnosticWindow;
    w.__shaderDiagnosticStage = 'app-start';
    const contexts: Array<{ meta: Record<string, unknown>; gl: WebGLRenderingContext | WebGL2RenderingContext }> = [];
    const events: Array<Record<string, unknown>> = [];
    const overflowCount = { contexts: 0, events: 0 };
    const recordEvent = (event: Record<string, unknown>) => {
      if (events.length < 1024) events.push(event);
      else overflowCount.events += 1;
    };
    const boundedLog = (value: string | null) => (value ?? '').slice(0, 1000);
    const sourceExcerpt = (source: string) => `${source.slice(0, 256)} … ${source.slice(-255)}`.slice(0, 512);
    const contextIds = new WeakMap<WebGLRenderingContext | WebGL2RenderingContext, number>();
    const shaderIds = new WeakMap<WebGLShader, number>();
    const programIds = new WeakMap<WebGLProgram, number>();
    let nextContextId = 0;
    let nextShaderId = 0;
    let nextProgramId = 0;
    const stage = () => w.__shaderDiagnosticStage ?? 'unstaged';
    const contextId = (gl: WebGLRenderingContext | WebGL2RenderingContext) => contextIds.get(gl) ?? -1;
    const sourceDigest = (source: string) => {
      let hash = 2166136261;
      for (let index = 0; index < source.length; index += 1) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
      return (hash >>> 0).toString(16).padStart(8, '0');
    };
    const canvasGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof canvasGetContext>) {
      const result = canvasGetContext.apply(this, args);
      if (result && (args[0] === 'webgl' || args[0] === 'webgl2' || args[0] === 'experimental-webgl')) {
        const gl = result as WebGLRenderingContext | WebGL2RenderingContext;
        if (!contextIds.has(gl)) {
          const id = ++nextContextId;
          contextIds.set(gl, id);
          const attributes = gl.getContextAttributes();
          const debug = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_VENDOR_WEBGL: number; UNMASKED_RENDERER_WEBGL: number } | null;
          if (contexts.length < 8) contexts.push({ gl, meta: {
            id, requestedType: args[0], className: this.className, ariaLabel: this.getAttribute('aria-label'),
            width: this.width, height: this.height, attributes,
            version: gl.getParameter(gl.VERSION), shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
            vendor: gl.getParameter(gl.VENDOR), renderer: gl.getParameter(gl.RENDERER),
            unmaskedVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
            unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
          } });
          else overflowCount.contexts += 1;
          this.addEventListener('webglcontextlost', (event: Event) => recordEvent({ stage: stage(), type: 'context-lost', id,
            at: performance.now(), preventedAtListener: (event as WebGLContextEvent).defaultPrevented,
            statusMessage: (event as WebGLContextEvent).statusMessage }));
          this.addEventListener('webglcontextrestored', () => recordEvent({ stage: stage(), type: 'context-restored', id, at: performance.now() }));
        }
      }
      return result;
    } as typeof HTMLCanvasElement.prototype.getContext;

    const patch = <T extends WebGLRenderingContext | WebGL2RenderingContext>(prototype: object, name: string,
      wrapper: (this: T, original: (...args: unknown[]) => unknown, args: unknown[]) => unknown) => {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      if (!descriptor || typeof descriptor.value !== 'function') return;
      const original = descriptor.value as (...args: unknown[]) => unknown;
      Object.defineProperty(prototype, name, { ...descriptor, value: function (this: T, ...args: unknown[]) {
        return wrapper.call(this, original.bind(this), args);
      } });
    };
    const prototypes = [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype];
    const seen = new Set<string>();
    const patchOnce = (name: string, wrapper: Parameters<typeof patch>[2]) => {
      if (seen.has(name)) return;
      for (const prototype of prototypes) {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
        if (descriptor?.value) {
          patch(prototype, name, wrapper as never);
          seen.add(name);
        }
      }
    };
    patchOnce('createShader', function (original, args) {
      const gl = this as WebGLRenderingContext | WebGL2RenderingContext;
      const shader = original(...args) as WebGLShader | null;
      if (shader) shaderIds.set(shader, ++nextShaderId);
      return shader;
    });
    patchOnce('shaderSource', function (original, args) {
      const gl = this as WebGLRenderingContext | WebGL2RenderingContext;
      const shader = args[0] as WebGLShader;
      const source = String(args[1] ?? '');
      recordEvent({ stage: stage(), type: 'shader-source', contextId: contextId(gl), shaderId: shaderIds.get(shader), shaderType: gl.getShaderParameter(shader, gl.SHADER_TYPE), length: source.length, hash: sourceDigest(source) });
      return original(...args);
    });
    patchOnce('getShaderParameter', function (original, args) {
      const gl = this as WebGLRenderingContext | WebGL2RenderingContext;
      const shader = args[0] as WebGLShader;
      const pname = args[1] as number;
      const value = original(...args);
      if (pname === gl.COMPILE_STATUS && value === false) {
        const source = gl.getShaderSource(shader) ?? '';
        recordEvent({ stage: stage(), type: 'shader-compile-failed', at: performance.now(), contextId: contextId(gl), contextLost: gl.isContextLost(), shaderId: shaderIds.get(shader), shaderType: gl.getShaderParameter(shader, gl.SHADER_TYPE), infoLog: boundedLog(gl.getShaderInfoLog(shader)), sourceLength: source.length, sourceHash: sourceDigest(source), sourceExcerpt: sourceExcerpt(source) });
      }
      return value;
    });
    patchOnce('createProgram', function (original, args) {
      const program = original(...args) as WebGLProgram | null;
      if (program) programIds.set(program, ++nextProgramId);
      return program;
    });
    patchOnce('linkProgram', function (original, args) {
      const gl = this as WebGLRenderingContext | WebGL2RenderingContext;
      const program = args[0] as WebGLProgram;
      const result = original(...args);
      recordEvent({ stage: stage(), type: 'program-linked', contextId: contextId(gl), programId: programIds.get(program) });
      return result;
    });
    patchOnce('getProgramParameter', function (original, args) {
      const gl = this as WebGLRenderingContext | WebGL2RenderingContext;
      const program = args[0] as WebGLProgram;
      const pname = args[1] as number;
      const value = original(...args);
      if ((pname === gl.LINK_STATUS || pname === gl.VALIDATE_STATUS) && value === false) {
        const shaders = gl.getAttachedShaders(program) ?? [];
        const linkStatus = original(program, gl.LINK_STATUS);
        const validateStatus = original(program, gl.VALIDATE_STATUS);
        const activeAttributeCount = linkStatus ? original(program, gl.ACTIVE_ATTRIBUTES) as number : 0;
        recordEvent({ stage: stage(), type: pname === gl.LINK_STATUS ? 'program-link-failed' : 'program-validation-failed',
          at: performance.now(), contextId: contextId(gl), contextLost: gl.isContextLost(), programId: programIds.get(program), status: value,
          linkStatus, validateStatus,
          infoLog: boundedLog(gl.getProgramInfoLog(program)),
          activeAttributes: Array.from({ length: activeAttributeCount }, (_, index) => {
            const attribute = gl.getActiveAttrib(program, index);
            return attribute ? { name: attribute.name, type: attribute.type, size: attribute.size, location: gl.getAttribLocation(program, attribute.name) } : null;
          }),
          attachedShaders: shaders.map(shader => ({ id: shaderIds.get(shader), type: gl.getShaderParameter(shader, gl.SHADER_TYPE), compileStatus: gl.getShaderParameter(shader, gl.COMPILE_STATUS), infoLog: boundedLog(gl.getShaderInfoLog(shader)), sourceLength: gl.getShaderSource(shader)?.length ?? 0, sourceHash: sourceDigest(gl.getShaderSource(shader) ?? ''), sourceExcerpt: sourceExcerpt(gl.getShaderSource(shader) ?? '') })) });
      }
      return value;
    });
    patchOnce('getError', function (original, args) {
      const gl = this as WebGLRenderingContext | WebGL2RenderingContext;
      const error = original(...args) as number;
      if (error !== gl.NO_ERROR) recordEvent({ stage: stage(), type: 'gl-error-consumed', contextId: contextId(gl), error });
      return error;
    });
    w.__shaderDiagnostic = { contexts, events, overflowCount };
  });

  await fixBusinessDate(page, new Date('2026-09-27T12:00:00+08:00'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    let counter = 0;
    Object.defineProperty(crypto, 'randomUUID', { configurable: true,
      value: () => `00000000-0000-4000-8000-${(++counter).toString(16).padStart(12, '0')}` });
  });
  await page.goto('/');
  const mark = async (stage: string) => {
    currentStage = stage;
    await page.evaluate((value) => { (window as ShaderDiagnosticWindow).__shaderDiagnosticStage = value; }, stage);
  };
  await mark('world-start');
  await page.getByRole('button', { name: '开始建造', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('group', { name: '聚落环境', exact: true }).getByRole('button', { name: '自然山谷', exact: true }).click();
  await page.getByLabel('临时调试世界', { exact: true }).check();
  await page.getByLabel('指定时间', { exact: true }).check();
  await page.getByLabel('世界调试时间', { exact: true }).fill('12:00');
  await chooseDebugWeather(page, 'clear');
  await mark('world-without-pack-no-gesture');
  await page.getByRole('button', { name: '计时', exact: true }).click();
  const canvas = page.getByLabel('项目建筑世界');
  await expect(canvas).toHaveAttribute('data-environment-style', 'natural-valley');
  await expect(canvas).toHaveAttribute('data-first-nonempty-frame-ms', /\d/, { timeout: 20_000 });
  await page.waitForTimeout(500);
  const observations: Array<{ stage: string; route: Awaited<ReturnType<typeof routeSnapshot>> }> = [];
  observations.push({ stage: 'no-pack-no-gesture', route: await routeSnapshot(canvas) });
  await mark('world-without-pack-full-distance');
  await pinch(page, canvas, true);
  await expectProjectedLods(canvas);
  await page.waitForTimeout(250);
  observations.push({ stage: 'no-pack-full', route: await routeSnapshot(canvas) });
  await mark('world-without-pack-far-distance');
  await pinch(page, canvas, false);
  await expectProjectedLods(canvas);
  await page.waitForTimeout(250);
  observations.push({ stage: 'no-pack-far', route: await routeSnapshot(canvas) });
  for (const partial of [false, true]) {
    const packStage = partial ? 'partial-pack' : 'full-pack';
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('导入 Java 资源包 ZIP').setInputFiles({
      name: `synthetic-${partial ? 'partial' : 'full'}-flower.zip`, mimeType: 'application/zip', buffer: syntheticFlowerPack(partial),
    });
    await expect(page.locator('.resource-pack-panel .backup-notice')).toContainText('已导入并启用');
    await mark(`${packStage}-adopt`);
    await page.getByRole('button', { name: '计时', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-active-resource-pack-id', /^sha256:/);
    await expect.poll(() => canvas.getAttribute('data-natural-flower-pack-placement-count'), { timeout: 20_000 }).not.toBe('0');
    await pinch(page, canvas, true);
    await expectProjectedLods(canvas);
    observations.push({ stage: `${packStage}-full`, route: await routeSnapshot(canvas) });
    await mark(`${packStage}-far`);
    await pinch(page, canvas, false);
    await expectProjectedLods(canvas);
    observations.push({ stage: `${packStage}-far`, route: await routeSnapshot(canvas) });
    await pinch(page, canvas, true);
    await expectProjectedLods(canvas);
  }
  await mark('restore-original-pack');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('.resource-pack-original').getByRole('button', { name: '使用', exact: true }).click();
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect.poll(async () => (await routeSnapshot(canvas)).pack).toBe(0);
  observations.push({ stage: 'restored-original-full', route: await routeSnapshot(canvas) });
  const report = await page.evaluate(() => {
    const w = window as ShaderDiagnosticWindow;
    const diagnostic = w.__shaderDiagnostic as { contexts: Array<{ meta: Record<string, unknown>; gl: WebGLRenderingContext | WebGL2RenderingContext }>; events: Array<Record<string, unknown>>; overflowCount: { contexts: number; events: number } };
    const finalContextState = diagnostic.contexts.map(({ meta, gl }) => {
      const pendingErrors: number[] = [];
      for (let index = 0; index < 8; index += 1) {
        const error = gl.getError();
        if (error === gl.NO_ERROR) break;
        pendingErrors.push(error);
      }
      return { ...meta, currentCanvasSize: { width: gl.canvas.width, height: gl.canvas.height },
        isContextLost: gl.isContextLost(), pendingErrors };
    });
    return { contexts: finalContextState, events: diagnostic.events, overflowCount: diagnostic.overflowCount,
      stage: w.__shaderDiagnosticStage, canvasCount: document.querySelectorAll('canvas').length };
  });
  (report as typeof report & { observations: typeof observations }).observations = observations;
  const diagnostics = { report, shaderErrors, shaderErrorOverflowCount };
  await testInfo.attach('webgl-link-route-diagnostics', { body: Buffer.from(JSON.stringify(diagnostics, null, 2)), contentType: 'application/json' });
  const evidencePath = testInfo.outputPath('webgl-link-route-diagnostics.json');
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(diagnostics, null, 2)}\n`, 'utf8');
  expect(report.overflowCount).toEqual({ contexts: 0, events: 0 });
  expect(shaderErrorOverflowCount).toBe(0);
  expect(report.contexts.length).toBeGreaterThan(0);
  expect(report.contexts.every(context => context.isContextLost === false)).toBe(true);
  expect(report.contexts.every(context => context.pendingErrors.length === 0)).toBe(true);
  expect(report.events.some(event => event.type === 'gl-error-consumed')).toBe(false);
  expect(report.events.some(event => event.type === 'context-lost' || event.type === 'context-restored')).toBe(false);
  expect(shaderErrors).toEqual([]);
  expect(report.events.some(event => event.type === 'program-link-failed' || event.type === 'program-validation-failed' || event.type === 'shader-compile-failed')).toBe(false);
});
