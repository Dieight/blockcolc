import { expect, test } from '@playwright/test';

async function openSettings(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  await page.getByRole('button', { name: '设置' }).click();
}

test('real-weather availability stays in Settings while Web keeps the local simulation', async ({ page }) => {
  await openSettings(page);
  const weather = page.getByRole('checkbox', { name: '同步现实天气' });
  const weatherStatus = page.locator('.weather-setting-status');
  await expect(weather).not.toBeChecked();
  await expect(weatherStatus).toContainText('已关闭 · 聚落继续使用本地天气');
  await weather.check();
  await expect(weather).toBeChecked();
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect(page.locator('.world-weather-badge')).toHaveCount(0);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(weatherStatus).toContainText('当前设备不可用 · 当前使用本地天气');
  await page.reload();
  await expect(page.locator('.world-weather-badge')).toHaveCount(0);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(weather).toBeChecked();
  await expect(weatherStatus).toContainText('当前设备不可用 · 当前使用本地天气');
});

test('settings page keeps grouped rows, quiet secondary actions, and 44px targets', async ({ page }, testInfo) => {
  await openSettings(page);

  for (const heading of ['计时', '专注保护', '提醒', '世界', '高级', '建筑蓝图库', '方块材质包', '本地备份']) {
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }

  // F03: units live at the end of each field label; numeric controls keep a
  // fixed 64px column aligned to the row's right content edge. The draft
  // remains editable until an explicit commit. Empty drafts restore the
  // current value, Enter commits, and Escape cancels the draft.
  const numericLabels = [
    '普通任务专注（分钟）',
    '习惯任务专注（分钟）',
    '每座习惯建筑（轮）',
    '每轮休息（分钟）',
    '有效离开上限（次）',
    '离开阈值（秒）',
  ];
  for (const label of numericLabels) await expect(page.getByText(label, { exact: true })).toHaveCount(1);
  await expect(page.locator('.number-field > span')).toHaveCount(0);
  const numberMetrics = await page.locator('.number-field').evaluateAll((fields) => fields.map((field) => {
    const input = field.querySelector('input');
    const row = field.closest('.setting-row');
    const inputBox = input?.getBoundingClientRect();
    const rowBox = row?.getBoundingClientRect();
    const rowStyle = row ? getComputedStyle(row) : null;
    return {
      inputX: inputBox?.x ?? 0,
      inputRight: inputBox?.right ?? 0,
      inputWidth: inputBox?.width ?? 0,
      inputHeight: inputBox?.height ?? 0,
      rowContentRight: (rowBox?.right ?? 0) - Number.parseFloat(rowStyle?.paddingRight ?? '0'),
    };
  }));
  expect(numberMetrics.length).toBeGreaterThanOrEqual(6);
  for (const metric of numberMetrics) {
    expect(metric.inputWidth, JSON.stringify(numberMetrics)).toBeCloseTo(64, 0);
    expect(metric.inputHeight, JSON.stringify(numberMetrics)).toBeGreaterThanOrEqual(43.5);
    expect(Math.abs(metric.inputRight - metric.rowContentRight), JSON.stringify(numberMetrics)).toBeLessThanOrEqual(1);
  }
  const focusMinutes = page.getByLabel('普通任务专注分钟');
  await focusMinutes.fill('');
  await expect(focusMinutes).toHaveValue('');
  await focusMinutes.type('5');
  await expect(focusMinutes).toHaveValue('5');
  await focusMinutes.press('Enter');
  await expect(focusMinutes).toHaveValue('5');
  await focusMinutes.fill('');
  await focusMinutes.press('Enter');
  await expect(focusMinutes).toHaveValue('5');
  await focusMinutes.fill('52');
  await focusMinutes.press('Escape');
  await expect(focusMinutes).toHaveValue('5');

  // DF-UI-01: weekday cells are equal rounded rectangles, at least 44px in
  // both dimensions, on a single non-wrapping row.
  const pill = page.getByRole('group', { name: '计划专注日' }).getByRole('button').first();
  const pillBox = await pill.boundingBox();
  expect(pillBox && pillBox.width).toBeGreaterThanOrEqual(44);
  expect(pillBox && pillBox.height).toBeGreaterThanOrEqual(44);

  // Reflow to a narrow viewport and keep the page free of horizontal overflow.
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(150);
  const overflow = await page.evaluate(() => {
    const cw = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll('body *')]
      .map((el) => { const r = el.getBoundingClientRect(); return { el, r }; })
      .filter(({ r }) => r.width > 0 && r.height > 0 && (r.right > cw + 0.5 || r.left < -0.5))
      .map(({ el, r }) => `${el.tagName}.${[...el.classList].join('.')} right=${r.right.toFixed(2)} text="${(el.textContent || '').trim().slice(0, 12)}"`);
    const marginSuspicious = [...document.querySelectorAll('body *')]
      .map((el) => { const s = getComputedStyle(el); return { el, s, r: el.getBoundingClientRect() }; })
      .filter(({ s, r }) => r.width > 0 && (parseFloat(s.marginRight) > 0 || parseFloat(s.marginLeft) > 0 || parseFloat(s.paddingRight) > 0))
      .slice(0, 20)
      .map(({ el, s, r }) => `${el.tagName}.${[...el.classList].join('.')} ml=${s.marginLeft} mr=${s.marginRight} pr=${s.paddingRight} w=${r.width.toFixed(0)}`);
    return {
      delta: document.documentElement.scrollWidth - cw,
      cw,
      sw: document.documentElement.scrollWidth,
      htmlW: document.documentElement.getBoundingClientRect().width,
      bodyW: document.body.getBoundingClientRect().width,
      offenders: offenders.slice(0, 8),
      marginSuspicious,
    };
  });
  expect(overflow.delta, JSON.stringify(overflow)).toBeLessThanOrEqual(1);

  // Every visible button respects the 44px touch contract in both dimensions.
  const smallButtons = await page.evaluate(() => [...document.querySelectorAll('button')]
    .filter((button) => { const r = button.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 43.5 || r.width < 43.5); })
    .map((button) => button.textContent?.trim().slice(0, 10) || button.getAttribute('aria-label')));
  expect(smallButtons).toEqual([]);

  // Weekday pills must not be compressed: every one stays a full 44x44 circle
  // (they wrap instead) and adjacent hit areas never overlap.
  const pillMetrics = await page.getByRole('group', { name: '计划专注日' }).getByRole('button').evaluateAll((buttons) => {
    const boxes = buttons.map((button) => { const r = button.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const overlaps: string[] = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!; const b = boxes[j]!;
        const gapX = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w));
        const gapY = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h));
        if (gapX < -0.5 && gapY < -0.5) overlaps.push(`${i}~${j}`);
      }
    }
    return { boxes, overlaps };
  });
  expect(pillMetrics.boxes.length).toBe(7);
  for (const box of pillMetrics.boxes) {
    expect(box.w, JSON.stringify(pillMetrics.boxes)).toBeGreaterThanOrEqual(43.5);
    expect(box.h).toBeGreaterThanOrEqual(43.5);
  }
  expect(pillMetrics.overlaps, JSON.stringify(pillMetrics.overlaps)).toEqual([]);

  // DF-A1-02: integrity is its own switch row; the two numeric rows show only
  // while it is on, hide entirely when it is off, and keep their saved values
  // across an off/on cycle.
  const integrityRow = page.locator('.integrity-setting');
  const switchBox = await integrityRow.locator('.ios-switch input').boundingBox();
  expect(switchBox && switchBox.width).toBeGreaterThanOrEqual(50.5);
  expect(switchBox && switchBox.height).toBeGreaterThanOrEqual(30.5);
  const integrityAlignment = await integrityRow.evaluate((element) => {
    const row = element.getBoundingClientRect();
    const input = element.querySelector('.ios-switch input')?.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      rowContentRight: row.right - Number.parseFloat(style.paddingRight),
      switchRight: input?.right ?? 0,
    };
  });
  expect(Math.abs(integrityAlignment.rowContentRight - integrityAlignment.switchRight), JSON.stringify(integrityAlignment)).toBeLessThanOrEqual(1);
  const numericRows = page.locator('.integrity-numeric-row');
  await expect(numericRows).toHaveCount(2);
  const thresholdInput = page.getByLabel('离开阈值秒数');
  await expect(thresholdInput).toHaveValue(/[1-9]/);
  await thresholdInput.fill('12');
  await thresholdInput.press('Enter');
  await expect(integrityRow).toContainText('离开超 12 秒计次，达上限本轮失败');
  await integrityRow.locator('.ios-switch input').click();
  await expect(numericRows).toHaveCount(0);
  await integrityRow.locator('.ios-switch input').click();
  await expect(thresholdInput).toBeEnabled();
  await expect(thresholdInput).toHaveValue('12');

  // V27: rows live inside translucent liquid-glass cards with a blurred
  // backdrop; rows themselves stay transparent and separate via hairlines.
  const card = page.locator('.settings-group .settings-list').first();
  const cardMaterial = await card.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, blur: style.backdropFilter, radius: style.borderRadius };
  });
  expect(cardMaterial.background, JSON.stringify(cardMaterial)).not.toBe('rgba(0, 0, 0, 0)');
  expect(cardMaterial.blur).toContain('blur');
  expect(Number.parseFloat(cardMaterial.radius)).toBeGreaterThan(8);
  const row = page.locator('.settings-group .setting-row').first();
  await expect(row).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const separator = page.locator('.settings-group .setting-row + .setting-row').first();
  await expect(separator).toHaveCSS('border-top-width', '1px');

  // Text option groups are iOS-style segmented controls: the active option is a
  // raised solid chip, inactive options stay on the track without underline.
  const activeToggle = page.locator('.text-toggle button[aria-pressed="true"]').first();
  const inactiveToggle = page.locator('.text-toggle button[aria-pressed="false"]').first();
  await expect(activeToggle).toHaveCSS('text-decoration-line', 'none');
  await expect(inactiveToggle).toHaveCSS('text-decoration-line', 'none');
  const activeBackground = await activeToggle.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(activeBackground, 'active segmented option must be raised').not.toBe('rgba(0, 0, 0, 0)');
  const inactiveBackground = await inactiveToggle.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(inactiveBackground).toBe('rgba(0, 0, 0, 0)');

  // Keyboard focus stays visible on the pill switch, and the toggle itself
  // works both ways: decay ships disabled by default, so space enables and a
  // second press disables again (state-derived handlers).
  const decaySwitch = page.getByLabel('开启建筑腐败');
  await expect(decaySwitch).not.toBeChecked();
  await decaySwitch.focus();
  await page.keyboard.press(' ');
  await expect(decaySwitch).toBeChecked();
  const focusOutline = await decaySwitch.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: style.outlineWidth, style: style.outlineStyle };
  });
  expect(focusOutline.style).toBe('solid');
  expect(Number.parseFloat(focusOutline.width)).toBeGreaterThanOrEqual(3);
  await page.keyboard.press(' ');
  await expect(decaySwitch).not.toBeChecked();

  await page.screenshot({ path: testInfo.outputPath('settings-layout.png'), fullPage: true });
});

