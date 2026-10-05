import { expect, test } from "@playwright/test";
import { executeAndReloadPersistedCommand, readPersistedDomainState } from "./persisted-domain-state";
import { choosePlanEndTime, preparePlanCancellation, startNextRound, openRetainedPlan, waitForMarathonReport, revealFocusControls } from './focus-plan-controls';

// These checks own schedule/settlement recovery, not weather animation.
test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: 'reduce' }); });

// V22: the end-time (marathon) plan persists independently of the current task.
// Confirmation stays on the workbench until the first start; canceling
// settles finished rounds into one cross-project report where habit rounds are
// allocated explicitly and finite-task progress is submitted once.

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

async function configureDistinctNormalAndHabitRounds(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "设置" }).click();
  const focusMinutes = page.getByLabel("普通任务专注分钟");
  await focusMinutes.fill("45");
  await focusMinutes.press("Enter");
  const habitFocusMinutes = page.getByLabel("习惯任务专注分钟");
  await habitFocusMinutes.fill("20");
  await habitFocusMinutes.press("Enter");
  const breakMinutes = page.getByLabel("每轮休息分钟");
  await breakMinutes.fill("0");
  await breakMinutes.press("Enter");
  await page.getByRole("button", { name: "计时" }).click();
}

// Installed at 16:00 Shanghai; select 16:05 for a short (1-minute) marathon.
async function pickEndTime1605(page: import("@playwright/test").Page) {
  const sheet = page.getByRole("dialog", { name: "安排下一轮" });
  await sheet.getByRole("button", { name: "按结束时间" }).click();
  await choosePlanEndTime(sheet, '16:05');
  await expect(sheet).toContainText(/轮专注/);
  return sheet;
}

test("confirming locks the plan on the workbench; cancelling after start settles in shared glass", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-08-03T08:00:00Z") });
  await createDefaultProject(page);
  await configureOneMinuteRounds(page);
  await page.getByRole("button", { name: "调整本次计划" }).click();
  const sheet = await pickEndTime1605(page);
  await sheet.getByRole("button", { name: "确认计划" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator(".dialog-backdrop")).toHaveCount(0);

  // An unstarted plan keeps ordinary navigation; starting owns the common
  // immersive focus, rest, ready and final report surface.
  await expect(page.locator(".world-screen")).not.toHaveClass(/is-focusing/);
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "按结束时间排程" })).toBeVisible();
  await expect(page.locator(".focus-task-context strong")).toHaveText("准备第 1 / 4 轮");
  await expect(page.locator(".workbench-context")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "切换当前工作", exact: true })).toBeVisible();
  const lockedPlan = await page.evaluate(() => JSON.parse(localStorage.getItem("blockcolc-round-plan-v1") ?? "null") as { mode?: string; subtaskId?: string | null; totalRounds?: number; status?: string; endAt?: string } | null);
  expect(lockedPlan).toMatchObject({ mode: "marathon", totalRounds: 4, status: "ready" });
  const total = lockedPlan?.totalRounds ?? 0;
  expect(Date.parse(lockedPlan?.endAt ?? "")).toBe(Date.parse("2026-08-03T08:05:00Z"));
  // The big timer shows the remaining planned work (rounds + breaks), not a
  // second countdown to the chosen end instant. With one-minute rounds and no
  // breaks the value is exactly the remaining round count in minutes.
  await expect(page.locator(".timer-label")).toHaveText("剩余总时长");
  await expect(page.locator(".timer-value")).toHaveText(`${String(total).padStart(2, '0')}:00`);
  await page.getByRole("button", { name: /^开始到/ }).click();
  await expect(page.locator(".focus-task-context strong")).toContainText(/专注中 第1\/\d+轮/);

  // Reopening the sheet now shows the red cancel-plan button.
  await page.clock.fastForward(61_000);
  await expect(page.getByRole("button", { name: "开始下一轮" })).toBeVisible();
  const reopen = await openRetainedPlan(page);
  const cancel = await preparePlanCancellation(reopen);
  await expect(cancel).toBeVisible();
  await expect(cancel).toHaveClass(/destructive/);
  await cancel.click();

  // Cancelling a locked marathon settles the finished round into the report.
  // Settlement stays immersive in v2.1. Its own scroll surface keeps the
  // bottom content reachable without returning to the old full-page layout.
  const report = await waitForMarathonReport(page);
  expect(await report.evaluate(element => getComputedStyle(element).overflowY)).toBe('auto');
  await page.locator(".marathon-settlement-head").first().click();
  await page.locator(".marathon-report-row").first().getByRole("button", { name: /推进至 25%/ }).click();
  await page.locator(".marathon-report-row").first().getByRole("button", { name: /增加 .*计入轮数/ }).click();
  const submit = report.getByRole("button", { name: "提交本次推进" });
  await submit.scrollIntoViewIfNeeded();
  expect(await submit.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return hit === element || (hit !== null && element.contains(hit));
  })).toBe(true);
  await submit.click();
  await expect(report).toHaveCount(0);
  // Back to the classic lane: project info is visible again.
  await expect(page.getByRole("heading", { name: "我的第一座工坊" })).toBeVisible();
  await expect(page.locator(".workbench-context")).toContainText("确定目标");
  await expect(page.locator(".workbench-context")).toContainText("25%");
  await expect(page.locator(".timer-label")).toHaveText("每轮时长");
  await expect(page.locator(".timer-value")).toHaveText("01:00");
});

