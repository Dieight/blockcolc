import { expect, type Page } from '@playwright/test';
import type { WorldDebugSettings } from '../src/world-debug';

const WEATHER_LABELS: Record<WorldDebugSettings['weather'], string> = {
  normal: '正常天气', clear: '晴', cloudy: '多云', rain: '小雨', storm: '雷雨', snow: '雪', mist: '雾',
};

/** Use the same App-owned weather menu as a person, never mutate debug state. */
export async function chooseDebugWeather(page: Page, kind: WorldDebugSettings['weather']) {
  const trigger = page.locator('#world-debug-weather').getByRole('button');
  await trigger.click();
  await page.getByRole('listbox', { name: '调试天气' }).getByRole('option', { name: WEATHER_LABELS[kind], exact: true }).click();
  await expect(trigger).toContainText(WEATHER_LABELS[kind]);
}

/** The in-App clock wraps within a day; no Android/native time input is involved. */
export async function chooseDebugTime(page: Page, time: string) {
  const slider = page.getByRole('slider', { name: '世界调试时间', exact: true });
  const [hour, minute] = time.split(':').map(Number);
  const target = hour! * 60 + minute!;
  const current = Number(await slider.getAttribute('aria-valuenow'));
  const forward = (target - current + 1440) % 1440;
  const delta = forward > 720 ? forward - 1440 : forward;
  if (!Number.isFinite(delta) || delta % 5 !== 0) throw new Error(`Unsupported debug time: ${current} -> ${time}`);
  for (let step = 0; step < Math.abs(delta) / 5; step++) await slider.press(delta > 0 ? 'ArrowUp' : 'ArrowDown');
  await expect(slider).toHaveAttribute('aria-valuenow', String(target));
  await expect(slider.locator('.timer-value')).toHaveText(time);
}
