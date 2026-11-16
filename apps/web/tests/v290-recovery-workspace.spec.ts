import { expect, test, type Page } from '@playwright/test';
import { createInitialState, execute, type DomainCommand } from '@blockcolc/domain';
import { createBackupEnvelope } from '@blockcolc/storage-indexeddb';
import { executeAndReloadPersistedCommand, readPersistedDomainState } from './persisted-domain-state';
import { waitForPreparedWorld } from './world-ready';

async function openFresh(page: Page, language = 'zh-CN', themeMode = 'light') {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(({ language, themeMode }) => {
    localStorage.setItem('blockcolc-tutorial-v1', '1');
    if (!localStorage.getItem('blockcolc-focus-preferences-v1')) localStorage.setItem('blockcolc-focus-preferences-v1', JSON.stringify({ focusMinutes: 25, breakMinutes: 5, lightingQuality: 'performance', language, themeMode }));
  }, { language, themeMode });
  await page.goto('/');
  await expect(page.locator('.setup-kind button')).toHaveCount(3);
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  await expect(page.locator('html')).toHaveAttribute('data-theme', themeMode);
}

for (const language of ['zh-CN', 'en']) test(`first run restores a backup without creating a placeholder project: ${language}`, async ({ page }, info) => {
  test.setTimeout(120_000);
  await openFresh(page, language, language === 'en' ? 'dark' : 'light');
  const result = execute(createInitialState('Asia/Shanghai'), { type: 'CreateProject', projectId: 'restored-work', title: '恢复的工程', blueprintId: 'builtin-small-workshop', subtasks: [{ id: 'restored-task', title: '继续施工' }] }, { now: () => new Date('2026-10-23T08:00:00Z') });
  if (!result.ok) throw Error(result.message);
  const backup = Buffer.from(JSON.stringify(await createBackupEnvelope(result.state, new Date('2026-10-23T08:00:00Z'))));
  await page.locator('.setup-kind [data-value="restore"]').click();
  await expect(page.locator('.setup-submit')).toHaveCount(0);
  await page.locator('.setup form').evaluate(form => (form as HTMLFormElement).requestSubmit());
  expect((await readPersistedDomainState(page)).state.projects).toHaveLength(0);
  const file = page.locator('.setup-backup input[type="file"]');
  await file.setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(page.getByRole('alert')).toBeVisible();
  expect((await readPersistedDomainState(page)).state.projects).toHaveLength(0);
  await file.setInputFiles({ name: 'world.json', mimeType: 'application/json', buffer: backup });
  await expect(page.locator('.import-preview')).toContainText('恢复的工程');
  await page.locator('.backup-import-actions button').first().click();
  await expect(page.locator('.import-preview')).toHaveCount(0);
  expect((await readPersistedDomainState(page)).state.projects).toHaveLength(0);
  expect(await page.evaluate(() => localStorage.getItem('blockcolc-first-project-setup-v1'))).toBeNull();
  for (const width of [360, 412, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 915 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize({ width: 412, height: 915 });
  await file.setInputFiles({ name: 'world.json', mimeType: 'application/json', buffer: backup });
  await page.screenshot({ path: info.outputPath(`first-restore-${language}.png`) });
  await page.locator('.backup-confirm').click();
  await waitForPreparedWorld(page);
  const state = (await readPersistedDomainState(page)).state;
  expect(state.projects.map(project => project.id)).toEqual(['restored-work']);
  expect(state.activeProjectId).toBe('restored-work');
  expect(await page.evaluate(() => localStorage.getItem('blockcolc-first-project-setup-v1'))).toBe('1');
  await page.reload(); await waitForPreparedWorld(page);
  await expect(page.locator('.setup')).toHaveCount(0);
});

test('busy feedback reuses icon geometry across action layouts but preserves refresh and segmented choices', async ({ page }) => {
  await openFresh(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const results = await page.evaluate(() => {
    const icon = document.querySelector('.setup-submit svg')!.outerHTML;
    const host = document.createElement('div');
    host.innerHTML = `<button class="primary">${icon}<span>保存</span></button><button><span>继续</span>${icon}</button><label class="file-button">${icon}<span>选择备份</span></label><div class="end-focus-dialog"><div class="end-focus-choices"><button>${icon}<span>提前完成</span></button></div></div><div class="text-toggle"><button>${icon}普通任务</button></div><button><svg data-pixel-icon="reset" viewBox="0 0 24 24" width="24" height="24"><path d="M2 2h10v10H2z"/></svg>刷新</button>`;
    document.querySelector('.app-shell')!.append(host);
    try {
      return [...host.querySelectorAll('button,label')].map(element => {
        const svg = element.querySelector('svg')!;
        const before = { width: (element as HTMLElement).offsetWidth, height: (element as HTMLElement).offsetHeight };
        element.setAttribute('aria-busy', 'true');
        const style = getComputedStyle(svg);
        return { before, after: { width: (element as HTMLElement).offsetWidth, height: (element as HTMLElement).offsetHeight },
          mask: style.maskImage, display: style.display, extra: getComputedStyle(element, '::after').display,
          animation: style.animationName, children: getComputedStyle(svg.firstElementChild!).visibility };
      });
    } finally { host.remove(); }
  });
  for (const result of results.slice(0, 4)) {
    expect(result.after).toEqual(result.before); expect(result.display).not.toBe('none');
    expect(result.extra).toBe('none'); expect(result.mask).not.toBe('none'); expect(result.children).toBe('hidden');
  }
  expect(results[4]!.mask).toBe('none'); expect(results[4]!.extra).toBe('none');
  expect(results[5]!.mask).toBe('none'); expect(results[5]!.animation).toBe('control-spin'); expect(results[5]!.children).toBe('visible');
});

test('sealed project leaves a scrollable task list and resume transforms its own play icon', async ({ page }, info) => {
  test.setTimeout(120_000);
  await openFresh(page);
  await page.getByRole('button', { name: '开始建造', exact: true }).click();
  await waitForPreparedWorld(page);
  let { state } = await readPersistedDomainState(page);
  const now = Date.now();
  const apply = (command: DomainCommand) => {
    const result = execute(state, command, { now: () => new Date(now) });
    if (!result.ok) throw Error(result.message);
    state = result.state;
  };
  for (let i = 0; i < 12; i++) apply({ type: 'CreateProject', projectId: `paused-${i}`, title: `待继续的工程 ${i + 1}`, blueprintId: 'builtin-small-workshop', subtasks: [{ id: `task-${i}`, title: '施工' }] });
  apply({ type: 'StartFocus', sessionId: 'seal-round', subtaskId: 'task-11', plannedDurationMs: 60_000 });
  await executeAndReloadPersistedCommand(page, state, { type: 'CompleteFocusEarly', reportId: 'seal-report' }, now + 1000);
  await waitForPreparedWorld(page);
  await page.setViewportSize({ width: 412, height: 740 });
  const panel = page.locator('.focus-workbench-panel');
  expect(await panel.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(200);
  expect(await panel.evaluate(element => getComputedStyle(element).overflowY)).toBe('auto');
  await panel.hover(); await page.mouse.wheel(0, 1200);
  await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
  const resume = page.getByRole('button', { name: '待继续的工程 11', exact: true });
  await resume.scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    // Delay only the save acknowledgement in this synthetic database, not rendering.
    const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete')!;
    Object.defineProperty(IDBTransaction.prototype, 'oncomplete', { ...descriptor, set(callback) {
      descriptor.set!.call(this, typeof callback !== 'function' ? callback : function(this: IDBTransaction, event: Event) {
        if (this.mode === 'readwrite' && this.objectStoreNames.contains('appState')) setTimeout(() => callback.call(this, event), 700);
        else callback.call(this, event);
      });
    } });
  });
  const before = await resume.evaluate(element => { const box = element.querySelector('svg')!.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2, width: element.getBoundingClientRect().width }; });
  await resume.click();
  await expect(resume).toHaveAttribute('aria-busy', 'true');
  const busy = await resume.evaluate(element => {
    const icon = element.querySelector('svg')!, box = icon.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, width: element.getBoundingClientRect().width,
      extra: getComputedStyle(element, '::after').display, mask: getComputedStyle(icon).maskImage, visible: getComputedStyle(icon).visibility };
  });
  expect(Math.abs(before.x - busy.x)).toBeLessThan(1); expect(Math.abs(before.y - busy.y)).toBeLessThan(1);
  expect(busy.width).toBe(before.width); expect(busy.extra).toBe('none'); expect(busy.visible).toBe('visible'); expect(busy.mask).not.toBe('none');
  await page.screenshot({ path: info.outputPath('workspace-resume-busy.png') });
  await expect(page.locator('.workbench-heading')).toContainText('待继续的工程 11');
  expect((await readPersistedDomainState(page)).state.activeProjectId).toBe('paused-10');
});
