import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const sample = resolve(process.cwd(), "../../litematic/bd29cade-7000-42b7-adc1-0631ce512c30.litematic");

async function createDefaultProject(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "开始建造" }).click();
  await expect(page.locator(".world-screen")).toBeVisible();
}

test("opening and closing the plan sheet never moves the panel below the adjust row", async ({ page }) => {
  await createDefaultProject(page);
  const measure = () => page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return Math.round(box.top * 10) / 10;
    };
    return { timer: rect(".timer"), primary: rect(".v7-focus-panel .primary"), panel: rect(".v7-focus-panel"), world: rect(".world") };
  });
  const before = await measure();
  await page.getByRole("button", { name: "调整本次计划" }).click();
  await expect(page.getByRole("dialog", { name: "安排下一轮" })).toBeVisible();
  const during = await measure();
  await page.getByRole("button", { name: "确认计划" }).click();
  await page.waitForTimeout(400);
  const after = await measure();
  expect(during.timer).toBe(before.timer);
  expect(during.primary).toBe(before.primary);
  expect(during.panel).toBe(before.panel);
  expect(during.world).toBe(before.world);
  expect(after.timer).toBe(before.timer);
  expect(after.primary).toBe(before.primary);
});

test("marathon mode schedules from an end time and reports once after every round", async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date("2026-08-03T08:00:00Z") });
  await createDefaultProject(page);
  // 1-minute rounds with no breaks, so consecutive rounds auto-advance to ready.
  await page.getByRole("button", { name: "设置" }).click();
  const focusMinutes = page.getByLabel("普通任务专注分钟");
  await focusMinutes.fill("1");
  await focusMinutes.press("Enter");
  const breakMinutes = page.getByLabel("每轮休息分钟");
  await breakMinutes.fill("0");
  await breakMinutes.press("Enter");
  await page.getByRole("button", { name: "计时" }).click();

  await page.getByRole("button", { name: "调整本次计划" }).click();
  const sheet = page.getByRole("dialog", { name: "安排下一轮" });
  await sheet.getByRole("button", { name: "按结束时间" }).click();
  // Installed at 16:00 Shanghai; a 16:05 end gives 4-5 rounds regardless of drift.
  const endField = page.getByLabel("结束时间");
  await endField.fill("16:05");
  await expect(sheet).toContainText(/轮专注/);
  await sheet.getByRole("button", { name: "确认计划" }).click();

  const summary = (await page.locator(".plan-summary span").first().textContent()) ?? "";
  const total = Number(summary.match(/^(\d+) 轮/)?.[1]);
  expect(total).toBeGreaterThan(1);
  expect(summary).toContain("结束 16:05");
  await page.getByRole("button", { name: /^开始到/ }).click();
  await expect(page.locator(".session-kind")).toContainText(`第 1 / ${total} 轮专注`);

  for (let round = 1; round < total; round += 1) {
    await page.clock.fastForward(61_000);
    await expect(page.getByRole("button", { name: "开始下一轮" })).toBeVisible();
    await page.getByRole("button", { name: "开始下一轮" }).click();
    await expect(page.locator(".session-kind")).toContainText(`第 ${round + 1} / ${total} 轮专注`);
  }
  await page.clock.fastForward(61_000);
  await expect(page.getByRole("heading", { name: "这次长时间专注推进了哪些小任务？" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("v21-marathon-report.png"), fullPage: true });

  // One combined report advances several subtasks and ends the plan.
  const firstRow = page.locator(".marathon-report-row").first();
  await firstRow.getByRole("button", { name: /推进至 25%/ }).click();
  await page.getByRole("button", { name: "提交本次推进" }).click();
  await expect(page.getByRole("heading", { name: "这次长时间专注推进了哪些小任务？" })).toBeHidden();
  // Back to the workbench: the combined report advanced the first subtask.
  await expect(page.locator(".workbench-context")).toContainText("确定目标");
  await expect(page.locator(".workbench-context")).toContainText("25%");
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await expect(page.getByText("25%", { exact: false }).first()).toBeVisible();
});