test("every end-time round can finish early without advancing a leftover subtask", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-08-03T08:00:00Z") });
  await createDefaultProject(page);
  await configureOneMinuteRounds(page);
  await page.getByRole("button", { name: "调整本次计划" }).click();
  const sheet = await pickEndTime1605(page);
  await sheet.getByRole("button", { name: "确认计划" }).click();
  const schedule = await page.evaluate(() => JSON.parse(localStorage.getItem("blockcolc-round-plan-v1") ?? "null") as { totalRounds?: number; endAt?: string } | null);
  const total = schedule?.totalRounds ?? 0;
  expect(total).toBeGreaterThan(1);
  expect(Date.parse(schedule?.endAt ?? "")).toBe(Date.parse("2026-08-03T08:05:00Z"));

  await page.getByRole("button", { name: /^开始到/ }).click();
  await revealFocusControls(page);
  const dialog = page.getByRole("dialog", { name: "如何结束这次专注？" });
  if (!(await dialog.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "结束本次专注" }).click();
  }
  await expect(dialog).toContainText(`马拉松 第 1 / ${total} 轮`);
  await expect(dialog.getByRole("button", { name: /提前完成本轮/ })).toContainText("记录本轮，并继续本场计划");
  await dialog.getByRole("button", { name: /提前完成本轮/ }).click();

  await expect(page.getByRole("button", { name: "开始下一轮" })).toBeVisible();
  await expect(page.getByText("本轮已提前完成，实际专注时间已记录。", { exact: true })).toBeVisible();
  await expect(page.getByText("小任务已提前完成，实际专注时间已记录。", { exact: true })).toHaveCount(0);
  await expect(page.locator('.marathon-progress-report')).toHaveCount(0);
});

test("cancelling an unstarted locked plan returns straight to the classic lane", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-08-03T08:00:00Z") });
  await createDefaultProject(page);
  await configureOneMinuteRounds(page);
  await page.getByRole("button", { name: "调整本次计划" }).click();
  const sheet = await pickEndTime1605(page);
  await sheet.getByRole("button", { name: "确认计划" }).click();
  await expect(page.locator(".world-screen")).not.toHaveClass(/is-focusing/);
  await expect(page.locator(".focus-task-context strong")).toHaveText("准备第 1 / 4 轮");
  await expect(page.locator(".workbench-context")).toHaveCount(1);
  await page.getByRole("button", { name: "调整本次计划" }).click();
  await expect(sheet.getByLabel('取消原因')).toHaveCount(0);
  await sheet.getByRole('button', { name: '取消计划', exact: true }).click();
  // Measure the ordinary timer after the frozen outgoing draft has left.
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "我的第一座工坊" })).toBeVisible();
  await expect(page.locator(".timer-label")).toHaveText("每轮时长");
  await expect(page.locator(".timer-value")).toHaveText("01:00");
  // No settlement for a marathon with zero finished rounds.
  await expect(page.locator('.marathon-progress-report')).toHaveCount(0);
});

