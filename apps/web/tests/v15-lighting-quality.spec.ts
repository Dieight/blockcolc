import { expect, test } from "@playwright/test";

test("replaces the old visual experiments with persistent adaptive lighting presets", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  await page.clock.install({ time: new Date("2026-07-26T23:00:00+08:00") });
  await page.goto("/");
  await page.getByLabel("大型任务").fill("V15 光影验证");
  await page.getByRole("button", { name: "开始建造" }).click();

  const canvas = page.getByLabel("项目建筑世界");
  await expect(canvas).toHaveAttribute("data-requested-lighting-quality", "auto");
  await expect(canvas).toHaveAttribute("data-continuous-rendering", "false");

  await page.getByRole("button", { name: "设置" }).click();
  const quality = page.getByRole("group", { name: "光影质量" });
  await expect(quality.getByRole("button", { name: "自动" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("自动适配设备；更高档位可能增加耗电与发热")).toBeVisible();
  const constructionOutline = page.getByRole("group", { name: "施工轮廓" });
  await expect(constructionOutline.getByRole("button", { name: "当前" })).toHaveAttribute("aria-pressed", "true");
  await constructionOutline.getByRole("button", { name: "关闭" }).click();
  await page.getByRole("button", { name: "计时" }).click();
  await expect(canvas).toHaveAttribute("data-construction-outline-visibility", "off");
  await expect(canvas).toHaveAttribute("data-planned-outline-voxel-count", "0");
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByRole("group", { name: "施工轮廓" }).getByRole("button", { name: "当前" }).click();
  await page.getByRole("button", { name: "计时" }).click();
  await expect(canvas).toHaveAttribute("data-construction-outline-visibility", "current");
  await expect.poll(async () => Number(await canvas.getAttribute("data-planned-outline-voxel-count"))).toBeGreaterThan(0);
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByRole("group", { name: "施工轮廓" }).getByRole("button", { name: "全部" }).click();
  await page.getByRole("button", { name: "计时" }).click();
  await expect(canvas).toHaveAttribute("data-construction-outline-visibility", "all");
  await expect.poll(async () => Number(await canvas.getAttribute("data-planned-outline-voxel-count"))).toBeGreaterThan(0);
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByRole("group", { name: "施工轮廓" }).getByRole("button", { name: "当前" }).click();
  if (testInfo.project.name.includes("mobile")) {
    await page.screenshot({ path: testInfo.outputPath("lighting-setting-mobile.png"), fullPage: true });
  }

  await quality.getByRole("button", { name: "流畅" }).click();
  await page.getByRole("button", { name: "计时" }).click();
  await expect(canvas).toHaveAttribute("data-requested-lighting-quality", "performance");
  await expect(canvas).toHaveAttribute("data-active-lighting-quality", "performance");
  await expect(canvas).toHaveAttribute("data-bloom-enabled", "false");
  await expect(canvas).toHaveAttribute("data-fullscreen-pass-count", "0");
  await expect(canvas).toHaveAttribute("data-post-process-sample-count", "0");
  const performance = await canvas.screenshot({ path: testInfo.outputPath("lighting-performance.png") });

  await page.getByRole("button", { name: "设置" }).click();
  await page.getByRole("group", { name: "光影质量" }).getByRole("button", { name: "精致" }).click();
  await page.getByRole("button", { name: "计时" }).click();
  await expect(canvas).toHaveAttribute("data-requested-lighting-quality", "cinematic");
  const active = await canvas.getAttribute("data-active-lighting-quality");
  if (active === "cinematic") {
    await expect(canvas).toHaveAttribute("data-bloom-enabled", "true");
    await expect(canvas).toHaveAttribute("data-fullscreen-pass-count", "4");
    await expect(canvas).toHaveAttribute("data-post-process-sample-count", "2");
    await expect.poll(async () => Number(await canvas.getAttribute("data-post-process-render-count"))).toBeGreaterThan(0);
  } else {
    await expect(canvas).toHaveAttribute("data-bloom-enabled", "false");
    await expect(canvas).toHaveAttribute("data-fullscreen-pass-count", "0");
    await expect(canvas).toHaveAttribute("data-post-process-sample-count", "0");
  }
  const cinematic = await canvas.screenshot({ path: testInfo.outputPath("lighting-cinematic.png") });
  expect(Buffer.compare(performance, cinematic)).not.toBe(0);

  const box = await canvas.boundingBox();
  if (!box) throw new Error("World canvas has no layout box");
  const stableBeforeInteraction = await canvas.screenshot({ path: testInfo.outputPath("lighting-stable-before-interaction.png") });
  const rendersBefore = Number(await canvas.getAttribute("data-post-process-render-count"));
  const bypassBefore = Number(await canvas.getAttribute("data-post-process-bypass-count"));
  await canvas.dispatchEvent("pointerdown", { pointerId: 51, pointerType: "touch", isPrimary: true, clientX: box.x + box.width * 0.2, clientY: box.y + box.height * 0.5, buttons: 1 });
  if (active === "cinematic") {
    await expect.poll(async () => Number(await canvas.getAttribute("data-post-process-render-count"))).toBeGreaterThan(rendersBefore);
    expect(Number(await canvas.getAttribute("data-post-process-bypass-count"))).toBe(bypassBefore);
    const directInteraction = await canvas.screenshot({ path: testInfo.outputPath("lighting-direct-interaction.png") });
    expect(await meanLuminanceDifference(page, stableBeforeInteraction, directInteraction)).toBeLessThan(8);
  }
  await canvas.dispatchEvent("pointermove", { pointerId: 51, pointerType: "touch", isPrimary: true, clientX: box.x + box.width * 0.7, clientY: box.y + box.height * 0.5, buttons: 1 });
  if (active === "cinematic") {
    await expect.poll(async () => Number(await canvas.getAttribute("data-post-process-render-count"))).toBeGreaterThan(rendersBefore + 1);
    expect(Number(await canvas.getAttribute("data-post-process-bypass-count"))).toBe(bypassBefore);
    const rotatedInteraction = await canvas.screenshot({ path: testInfo.outputPath("lighting-rotated-interaction.png") });
    expect(Buffer.compare(stableBeforeInteraction, rotatedInteraction)).not.toBe(0);
  }
  await canvas.dispatchEvent("pointerup", { pointerId: 51, pointerType: "touch", isPrimary: true, clientX: box.x + box.width * 0.7, clientY: box.y + box.height * 0.5, buttons: 0 });

  await page.reload();
  await expect(page.getByLabel("项目建筑世界")).toHaveAttribute("data-requested-lighting-quality", "cinematic");
  expect(pageErrors).toEqual([]);
});

test("migrates an enabled legacy visual experiment to the cinematic preset", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("blockcolc-focus-preferences-v1", JSON.stringify({
      focusMinutes: 45,
      habitFocusMinutes: 45,
      habitTargetRounds: 10,
      breakMinutes: 5,
      visualExperiment: "water",
    }));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("group", { name: "光影质量" }).getByRole("button", { name: "精致" }))
    .toHaveAttribute("aria-pressed", "true");
});

async function meanLuminanceDifference(page: import("@playwright/test").Page, left: Buffer, right: Buffer): Promise<number> {
  return page.evaluate(async ({ leftBase64, rightBase64 }) => {
    const average = async (value: string) => {
      const response = await fetch(`data:image/png;base64,${value}`);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      bitmap.close();
      let total = 0;
      for (let index = 0; index < data.length; index += 4) {
        total += data[index]! * 0.2126 + data[index + 1]! * 0.7152 + data[index + 2]! * 0.0722;
      }
      return total / (data.length / 4);
    };
    return Math.abs(await average(leftBase64) - await average(rightBase64));
  }, { leftBase64: left.toString("base64"), rightBase64: right.toString("base64") });
}
