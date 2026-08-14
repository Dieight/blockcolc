import { expect, test } from '@playwright/test';

async function openSettings(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  await page.getByRole('button', { name: '设置' }).click();
}

test('settings page keeps grouped rows, quiet secondary actions, and 44px targets', async ({ page }, testInfo) => {
  await openSettings(page);

  for (const heading of ['计时', '专注保护', '提醒', '世界', '建筑蓝图库', '方块材质包', '本地备份']) {
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }

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
      .map(({ el, s }) => `${el.tagName}.${[...el.classList].join('.')} ml=${s.marginLeft} mr=${s.marginRight} pr=${s.paddingRight}`);
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

  // Rows are hairline-separated surfaces, not boxed cards.
  const row = page.locator('.settings-group .setting-row').first();
  await expect(row).toHaveCSS('border-bottom-width', '1px');
  await expect(row).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

  // Text option groups: borderless buttons, active option underlined in ink.
  const activeToggle = page.locator('.text-toggle button[aria-pressed="true"]').first();
  const inactiveToggle = page.locator('.text-toggle button[aria-pressed="false"]').first();
  await expect(activeToggle).toHaveCSS('text-decoration-line', 'underline');
  await expect(inactiveToggle).toHaveCSS('text-decoration-line', 'none');

  // Weekday pills are circular 44px targets.
  const pill = page.getByRole('group', { name: '计划专注日' }).getByRole('button').first();
  const pillBox = await pill.boundingBox();
  expect(pillBox && Math.abs(pillBox.width - pillBox.height)).toBeLessThanOrEqual(1);
  expect(pillBox && pillBox.height).toBeGreaterThanOrEqual(44);

  await page.screenshot({ path: testInfo.outputPath('settings-layout.png'), fullPage: true });
});
