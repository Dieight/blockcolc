import { test } from "@playwright/test";
test("reports page load diagnostics on preview", async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push("PAGE:" + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("CONSOLE:" + m.text().slice(0, 200));
  });
  page.on("requestfailed", (r) => errors.push("REQFAIL:" + r.url().slice(0, 160)));
  await page.goto("/?__immersiveRightBand=0.35");
  await page.waitForTimeout(3_000);
  const info = await page.evaluate(() => ({
    scripts: [...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src")),
    sw: navigator.serviceWorker ? "present" : "none",
  }));
  console.log("LOAD_INFO " + JSON.stringify(info));
  console.log("LOAD_ERRORS " + JSON.stringify(errors));
});
