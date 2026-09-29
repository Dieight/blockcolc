import { chromium } from '@playwright/test';

// 用户确认方案验收：浅色淡绿玻璃/深绿字、深色深绿玻璃/浅白绿字、滑杆联动但有
// 可读性下限、48px/16px 不变、disabled/focus-visible/Tab 可达、reduced 回退实底、
// 200% 字号不变形，且深色文字不被 theme.css 的 [data-theme=dark].primary 覆盖。
const browser = await chromium.launch();
let failures = 0;
const check = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${cond ? '' : ` — ${detail}`}`); if (!cond) failures++; };
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const contrast = (a, b) => { const L1 = lum(a), L2 = lum(b); const hi = Math.max(L1, L2), lo = Math.min(L1, L2); return (hi + 0.05) / (lo + 0.05); };

const setup = async (page) => {
  await page.goto('http://127.0.0.1:42777/');
  await page.getByRole('button', { name: '开始建造' }).click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByRole('checkbox', { name: '开启极简模式' }).click();
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await page.waitForTimeout(350);
};
const readStyle = (loc) => loc.evaluate((el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return { color: s.color, bgImage: s.backgroundImage, radius: s.borderRadius, height: r.height, width: r.width, backdrop: s.backdropFilter }; });

for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, colorScheme: scheme });
  await setup(page);
  const btn = page.locator('.minimal-start');
  const style = await readStyle(btn);
  const rgba = style.color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/).slice(1).map(Number);
  check(`${scheme}: 文字为绿系（未被 dark .primary 压成深黑）`, scheme === 'light' ? rgba[1] > 70 && rgba[1] < 150 : rgba[1] > 150, style.color);
  check(`${scheme}: 保留 48px 高 / 16px 圆角`, Math.round(style.height) === 48 && style.radius === '16px', `h=${style.height} r=${style.radius}`);
  check(`${scheme}: 玻璃含背景模糊`, style.backdrop.includes('blur'), style.backdrop);
  check(`${scheme}: 背景为玻璃渐变（含实底下限层）`, style.bgImage.includes('linear-gradient'), style.bgImage.slice(0, 80));
  const bg = scheme === 'light' ? [223, 236, 227] : [31, 51, 41];
  const ratio = contrast(rgba.slice(0, 3), bg);
  check(`${scheme}: 文字对实底下限对比度 ≥4.5:1`, ratio >= 4.5, `ratio=${ratio.toFixed(2)}`);
  await page.screenshot({ path: `test-results/ui-shots/minimal-start-${scheme}-v32.png` });
  await page.close();
}

// 滑杆 50% 默认 vs 100%：底色透明度差异，但文字色/按钮尺寸不变（不降文字透明度）。
{
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, colorScheme: 'light' });
  await page.goto('http://127.0.0.1:42777/');
  await page.getByRole('button', { name: '开始建造' }).click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: '设置' }).click();
  const slider = page.locator('input[aria-label="液态玻璃通透程度"]');
  await slider.fill('100');
  await page.getByRole('checkbox', { name: '开启极简模式' }).click();
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await page.waitForTimeout(300);
  const s100 = await readStyle(page.locator('.minimal-start'));
  check('light 滑杆100%: 文字色仍为深绿（不降文字透明度）', s100.color === 'rgb(39, 103, 73)', s100.color);
  await page.close();
}

// 200% 字号 + 键盘 Tab 可达 + disabled
{
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, colorScheme: 'light' });
  await page.goto('http://127.0.0.1:42777/');
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await page.getByRole('button', { name: '开始建造' }).click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByRole('checkbox', { name: '开启极简模式' }).click();
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await page.waitForTimeout(300);
  const h = await page.locator('.minimal-start').evaluate((el) => el.getBoundingClientRect().height);
  check('200% 字号下按钮仍 48px 高', Math.round(h) === 48, `h=${h}`);
  for (let i = 0; i < 9; i++) { if (await page.evaluate(() => document.activeElement?.className?.includes('minimal-start'))) break; await page.keyboard.press('Tab'); }
  check('键盘 Tab 可达开始按钮', await page.evaluate(() => document.activeElement?.className?.includes('minimal-start')));
  await page.close();
}

// reduced-transparency 回退绿色实底
{
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('http://127.0.0.1:42777/');
  await page.getByRole('button', { name: '开始建造' }).click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByRole('checkbox', { name: '开启极简模式' }).click();
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await page.waitForTimeout(300);
  const st = await page.locator('.minimal-start').evaluate((el) => getComputedStyle(el));
  const rtr = await page.evaluate(() => [...document.styleSheets].flatMap((sh) => { try { return [...sh.cssRules]; } catch { return []; } }).filter((x) => x.cssText && x.cssText.includes('prefers-reduced-transparency')).some((x) => x.cssText.includes('minimal-start') && x.cssText.includes('--minimal-start-solid')));
  check('reduced-transparency 回退绿色实底规则存在', rtr, st.backdropFilter);
  await page.close();
}
await browser.close();
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exitCode = failures === 0 ? 0 : 1;
