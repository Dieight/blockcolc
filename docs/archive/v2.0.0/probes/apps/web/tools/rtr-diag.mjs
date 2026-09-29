import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, colorScheme: 'dark' });
await page.goto('http://127.0.0.1:42777/');
console.log(await page.evaluate(() => { const m = [...document.styleSheets].flatMap((sh) => { try { return [...sh.cssRules]; } catch { return []; } }).filter((r) => r.cssText && r.cssText.includes('prefers-reduced-transparency')); return m.map((r) => ({ hasStart: r.cssText.includes('minimal-start'), hasSolid: r.cssText.includes('--minimal-start-solid'), text: r.cssText.slice(0, 120) })); }));
await browser.close();