test("habit marathons use the normal-task round duration everywhere", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-08-03T08:00:00Z") });
  await createDefaultProject(page);
  await configureDistinctNormalAndHabitRounds(page);

  await page.getByRole("button", { name: "任务", exact: true }).click();
  await page.getByRole("button", { name: "新增任务" }).click();
  await page.getByRole("button", { name: "习惯任务" }).click();
  await page.getByLabel("习惯名称").fill("晚间阅读");
  await page.getByRole("button", { name: "开始建造" }).click();

  await page.getByRole("button", { name: "调整本次计划" }).click();
  const sheet = page.getByRole("dialog", { name: "安排习惯专注" });
  await sheet.getByRole("button", { name: "按结束时间" }).click();
  await expect(sheet.locator(".plan-sheet-note")).toContainText("每轮 45 分钟");
  await expect(sheet.locator(".plan-sheet-note")).not.toContainText("每轮 20 分钟");
  await sheet.getByRole("button", { name: "确认计划" }).click();

  const schedule = await page.evaluate(() => JSON.parse(localStorage.getItem("blockcolc-round-plan-v1") ?? "null") as { totalRounds?: number; endAt?: string; status?: string } | null);
  expect(schedule).toMatchObject({ totalRounds: 2, status: "ready" });
  expect(Date.parse(schedule?.endAt ?? "")).toBeGreaterThan(Date.parse("2026-08-03T08:00:00Z"));
  await expect(page.locator(".focus-task-context strong")).toHaveText("准备第 1 / 2 轮");
  await page.getByRole("button", { name: /^开始到/ }).click();
  await expect(page.locator(".timer-label")).toHaveText("本轮剩余");
  // Rendering and the first tick can consume a few wall-clock seconds; the
  // value must still be in the 45-minute round, never the 20-minute habit round.
  await expect(page.locator(".timer-value")).toHaveText(/^(45:00|44:\d{2})$/);
});

test("settlement splits rounds between a habit building and subtasks on another project", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-08-03T08:00:00Z") });
  await createDefaultProject(page);
  await configureOneMinuteRounds(page);

  // Create a habit project (becomes active).
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await page.getByRole("button", { name: "新增任务" }).click();
  await page.getByRole("button", { name: "习惯任务" }).click();
  await page.getByLabel("习惯名称").fill("晚间阅读");
  await page.getByRole("button", { name: "开始建造" }).click();
  await expect(page.getByRole("heading", { name: "晚间阅读" })).toBeVisible();

  // Switch back to the finite project and lock a marathon on it.
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await page.locator(".choice-menu-trigger").click();
  await page.getByRole("option", { name: /我的第一座工坊/ }).click();
  await page.getByRole("button", { name: "计时" }).click();

  await page.getByRole("button", { name: "调整本次计划" }).click();
  const sheet = await pickEndTime1605(page);
  await sheet.getByRole("button", { name: "确认计划" }).click();

  // Finish two rounds.
  await page.getByRole("button", { name: /^开始到/ }).click();
  await page.clock.fastForward(61_000);
  await expect(page.getByRole("button", { name: "开始下一轮" })).toBeVisible();
  await startNextRound(page);
  await page.clock.fastForward(61_000);
  await expect(page.getByRole("button", { name: "开始下一轮" })).toBeVisible();

  // Cancel into the settlement: both the habit card and the finite project card
  // sit side by side.
  await openRetainedPlan(page);
  await (await preparePlanCancellation(sheet)).click();
  const report = await waitForMarathonReport(page);
  await expect(page.locator(".marathon-settlement-card")).toHaveCount(2);

  // Inspecting a habit must never allocate rounds on the user's behalf. Every
  // habit starts at zero and changes only through an explicit + action.
  const habitHead = page.locator(".marathon-settlement-head").first();
  await habitHead.click();
  const stepper = page.locator(".habit-round-stepper");
  await expect(stepper).toBeVisible();
  await expect(stepper.locator("strong")).toHaveText("0");
  await expect(stepper.locator("button[aria-label='减少计入轮数']")).toBeDisabled();

  // Merely expanding the habit leaves finite-task allocation available.
  await page.locator(".marathon-settlement-head").nth(1).click();
  const firstRow = page.locator(".marathon-report-row").first();
  await expect(firstRow.getByRole("button", { name: /推进至 25%/ })).toBeEnabled();

  // Explicitly split one round to the habit and the remainder to the subtask.
  await stepper.locator("button[aria-label='增加计入轮数']").click();
  await expect(stepper.locator("strong")).toHaveText("1");
  await firstRow.getByRole("button", { name: /推进至 25%/ }).click();
  await firstRow.getByRole("button", { name: /增加 .*计入轮数/ }).click();
  await page.getByRole("button", { name: "提交本次推进" }).click();

  await expect(report).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "我的第一座工坊" })).toBeVisible();
  // The finite subtask advanced (the habit rounds were verified in the stepper
  // above and by the domain tests).
  await expect(page.locator(".workbench-context")).toContainText("确定目标");
  await expect(page.locator(".workbench-context")).toContainText("25%");
});

