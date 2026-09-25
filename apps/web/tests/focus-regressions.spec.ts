import { expect, test } from "@playwright/test";
import { readPersistedDomainState } from './persisted-domain-state';

// Temporary V23 reproduction/regression probes (remove before release).

async function createDefaultProject(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "开始建造" }).click();
  await expect(page.locator(".world-screen")).toBeVisible();
}

async function configureOneMinuteRounds(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "设置" }).click();
  const focusMinutes = page.getByLabel("普通任务专注分钟");
  await focusMinutes.fill("1");
  await focusMinutes.press("Enter");
  const breakMinutes = page.getByLabel("每轮休息分钟");
  await breakMinutes.fill("0");
  await breakMinutes.press("Enter");
  await page.getByRole("button", { name: "计时" }).click();
}

async function pickEndTime1605(page: import("@playwright/test").Page) {
  const sheet = page.getByRole("dialog", { name: "安排下一轮" });
  await sheet.getByRole("button", { name: "按结束时间" }).click();
  await page.getByLabel("减少结束小时").click();
  await page.getByLabel("减少结束小时").click();
  await page.getByLabel("增加结束分钟").click();
  await expect(sheet).toContainText(/轮专注/);
  return sheet;
}

async function createHabit(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await page.getByRole("button", { name: "新增任务" }).click();
  await page.getByRole("button", { name: "习惯任务" }).click();
  await page.getByLabel("习惯名称").fill(name);
  await page.getByRole("button", { name: "开始建造" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

async function switchToFiniteProject(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await page.locator(".choice-menu-trigger").click();
  await page.getByRole("option", { name: /我的第一座工坊/ }).click();
  await page.getByRole("button", { name: "计时" }).click();
}

// BUG 5: after some rounds were settled into a habit building, confirming and
// immediately cancelling a NEW marathon must NOT re-offer those historical
// rounds as a full report (and submitting must not hit "A completed ... report").
test("habit-settled rounds are never re-offered by a later plan cancel", async ({ page }) => {
  // This regression intentionally completes and settles two independent
  // end-time plans; keep its budget local to this multi-cycle path.
  test.setTimeout(60_000);
  await page.clock.install({ time: new Date("2026-08-03T08:00:00Z") });
  await createDefaultProject(page);
  await configureOneMinuteRounds(page);
  await createHabit(page, "晚间阅读");
  await switchToFiniteProject(page);

  // Marathon round 1 → cancel → settle that round into the habit.
  await page.getByRole("button", { name: "调整本次计划" }).click();
  const sheet = await pickEndTime1605(page);
  await sheet.getByRole("button", { name: "确认计划" }).click();
  await page.getByRole("button", { name: /^开始到/ }).click();
  await page.clock.fastForward(61_000);
  await expect(page.getByRole("button", { name: "开始下一轮" })).toBeVisible();
  await page.getByRole("button", { name: "调整本次计划" }).click();
  await sheet.getByRole("button", { name: "取消计划" }).click();
  await expect(page.getByRole("heading", { name: "把这次推进汇报给哪些任务？" })).toBeVisible();
  await page.locator(".marathon-settlement-head").first().click();
  await expect(page.locator(".habit-round-stepper")).toBeVisible();
  await page.getByRole("button", { name: "增加计入轮数" }).click();
  await page.getByRole("button", { name: "提交本次推进" }).click();
  await expect(page.getByRole("heading", { name: "把这次推进汇报给哪些任务？" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "我的第一座工坊" })).toBeVisible();

  // NEW marathon: confirm, complete round 1, cancel. The report must offer only
  // this current round (the habit-settled one is excluded) and submit cleanly.
  await page.getByRole("button", { name: "调整本次计划" }).click();
  const sheet2 = await pickEndTime1605(page);
  await sheet2.getByRole("button", { name: "确认计划" }).click();
  await page.getByRole("button", { name: /^开始到/ }).click();
  await page.clock.fastForward(61_000);
  await expect(page.getByRole("button", { name: "开始下一轮" })).toBeVisible();
  await page.getByRole("button", { name: "调整本次计划" }).click();
  await sheet2.getByRole("button", { name: "取消计划" }).click();
  await expect(page.getByRole("heading", { name: "把这次推进汇报给哪些任务？" })).toBeVisible();
  await expect(page.locator(".marathon-progress-report .eyebrow")).toContainText("1 轮专注已结束");
  await page.getByRole("button", { name: "提交本次推进" }).click();
  await expect(page.getByRole("heading", { name: "把这次推进汇报给哪些任务？" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "我的第一座工坊" })).toBeVisible();
});

// BUG 4: an app-switch-limit exit must behave like a user interrupt — the
// marathon schedule survives and the next focus resumes at the same round.
test("an app-switch-limit exit keeps the marathon at the same round", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-08-03T08:00:00Z") });
  await createDefaultProject(page);
  await configureOneMinuteRounds(page);
  await page.getByRole("button", { name: "调整本次计划" }).click();
  const sheet = await pickEndTime1605(page);
  await sheet.getByRole("button", { name: "确认计划" }).click();

  // Complete round 1, start round 2.
  await page.getByRole("button", { name: /^开始到/ }).click();
  await page.clock.fastForward(61_000);
  await expect(page.getByRole("button", { name: "开始下一轮" })).toBeVisible();
  await page.getByRole("button", { name: "开始下一轮" }).click();
  await expect(page.locator(".focus-task-context strong")).toContainText(/专注中 第2\/\d+轮/);

  // Three web-visibility excursions exceed the default max of three; each pair
  // must exceed the 3 s grace to count.
  for (let round = 1; round <= 3; round += 1) {
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.fastForward(3_200);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.fastForward(400);
    if (round < 3) {
      await expect.poll(async () => (await readPersistedDomainState(page)).state.activeFocusSession?.integrity.effectiveExcursions).toBe(round);
    }
    if (round === 1) {
      const integrityNotice = page.locator(".focus-integrity-warning.flash");
      await expect(integrityNotice).toContainText("有效离开 1 / 3 次");
      await expect(page.locator(".toast")).toHaveCount(0);
    }
  }

  // The session ended with the integrity notice, but the schedule survives at
  // round 2 (not dropped to a fresh plan, not advanced to round 3).
  await expect(page.locator(".focus-integrity-ended")).toBeVisible();
  await expect(page.locator(".focus-task-context strong")).toContainText(/准备第 2 \/ \d+ 轮/);
  await expect(page.getByRole("button", { name: "开始下一轮" })).toBeVisible();
  await page.getByRole("button", { name: "开始下一轮" }).click();
  await expect(page.locator(".focus-task-context strong")).toContainText(/专注中 第2\/\d+轮/);
});

// BUG 1: a long subtask name that wraps must stay clamped inside its own slot —
// the immersive board carries only name / time / end control with the time dead
// centered, so nothing can ever collide with the timer (the old "第x/x轮" chip
// and the timer label are gone).
test("long subtask name wrapping must not overlap the timer", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-08-03T08:00:00Z") });
  await createDefaultProject(page);
  await configureOneMinuteRounds(page);
  // Rename the subtask to a very long name that wraps on a phone viewport.
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await page.locator(".task-editor-row").first().dblclick();
  const rename = page.getByRole("textbox", { name: "小任务名称" });
  await rename.fill("这是一个非常长的小任务名称，用来验证它在沉浸式计时页换行之后是否会导致轮次提示与每轮时长相重叠的布局问题");
  await rename.press("Enter");
  await page.getByRole("button", { name: "计时" }).click();
  await page.getByRole("button", { name: "调整本次计划" }).click();
  await page.getByRole("dialog", { name: "安排下一轮" }).getByRole("button", { name: "2 轮" }).click();
  await page.getByRole("dialog", { name: "安排下一轮" }).getByRole("button", { name: "确认计划" }).click();
  await page.getByRole("button", { name: /^开始 2 轮/ }).click();
  await expect(page.locator(".focus-task-context strong")).toContainText(/这是一个非常长/);
  // The task-name slot and the timer must not overlap.
  const name = await page.locator(".focus-task-context").boundingBox();
  const timer = await page.locator(".timer").boundingBox();
  const panel = await page.locator(".focus-panel").boundingBox();
  expect(name).not.toBeNull();
  expect(timer).not.toBeNull();
  expect((timer as any).y).toBeGreaterThanOrEqual((name as any).y + (name as any).height - 0.5);
  // The time is dead-centered on the info board (both axes).
  const timerCy = (timer as any).y + (timer as any).height / 2;
  const panelCy = (panel as any).y + (panel as any).height / 2;
  const timerCx = (timer as any).x + (timer as any).width / 2;
  const panelCx = (panel as any).x + (panel as any).width / 2;
  expect(Math.abs(timerCy - panelCy)).toBeLessThanOrEqual(8);
  expect(Math.abs(timerCx - panelCx)).toBeLessThanOrEqual(8);
  await page.screenshot({ path: "test-results/v23-bug1-overlap.png", fullPage: true });
});
