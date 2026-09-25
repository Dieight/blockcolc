import { expect, test } from "@playwright/test";

// Focused renderer contract for the F05/F06/F07/F08/F13 follow-up.  The
// assertions use the real preview/world canvas diagnostics (not a fabricated
// dataset) and are classified with the renderer release suite.

test.describe("world follow-up renderer contract", () => {
  test("preview clouds scale with small and large blueprint content", async ({ page }, testInfo) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto("/");
    // The first-run setup owns the preview.  Clicking “开始建造” navigates to
    // the world and unmounts `.blueprint-preview`, so inspect both blueprints
    // before submitting the form.
    const preview = page.locator(".blueprint-preview canvas");
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("data-cloud-budget-mode", "preview");
    await expect.poll(async () => Number(await preview.getAttribute("data-cloud-block-count"))).toBeGreaterThan(0);
    const small = {
      blocks: Number(await preview.getAttribute("data-cloud-block-count")),
      scale: Number(await preview.getAttribute("data-cloud-block-scale")),
      spanX: Number(await preview.getAttribute("data-cloud-span-x")),
      spanZ: Number(await preview.getAttribute("data-cloud-span-z")),
    };
    await preview.screenshot({ path: testInfo.outputPath("preview-cloud-small.png") });

    await page.locator("label.blueprint-option").filter({ hasText: "礼拜堂" }).click();
    await expect.poll(async () => Number(await preview.getAttribute("data-cloud-block-count"))).toBeGreaterThan(0);
    const large = {
      blocks: Number(await preview.getAttribute("data-cloud-block-count")),
      scale: Number(await preview.getAttribute("data-cloud-block-scale")),
      spanX: Number(await preview.getAttribute("data-cloud-span-x")),
      spanZ: Number(await preview.getAttribute("data-cloud-span-z")),
    };
    await preview.screenshot({ path: testInfo.outputPath("preview-cloud-large.png") });
    expect(small.blocks).toBeLessThan(large.blocks);
    expect(small.scale).toBeLessThan(large.scale);
    expect(small.spanX).toBeLessThan(large.spanX);
    expect(small.spanZ).toBeLessThan(large.spanZ);
  });

  test("real local time updates sun, moon, and shadow vectors", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-06-21T05:00:00+08:00") });
    await page.addInitScript(() => localStorage.clear());
    await page.goto("/");
    await page.getByRole("button", { name: "开始建造" }).click();
    const canvas = page.getByLabel("项目建筑世界");
    await expect.poll(async () => canvas.getAttribute("data-sun-position")).toMatch(/,/);
    const before = {
      sun: await canvas.getAttribute("data-sun-position"),
      moon: await canvas.getAttribute("data-moon-position"),
      shadow: await canvas.getAttribute("data-shadow-direction"),
      fingerprint: await canvas.getAttribute("data-lighting-fingerprint"),
    };
    await page.clock.fastForward(6 * 60 * 60 * 1000);
    await expect.poll(async () => canvas.getAttribute("data-lighting-fingerprint"), { timeout: 15_000 })
      .not.toBe(before.fingerprint);
    expect(await canvas.getAttribute("data-sun-position")).not.toBe(before.sun);
    expect(await canvas.getAttribute("data-moon-position")).not.toBe(before.moon);
    expect(await canvas.getAttribute("data-shadow-direction")).not.toBe(before.shadow);
    expect(Number(await canvas.getAttribute("data-lighting-update-count"))).toBeGreaterThan(1);
  });

  for (const [label, expectedOcean] of [["自然山谷", false], ["经典空岛", false], ["海洋小岛", true]] as const) {
    test(`renders visible ambient decorations in ${label}`, async ({ page }, testInfo) => {
      await page.addInitScript(() => localStorage.clear());
      await page.goto("/");
      await page.getByRole("button", { name: "开始建造" }).click();
      await page.getByRole("button", { name: "设置", exact: true }).click();
      await page.getByRole("group", { name: "聚落环境" }).getByRole("button", { name: label }).click();
      await page.getByRole("button", { name: "计时", exact: true }).click();
      const canvas = page.getByLabel("项目建筑世界");
      await expect.poll(async () => Number(await canvas.getAttribute("data-ambient-decoration-count"))).toBeGreaterThanOrEqual(4);
      expect(Number(await canvas.getAttribute("data-ambient-decoration-kind-count"))).toBeGreaterThanOrEqual(2);
      await canvas.screenshot({ path: testInfo.outputPath(`ambient-${label}.png`) });
    });

    test(`keeps building and road supports above terrain in ${label}`, async ({ page }) => {
      await page.addInitScript(() => localStorage.clear());
      await page.goto("/");
      await page.getByRole("button", { name: "开始建造" }).click();
      await page.getByRole("button", { name: "设置", exact: true }).click();
      await page.getByRole("group", { name: "聚落环境" }).getByRole("button", { name: label }).click();
      await page.getByRole("button", { name: "计时", exact: true }).click();
      const canvas = page.getByLabel("项目建筑世界");
      await expect(canvas).toHaveAttribute("data-environment-style", {
        natural: "natural-valley",
        classic: "classic-island",
        ocean: "ocean-island",
      }[label === "自然山谷" ? "natural" : label === "经典空岛" ? "classic" : "ocean"]!);
      await expect.poll(async () => Number(await canvas.getAttribute("data-road-cell-count"))).toBeGreaterThan(0);
      const buildingSupport = Number(await canvas.getAttribute("data-building-support-min-y"));
      const roadSupport = Number(await canvas.getAttribute("data-road-support-min-y"));
      expect(buildingSupport).toBeGreaterThanOrEqual(expectedOcean ? 4 : 0);
      expect(roadSupport).toBeGreaterThanOrEqual(buildingSupport - 2);
      if (expectedOcean) expect(buildingSupport).toBeGreaterThanOrEqual(4);
      expect(Number(await canvas.getAttribute("data-terrain-cell-count"))).toBeGreaterThan(0);
    });
  }
});
