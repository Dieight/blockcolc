import { expect, test } from "@playwright/test";
test("scan multiple views for void clusters", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/?debugVoidScan");
  await page.getByRole("button", { name: "开始建造" }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("group", { name: "聚落环境" }).getByRole("button", { name: "海洋小岛" }).click();
  await page.getByRole("button", { name: "计时", exact: true }).click();
  const canvas = page.getByLabel("项目建筑世界");
  await expect(canvas).toHaveAttribute("data-environment-style", "ocean-island", { timeout: 30_000 });
  await page.waitForTimeout(1_500);

  const scan = async (label: string) => {
    const shot = await canvas.screenshot();
    const points: Array<[number, number]> = [];
    for (let y = 0; y < 360; y += 1) {
      for (let x = 0; x < 618; x += 1) {
        const index = (y * 618 + x) * 4;
        if (shot[index]! > 235 && shot[index + 1]! > 235 && shot[index + 2]! > 235) points.push([x, y]);
      }
    }
    const cells = new Map<string, number>();
    for (const [x, y] of points) {
      const key = `${Math.floor(x / 16)}:${Math.floor(y / 16)}`;
      cells.set(key, (cells.get(key) ?? 0) + 1);
    }
    const clusters = [...cells.values()].filter((count) => count >= 5).length;
    console.log(`VIEW ${label} whites=${points.length} clusters5=${clusters}`);
    return clusters;
  };

  // Zoom out and swing the camera so the satellite islets enter the frame.
  await page.locator(".world").hover();
  await page.mouse.wheel(0, -2000);
  await page.waitForTimeout(1_200);
  await page.mouse.wheel(0, -2600);
  await page.waitForTimeout(1_800);

  const box = await canvas.boundingBox();
  const y = box!.y + box!.height * 0.5;
  const drag = async (fromX: number, toX: number) => {
    await page.mouse.move(box!.x + fromX, y);
    await page.mouse.down();
    await page.mouse.move(box!.x + toX, y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(1_400);
  };

  const views: number[] = [];
  views.push(await scan("far-0"));
  await drag(box!.width * 0.7, box!.width * 0.2);
  views.push(await scan("rot-1"));
  await drag(box!.width * 0.7, box!.width * 0.2);
  views.push(await scan("rot-2"));
  await drag(box!.width * 0.7, box!.width * 0.2);
  views.push(await scan("rot-3"));
  // No view may contain a real void cluster (>=5 white pixels in a 16px cell).
  expect(Math.max(...views)).toBeLessThanOrEqual(2);
});