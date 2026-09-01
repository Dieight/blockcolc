import { expect, test, type Locator } from "@playwright/test";

// V24 contract: pointer cancellation releases interaction immediately, while a
// missing terminal event is recovered by the renderer's stale-pointer guard.

test("interacting clears on pointercancel and stale pointers", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.getByRole("button", { name: "开始建造" }).click();
  const canvas = page.getByLabel("项目建筑世界");
  await expect(canvas).toHaveAttribute("data-environment-style", "natural-valley");
  await expect.poll(async () => Number(await canvas.getAttribute("data-render-triangles"))).toBeGreaterThan(1_000);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no box");
  const cy = box.y + box.height * 0.5;
  const interacting = () => canvas.getAttribute("data-interacting").then((value) => value === "true");

  // Initially idle.
  await page.waitForTimeout(800);
  await expect.poll(interacting, { timeout: 2_000 }).toBe(false);

  // Press without releasing: interacting locks.
  const firstPointer = { pointerId: 71, pointerType: "touch", isPrimary: true, clientX: box.x + box.width * 0.4, clientY: cy };
  // Read the synchronous handler result in the same browser task. On a loaded
  // software-WebGL worker, a later Playwright poll can resume only after the
  // 2.5-second stale guard has already (correctly) released the pointer.
  expect(await dispatchPointerAndReadInteracting(canvas, "pointerdown", { ...firstPointer, buttons: 1 })).toBe("true");

  // System gesture steals the pointer via pointercancel: released instantly.
  expect(await dispatchPointerAndReadInteracting(canvas, "pointercancel", { ...firstPointer, buttons: 0 })).toBe("false");

  // Press again and never release: the stale guard releases the interaction.
  expect(await dispatchPointerAndReadInteracting(canvas, "pointerdown", { ...firstPointer, pointerId: 72, buttons: 1 })).toBe("true");
  await expect.poll(interacting, { timeout: 8_000 }).toBe(false);
});

interface PointerProbeInit {
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  clientX: number;
  clientY: number;
  buttons: number;
}

async function dispatchPointerAndReadInteracting(
  canvas: Locator,
  type: "pointerdown" | "pointercancel",
  init: PointerProbeInit,
): Promise<string | null> {
  return canvas.evaluate((node, event) => {
    node.dispatchEvent(new PointerEvent(event.type, {
      bubbles: true,
      cancelable: true,
      ...event.init,
    }));
    return (node as HTMLCanvasElement).dataset.interacting ?? null;
  }, { type, init });
}