test('a failed preference write shows an error and restores the persisted number', async ({ page }) => {
  await openSettings(page);
  const focusMinutes = page.getByLabel('普通任务专注分钟');
  await expect(focusMinutes).toHaveValue('45');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'blockcolc-focus-preferences-v1') throw new Error('synthetic preference write failure');
      return original.call(this, key, value);
    };
  });

  await focusMinutes.fill('52');
  await focusMinutes.press('Enter');
  await expect(focusMinutes).toHaveValue('45');
  await expect(page.locator('.toast')).toContainText('设置未保存：synthetic preference write failure');

  await page.reload();
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('普通任务专注分钟')).toHaveValue('45');
});

test('settings stays readable at five viewports in both themes and under large text', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openSettings(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const viewports = [
    { name: 'compact-phone', width: 360, height: 800 },
    { name: 'large-phone', width: 412, height: 915 },
    { name: 'phone-landscape', width: 915, height: 412 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1440, height: 900 },
  ] as const;
  const themeButtons = page.getByRole('group', { name: '深色模式' });
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const theme of ['light', 'dark'] as const) {
      await themeButtons.getByRole('button', { name: theme === 'light' ? '浅色' : '深色', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const layout = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        const offenders = [...document.querySelectorAll('body *')]
          .map((element) => element.getBoundingClientRect())
          .filter((rect) => rect.width > 0 && rect.height > 0 && (rect.right > width + 0.5 || rect.left < -0.5));
        return { overflow: document.documentElement.scrollWidth - width, offenders: offenders.length };
      });
      expect(layout.overflow, `${viewport.name}/${theme} layout`).toBeLessThanOrEqual(1);
      expect(layout.offenders, `${viewport.name}/${theme} layout`).toBe(0);
      await page.screenshot({ path: testInfo.outputPath(`settings-${viewport.name}-${theme}.png`), fullPage: true });
    }
  }

  // 20px root text approximates a large Android WebView font scale while
  // retaining the product's fixed touch-control dimensions.
  await page.setViewportSize({ width: 360, height: 800 });
  // Recreate the page after crossing the desktop breakpoint. Chromium's
  // emulated mobile context can retain the previous breakpoint's shell inset
  // when only the viewport is resized; a reload makes this a real compact
  // settings layout rather than testing a stale desktop sidebar at 360px.
  await page.reload();
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => { document.documentElement.style.fontSize = '20px'; });
  const largeTextLayout = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const offenderDetails = [...document.querySelectorAll('body *')]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: typeof element.className === 'string' ? element.className : '',
          text: (element.textContent ?? '').replace(/\s+/gu, ' ').trim().slice(0, 80),
          rect: { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), top: Math.round(rect.top), height: Math.round(rect.height) },
        };
      })
      .filter(({ rect }) => rect.width > 0 && rect.height > 0 && (rect.right > width + 0.5 || rect.left < -0.5));
    return {
      overflow: document.documentElement.scrollWidth - width,
      offenders: offenderDetails.length,
      offenderDetails,
      numberHeights: [...document.querySelectorAll('.number-field input')].map((input) => input.getBoundingClientRect().height),
    };
  });
  expect(largeTextLayout.overflow, JSON.stringify(largeTextLayout)).toBeLessThanOrEqual(1);
  expect(largeTextLayout.offenders, JSON.stringify(largeTextLayout)).toBe(0);
  for (const height of largeTextLayout.numberHeights) expect(height).toBeGreaterThanOrEqual(43.5);
  await page.screenshot({ path: testInfo.outputPath('settings-large-text.png'), fullPage: true });
});

test('reduced transparency falls back to solid settings surfaces', async ({ page }) => {
  // Playwright's emulateMedia does not expose this feature yet; use raw CDP.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
  });
  await openSettings(page);
  for (const surface of ['.settings-group .settings-list', '.backup-panel']) {
    const material = await page.locator(surface).first().evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, blur: style.backdropFilter };
    });
    expect(material.blur, surface).toBe('none');
    expect(material.background, surface).not.toBe('rgba(0, 0, 0, 0)');
  }

  // The floating overlays share the same contract: solid surface, no blur.
  await page.getByRole('button', { name: '计时' }).click();
  await page.getByRole('button', { name: '调整本次计划' }).click();
  const sheet = page.locator('.focus-plan-sheet');
  await expect(sheet).toBeVisible();
  const sheetMaterial = await sheet.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, blur: style.backdropFilter };
  });
  expect(sheetMaterial.blur).toBe('none');
  expect(sheetMaterial.background).toBe('rgb(255, 255, 255)');
});
