import { expect, test } from "@playwright/test";
import { executeAndReloadPersistedCommand, readPersistedDomainState } from "./persisted-domain-state";

// V22: the end-time (marathon) plan persists independently of the current task.
// Confirmation moves directly to the shared immersive ready face; canceling
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

async function revealFocusControls(page: import("@playwright/test").Page) {
  const endButton = page.getByRole("button", { name: "结束本次专注" });
  if (await endButton.isVisible().catch(() => false)) return;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.dispatchEvent(".focus-panel", "pointerup", { pointerId: 7, clientX: 20, clientY: 20, pointerType: "touch", isPrimary: true });
    await page.dispatchEvent(".focus-panel", "pointerup", { pointerId: 7, clientX: 20, clientY: 20, pointerType: "touch", isPrimary: true });
    await page.waitForTimeout(300);
    if (await endButton.isVisible().catch(() => false)) return;
  }
  throw new Error("Focus controls did not reveal after repeated double-taps");
}

// Installed at 16:00 Shanghai; the custom stepper starts at 18:00, so step it to
// 16:05 for a short (1-minute) marathon.
async function pickEndTime1605(page: import("@playwright/test").Page) {
  const sheet = page.getByRole("dialog", { name: "安排下一轮" });
  await sheet.getByRole("button", { name: "按结束时间" }).click();
  await page.getByLabel("减少结束小时").click();
  await page.getByLabel("减少结束小时").click();
  await page.getByLabel("增加结束分钟").click();
  await expect(sheet).toContainText(/轮专注/);
  return sheet;
}

test("confirming locks the plan on the shared ready face; cancel settles", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-08-03T08:00:00Z") });
  await createDefaultProject(page);
  await configureOneMinuteRounds(page);
  await page.getByRole("button", { name: "调整本次计划" }).click();
  const sheet = await pickEndTime1605(page);
  await sheet.getByRole("button", { name: "确认计划" }).click();
  await expect(page.locator(".dialog-backdrop")).toHaveCount(0);

  // A confirmed plan is already on the shared immersive ready face. Its
  // persistent schedule keeps the marathon host and round count.
  await expect(page.locator(".world-screen")).toHaveClass(/is-focusing/);
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "按结束时间排程" })).toHaveCount(0);
  await expect(page.locator(".focus-task-context strong")).toHaveText("准备第 1 / 4 轮");
  await expect(page.locator(".workbench-context")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "切换任务" })).toHaveCount(0);
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
  await page.getByRole("button", { name: "调整本次计划" }).click();
  const reopen = page.getByRole("dialog", { name: "安排下一轮" });
  const cancel = reopen.getByRole("button", { name: "取消计划" });
  await expect(cancel).toBeVisible();
  await expect(cancel).toHaveClass(/destructive/);
  await cancel.click();

  // Cancelling a locked marathon settles the finished round into the report.
  // The settlement is a scrollable report surface (has-report layout), so the
  // bottom content stays reachable on small screens.
  await expect(page.getByRole("heading", { name: "把这次推进汇报给哪些任务？" })).toBeVisible();
  await expect(page.locator(".world-screen")).toHaveClass(/has-report/);
  await page.locator(".marathon-settlement-head").first().click();
  await page.locator(".marathon-report-row").first().getByRole("button", { name: /推进至 25%/ }).click();
  await page.locator(".marathon-report-row").first().getByRole("button", { name: /增加 .*计入轮数/ }).click();
  await page.getByRole("button", { name: "提交本次推进" }).click();
  await expect(page.getByRole("heading", { name: "把这次推进汇报给哪些任务？" })).toBeHidden();
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
  await expect(page.getByRole("heading", { name: "把这次推进汇报给哪些任务？" })).toHaveCount(0);
});

test("cancelling an unstarted locked plan returns straight to the classic lane", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-08-03T08:00:00Z") });
  await createDefaultProject(page);
  await configureOneMinuteRounds(page);
  await page.getByRole("button", { name: "调整本次计划" }).click();
  const sheet = await pickEndTime1605(page);
  await sheet.getByRole("button", { name: "确认计划" }).click();
  await expect(page.locator(".world-screen")).toHaveClass(/is-focusing/);
  await expect(page.locator(".focus-task-context strong")).toHaveText("准备第 1 / 4 轮");
  await expect(page.locator(".workbench-context")).toHaveCount(0);
  await page.getByRole("button", { name: "调整本次计划" }).click();
  await sheet.getByRole("button", { name: "取消计划" }).click();
  await expect(page.getByRole("heading", { name: "我的第一座工坊" })).toBeVisible();
  await expect(page.locator(".timer-label")).toHaveText("每轮时长");
  await expect(page.locator(".timer-value")).toHaveText("01:00");
  // No settlement for a marathon with zero finished rounds.
  await expect(page.getByRole("heading", { name: "把这次推进汇报给哪些任务？" })).toHaveCount(0);
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
  await expect(sheet.locator(".plan-sheet-note")).toContainText("普通任务设置的 45 分钟为一轮");
  await expect(sheet.locator(".plan-sheet-note")).not.toContainText("20 分钟为一轮");
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
  await page.getByRole("button", { name: "开始下一轮" }).click();
  await page.clock.fastForward(61_000);
  await expect(page.getByRole("button", { name: "开始下一轮" })).toBeVisible();

  // Cancel into the settlement: both the habit card and the finite project card
  // sit side by side.
  await page.getByRole("button", { name: "调整本次计划" }).click();
  await sheet.getByRole("button", { name: "取消计划" }).click();
  await expect(page.getByRole("heading", { name: "把这次推进汇报给哪些任务？" })).toBeVisible();
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

  await expect(page.getByRole("heading", { name: "把这次推进汇报给哪些任务？" })).toBeHidden();
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
  await expect(page.locator(".world-screen")).toHaveClass(/is-focusing/);
  await expect(page.locator(".focus-task-context strong")).toHaveText("准备第 1 / 4 轮");
  await expect(page.locator(".workbench-context")).toHaveCount(0);

  // The ready face hides global tabs after locking. Simulate the legal external
  // domain update instead: SwitchActiveProject is applied to a valid state,
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
  await expect(page.locator(".world-screen")).toHaveClass(/is-focusing/);
  await expect(page.locator(".focus-task-context strong")).toHaveText("准备第 1 / 4 轮");
  await expect(page.getByRole("heading", { name: "第二项长期工作" })).toHaveCount(0);
  await expect(page.locator(".workbench-context")).toHaveCount(0);
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