test("marathon rounds unlock the wider round count in the plan summary", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-08-03T08:00:00Z") });
  await createDefaultProject(page);
  await page.getByRole("button", { name: "设置" }).click();
  const focusMinutes = page.getByLabel("普通任务专注分钟");
  await focusMinutes.fill("1");
  await focusMinutes.press("Enter");
  await page.getByRole("button", { name: "计时" }).click();
  await page.getByRole("button", { name: "调整本次计划" }).click();
  const sheet = page.getByRole("dialog", { name: "安排下一轮" });
  await sheet.getByRole("button", { name: "按结束时间" }).click();
  // Four hours out (default 5-minute breaks) is far beyond the old 4-round cap.
  await page.getByLabel("结束时间").fill("20:00");
  await expect(sheet).toContainText("24 轮");
  await sheet.getByRole("button", { name: "确认计划" }).click();
  await expect(page.locator(".plan-summary")).toContainText(/24 轮 · 结束 20:00/);
});

test("immersive top-right reveals and auto-hides the reset view button", async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date("2026-08-03T08:00:00Z") });
  await createDefaultProject(page);
  await page.getByRole("button", { name: "开始 1 轮" }).click();
  const canvas = page.getByLabel("项目建筑世界");
  // The frosted band lifts the world center into the visible window in portrait.
  await expect.poll(async () => {
    const value = await canvas.getAttribute("data-immersive-band-fraction");
    return value === null ? null : Number(value);
  }, { timeout: 8_000 }).toBeGreaterThan(0);
  // LX-03: the settlement centroid lands at NDC y = band, i.e. exactly at the
  // visible window's center (measured with the camera's real projection).
  const bandValue = Number(await canvas.getAttribute("data-immersive-band-fraction"));
  await expect.poll(async () => {
    const projected = await canvas.getAttribute("data-settlement-projected-y");
    return projected === null ? null : Number(projected);
  }, { timeout: 8_000 }).toBeGreaterThan(bandValue - 0.05);
  await expect(page.locator(".immersive-reset-view")).toHaveCount(0);

  // Tap the top-right corner of the immersive world.
  const world = await page.locator(".world").boundingBox();
  if (!world) throw new Error("Immersive world has no box");
  await page.mouse.click(world.x + world.width - 34, world.y + 60);
  const reset = page.locator(".immersive-reset-view");
  await expect(reset).toBeVisible();

  // Rotate the world away from the default azimuth, then reset it.
  await page.mouse.move(world.x + world.width / 2, world.y + world.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(world.x + world.width / 2 + 180, world.y + world.height * 0.4, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Number(await canvas.getAttribute("data-camera-azimuth"))).not.toBeCloseTo(Math.PI / 4, 1);
  await reset.click();
  await expect.poll(async () => Number(await canvas.getAttribute("data-camera-azimuth"))).toBeCloseTo(Math.PI / 4, 2);
  await page.screenshot({ path: testInfo.outputPath("v21-immersive-reset.png"), fullPage: true });

  // Same 5-second dwell as the other transient controls.
  await page.waitForTimeout(5_200);
  await expect(reset).toHaveCount(0);
});

test("habit workbench card speaks the library label, not the compatible-building fallback", async ({ page }) => {
  test.skip(!existsSync(sample), "The real Litematic compatibility fixture stays local.");
  await page.clock.install({ time: new Date("2026-08-03T08:00:00Z") });
  await createDefaultProject(page);
  // Import the fixture into the building library and rename it for determinism.
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByLabel("导入 .litematic").setInputFiles(sample);
  await page.getByRole("button", { name: "保存到建筑蓝图库" }).click();
  await page.getByRole("button", { name: /重命名“/ }).first().click();
  await page.getByRole("textbox", { name: /重命名“/ }).fill("V21 阅读大厅");
  await page.getByRole("button", { name: "保存蓝图名称" }).click();
  await expect(page.locator(".building-blueprint-list strong")).toHaveText("V21 阅读大厅");

  // Create a habit project whose current building is that imported blueprint.
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await page.getByRole("button", { name: "新增任务" }).click();
  await page.getByRole("button", { name: "习惯任务" }).click();
  await page.getByRole("radio", { name: /V21 阅读大厅/ }).check();
  await page.getByLabel("习惯名称").fill("晚间阅读");
  await page.getByRole("button", { name: "开始建造" }).click();
  const context = page.locator(".workbench-context");
  await expect(context).toContainText("V21 阅读大厅");
  await expect(context).not.toContainText("兼容建筑");
});
