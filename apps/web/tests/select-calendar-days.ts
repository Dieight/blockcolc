import {expect,type Page} from '@playwright/test';

/** Use the same keyboard range selection offered to users, not fixture state. */
export async function selectLastCalendarDays(page:Page,days:number) {
  const calendar=page.locator('.focus-calendar-chart');
  await calendar.focus();
  await calendar.press('End');
  for(let offset=1;offset<days;offset++) await calendar.press('Shift+ArrowUp');
  const selected=calendar.locator('[aria-selected="true"]');
  await expect(selected).toHaveCount(days);
  const dates=await selected.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-date')!));
  return dates.length===1 ? dates[0]!.replaceAll('-','.') : `${dates[0]!.replaceAll('-','.')} — ${dates[dates.length-1]!.replaceAll('-','.')}`;
}