test("switching the active project never drops or distracts a locked marathon plan", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-08-03T08:00:00Z") });
  await createDefaultProject(page);
  await configureOneMinuteRounds(page);

  // Create a second finite project while navigation is available. The plan is
  // still owned by the first project when it is locked below.
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await page.getByRole("button", { name: "新增任务" }).click();
  await page.getByLabel("大型任务").fill("第二项长期工作");
  await page.getByRole("button", { name: "开始建造" }).click();
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await page.locator(".choice-menu-trigger").click();
  await page.getByRole("option", { name: /我的第一座工坊/ }).click();
  await page.getByRole("button", { name: "计时" }).click();

  await page.getByRole("button", { name: "调整本次计划" }).click();
  const sheet = await pickEndTime1605(page);
  await sheet.getByRole("button", { name: "确认计划" }).click();
  await expect(page.locator(".world-screen")).not.toHaveClass(/is-focusing/);
  await expect(page.locator(".focus-task-context strong")).toHaveText("准备第 1 / 4 轮");
  await expect(page.locator(".workbench-context")).toHaveCount(1);

  // Exercise a legal external domain update: SwitchActiveProject is applied to a valid state,
  // committed under a new IndexedDB revision, and then recovered on reload.
  const beforeExternalSwitch = await readPersistedDomainState(page);
  const alternateProject = beforeExternalSwitch.state.projects.find((project) => project.title === "第二项长期工作");
  if (!alternateProject) throw new Error("alternate project missing for persisted switch");
  const switched = await executeAndReloadPersistedCommand(
    page,
    beforeExternalSwitch.state,
    { type: "SwitchActiveProject", projectId: alternateProject.id },
    Date.now(),
  );

  expect(switched.revision).toBe(beforeExternalSwitch.revision + 1);
  expect(switched.state.activeProjectId).toBe(alternateProject.id);
  await expect(page.locator(".world-screen")).not.toHaveClass(/is-focusing/);
  await expect(page.locator(".focus-task-context strong")).toHaveText("准备第 1 / 4 轮");
  await expect(page.getByRole("heading", { name: "第二项长期工作" })).toHaveCount(0);
  await expect(page.locator(".workbench-context")).toHaveCount(1);
  const persistedPlan = await page.evaluate(() => JSON.parse(localStorage.getItem("blockcolc-round-plan-v1") ?? "null") as { projectId?: string; subtaskId?: string | null; mode?: string; endAt?: string } | null);
  expect(persistedPlan?.projectId).toBe(beforeExternalSwitch.state.activeProjectId);
  expect(persistedPlan).toMatchObject({ mode: "marathon" });
  expect(Date.parse(persistedPlan?.endAt ?? "")).toBe(Date.parse("2026-08-03T08:05:00Z"));

  // Rounds still start on the original marathon host after active-project
  // recovery, not on the externally selected alternate project.
  await page.getByRole("button", { name: /^开始到/ }).click();
  await expect(page.locator(".focus-task-context strong")).toContainText(/专注中 第1\/\d+轮/);
  await expect(page.locator(".world-screen")).toHaveClass(/is-focusing/);
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeHidden();
  await expect(page.locator(".workbench-context")).toHaveCount(0);
});
