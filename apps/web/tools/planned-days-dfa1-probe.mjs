import { chromium } from '@playwright/test';

// DF-A1-05 acceptance: at 360px and 412px all seven day cells are fully
// visible on one line at 44x44 with real hit-testing (elementFromPoint), at
// 100% and 200% root font size. 320px is an explicitly degraded ultra-narrow
// fallback (horizontal scroll), not part of the acceptance viewports.
const browser = await chromium.launch();
let failures = 0;
for (const [w, h, scale] of [[360, 800, 100], [412, 915, 100], [360, 800, 200], [412, 915, 200]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: 'light' });
  await page.goto('http://127.0.0.1:42777/');
  await page.evaluate((s) => { document.documentElement.style.fontSize = `${s}%`; }, scale);
  await page.getByRole('button', { name: '开始建造' }).click();
  await page.getByRole('button', { name: '设置' }).click();
  await page.locator('.planned-days').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 90));
  await page.waitForTimeout(250);
  const m = await page.evaluate(() => {
    const row = document.querySelector('.planned-days');
    const cells = [...row.querySelectorAll('button')];
    const rowRect = row.getBoundingClientRect();
    const parent = row.parentElement.getBoundingClientRect();
    const noScroll = row.scrollWidth <= row.clientWidth + 0.5;
    const cellsFit = cells.every((c) => { const r = c.getBoundingClientRect(); return r.width >= 43.5 && r.height >= 43.5 && r.right <= parent.right + 0.5 && r.left >= parent.left - 0.5; });
    const last = cells[cells.length - 1];
    const lr = last.getBoundingClientRect();
    const hit = document.elementFromPoint(lr.x + lr.width / 2, lr.y + lr.height / 2);
    const lastHittable = hit ? (hit === last || last.contains(hit) || hit.contains(last)) : false;
    return { noScroll, cellsFit, lastHittable, count: cells.length, cellW: Math.round(cells[0].getBoundingClientRect().width * 10) / 10 };
  });
  const ok = m.noScroll && m.cellsFit && m.lastHittable && m.count === 7;
  if (!ok) failures++;
  console.log(`${w}x${h} @${scale}%: noScroll=${m.noScroll} cellsFit=${m.cellsFit} lastHittable=${m.lastHittable} cellW=${m.cellW} count=${m.count}; ${ok ? 'PASS' : 'FAIL'}`);
  await page.close();
}
await browser.close();
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exitCode = failures === 0 ? 0 : 1;
