import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, colorScheme: 'dark', reducedMotion: 'reduce' });
await page.goto('http://127.0.0.1:42777/');
const r = await page.evaluate(() => { const m = [...document.styleSheets].flatMap((sh) => { try { return [...sh.cssRules]; } catch { return []; } }).filter((x) => x.cssText && x.cssText.includes('prefers-reduced-transparency')); return { total: m.length, direct: m.some((x) => x.cssText.includes('minimal-start') && x.cssText.includes('var(--minimal-start-solid)')) }; });
console.log(JSON.stringify(r));
await browser.close();
