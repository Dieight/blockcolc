import { expect, test } from '@playwright/test';

async function openSettings(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  await page.getByRole('button', { name: '设置' }).click();
}

test('settings page keeps grouped rows, quiet secondary actions, and 44px targets', async ({ page }, testInfo) => {
  await openSettings(page);

  for (const heading of ['计时', '专注保护', '提醒', '世界', '高级', '建筑蓝图库', '方块材质包', '本地备份']) {
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }

  // Weekday pills are circular 44px targets while the row has room for them.
  const pill = page.getByRole('group', { name: '计划专注日' }).getByRole('button').first();
  const pillBox = await pill.boundingBox();
  expect(pillBox && Math.abs(pillBox.width - pillBox.height)).toBeLessThanOrEqual(1);
  expect(pillBox && pillBox.height).toBeGreaterThanOrEqual(44);

  // Reflow to a narrow viewport and keep the page free of horizontal overflow.
  await page.setViewportSize({ width: 380, height: 780 });
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

  // Every visible button respects the 44px touch contract.
  const smallButtons = await page.evaluate(() => [...document.querySelectorAll('button')]
    .filter((button) => { const r = button.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 43.5; })
    .map((button) => button.textContent?.trim().slice(0, 10) || button.getAttribute('aria-label')));
  expect(smallButtons).toEqual([]);

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

  // At the narrow width the seven pills become uniform full-width capsules and
  // keep the 44px touch height.
  const narrowPill = page.getByRole('group', { name: '计划专注日' }).getByRole('button').first();
  const narrowPillBox = await narrowPill.boundingBox();
  expect(narrowPillBox && narrowPillBox.height).toBeGreaterThanOrEqual(44);
  const pillWidths = await page.getByRole('group', { name: '计划专注日' }).getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().width));
  expect(Math.max(...pillWidths) - Math.min(...pillWidths)).toBeLessThanOrEqual(1);

  await page.screenshot({ path: testInfo.outputPath('settings-layout.png'), fullPage: true });
});
