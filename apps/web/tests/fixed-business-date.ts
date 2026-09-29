import type { Page } from '@playwright/test';

/** Fix business dates without installing a simulated timer or performance clock. */
export async function fixBusinessDate(page: Page, date: Date): Promise<void> {
  await page.addInitScript(epochMs => {
    const NativeDate = Date;
    globalThis.Date = new Proxy(NativeDate, {
      construct(target, args, newTarget) {
        return Reflect.construct(target, args.length === 0 ? [epochMs] : args, newTarget);
      },
      apply() { return new NativeDate(epochMs).toString(); },
      get(target, property, receiver) {
        return property === 'now' ? () => epochMs : Reflect.get(target, property, receiver);
      },
    });
  }, date.getTime());
}
