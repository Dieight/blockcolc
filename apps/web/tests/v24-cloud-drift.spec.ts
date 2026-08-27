import { expect, test } from "@playwright/test";

// by the stale-pointer guard (remove before release).

test("interacting clears on pointercancel and stale pointers", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.getByRole("button", { name: "开始建造" }).click();
  const canvas = page.getByLabel("项目建筑世界");
  await expect(canvas).toHaveAttribute("data-environment-style", "natural-valley");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no box");
  const cy = box.y + box.height * 0.5;
  const interacting = () => canvas.getAttribute("data-interacting").then((value) => value === "true");

  // Initially idle.
  await page.waitForTimeout(800);
  await expect.poll(interacting, { timeout: 2_000 }).toBe(false);

  // Press without releasing: interacting locks.
  await page.mouse.move(box.x + box.width * 0.4, cy);
  await page.mouse.down();
  await expect.poll(interacting, { timeout: 4_000 }).toBe(true);

  // System gesture steals the pointer via pointercancel: released instantly.
  await canvas.dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse", clientX: 0, clientY: 0 });
  await expect.poll(interacting, { timeout: 4_000 }).toBe(false);

  // Press again and never release: the stale guard releases the interaction.
  await page.mouse.down();
  await expect.poll(interacting, { timeout: 4_000 }).toBe(true);
  await expect.poll(interacting, { timeout: 8_000 }).toBe(false);
  await page.mouse.up();
});