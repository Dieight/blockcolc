import { expect, test } from "@playwright/test";
import { expandGlassSetting } from './expand-glass-setting';

// V23 ③④: appearance settings (light/dark/system) and heatmap day detail on click.

async function createDefaultProject(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "开始建造" }).click();
  await expect(page.locator(".world-screen")).toBeVisible();
}

test("dark theme toggles the document theme from settings", async ({ page }) => {
  await createDefaultProject(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const dark = page.getByRole("button", { name: "深色" });
  await dark.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "计时" }).click();
  await expect(page.locator(".workbench-context")).toHaveCSS("border-left-color", "rgb(39, 103, 73)");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "浅色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test('numeric settings have no idle frame in either theme, but keep an accessible editing state',async({page},info)=>{
  await createDefaultProject(page);
  await page.getByRole('button',{name:'设置',exact:true}).click();
  for(const theme of ['浅色','深色']){
    await page.getByRole('button',{name:theme,exact:true}).click();
    const inputs=page.locator('.number-field input');
    const idle=await inputs.evaluateAll(nodes=>nodes.map(node=>({background:getComputedStyle(node).backgroundColor,border:getComputedStyle(node).borderTopColor})));
    expect(idle.length).toBeGreaterThanOrEqual(6);
    for(const style of idle)expect(style).toEqual({background:'rgba(0, 0, 0, 0)',border:'rgba(0, 0, 0, 0)'});
    await inputs.first().focus();
    expect(await inputs.first().evaluate(node=>getComputedStyle(node).borderTopColor)).not.toBe('rgba(0, 0, 0, 0)');
    await page.getByRole('heading',{name:'计时',exact:true}).click();
    await expect(inputs.first()).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
    await inputs.first().screenshot({path:info.outputPath(`numeric-${theme}.png`)});
  }
});

test('statistics keep the heatmap first, aggregate daily goals and share their archive surface',async({page},info)=>{
  await createDefaultProject(page);
  await page.getByRole('button',{name:'统计',exact:true}).click();
  const calendar=page.locator('.focus-heatmap-card'),period=page.locator('.stats-period-section'),archive=page.locator('.stats-archive-section');
  expect(await calendar.evaluate(node=>!!(node.compareDocumentPosition(document.querySelector('.stats-period-section')!)&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await page.getByRole('button',{name:'近 7 天',exact:true}).click();
  const rounds=page.locator('.stats-key-facts>div').filter({hasText:'有效完成轮次 / 目标完成轮次'});
  await expect(rounds.locator('strong')).toHaveText('0 / 56');
  await expect(page.locator('.project-allocation')).toHaveAttribute('data-chart-template','L14');
  await expect(page.locator('.allocation-bar')).toHaveCount(0);
  for(const theme of ['浅色','深色']){
    await page.getByRole('button',{name:'设置',exact:true}).click();
    await page.getByRole('button',{name:theme,exact:true}).click();
    await page.getByRole('button',{name:'统计',exact:true}).click();
    const style=(node:HTMLElement)=>({background:getComputedStyle(node).backgroundColor,border:getComputedStyle(node).borderTopColor,radius:getComputedStyle(node).borderRadius});
    expect(await archive.evaluate(style)).toEqual(await period.evaluate(style));
    await page.locator('.stats-page').screenshot({path:info.outputPath(`stats-order-${theme}.png`)});
  }
});

test("immersive glass transparency persists and keeps an adaptive dark material", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await createDefaultProject(page);
  const worldHudMaterial = await page.locator(".world-hud span").first().evaluate((element) => ({
    backdropFilter: getComputedStyle(element).backdropFilter,
    backgroundImage: getComputedStyle(element).backgroundImage,
  }));
  // Functional HUD glass is fixed; only the immersive clock consumes the slider.
  expect(worldHudMaterial.backdropFilter).toContain("blur(14px)");
  expect(worldHudMaterial.backgroundImage).toContain("linear-gradient");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const transparency = page.getByLabel("液态玻璃通透程度");
  await expandGlassSetting(page);
  await transparency.fill("0");
  await page.getByRole("button", { name: "计时", exact: true }).click();
  const maxBlur = await page.locator(".world-hud span").first().evaluate((element) => getComputedStyle(element).backdropFilter);
  expect(maxBlur).toContain("blur(14px)");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expandGlassSetting(page);
  await transparency.fill("100");
  await page.getByRole("button", { name: "计时", exact: true }).click();
  const minBlur = await page.locator(".world-hud span").first().evaluate((element) => getComputedStyle(element).backdropFilter);
  expect(minBlur).toBe(maxBlur);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expandGlassSetting(page);
  await transparency.fill("50");
  await transparency.fill("0");
  const frosted = await page.locator("html").evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      lightAlpha: root.getPropertyValue("--focus-glass-light-alpha").trim(),
      darkAlpha: root.getPropertyValue("--focus-glass-dark-alpha").trim(),
      blur: root.getPropertyValue("--focus-glass-blur").trim(),
    };
  });
  expect(frosted).toEqual({ lightAlpha: "0.900", darkAlpha: "0.900", blur: "32px" });

  await transparency.fill("100");
  const clear = await page.locator("html").evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      lightAlpha: root.getPropertyValue("--focus-glass-light-alpha").trim(),
      darkAlpha: root.getPropertyValue("--focus-glass-dark-alpha").trim(),
      blur: root.getPropertyValue("--focus-glass-blur").trim(),
    };
  });
  expect(clear).toEqual({ lightAlpha: "0.075", darkAlpha: "0.130", blur: "2px" });

  const sliderStyle = async () => transparency.evaluate((input) => {
    const style = getComputedStyle(input);
    const track = getComputedStyle(input, "::-webkit-slider-runnable-track");
    return {
      appearance: style.appearance,
      outlineStyle: style.outlineStyle,
      backgroundColor: style.backgroundColor,
      tapHighlight: style.getPropertyValue("-webkit-tap-highlight-color"),
      trackBackground: track.backgroundImage,
    };
  });
  const sliderBeforePress = await sliderStyle();
  const sliderBox = await transparency.boundingBox();
  expect(sliderBox).not.toBeNull();
  await page.mouse.move(sliderBox!.x + sliderBox!.width - 10, sliderBox!.y + sliderBox!.height / 2);
  await page.mouse.down();
  const sliderDuringPress = await sliderStyle();
  await page.mouse.up();
  expect(sliderDuringPress.appearance).toBe("none");
  expect(sliderDuringPress.outlineStyle).toBe("none");
  expect(sliderDuringPress.backgroundColor).toBe(sliderBeforePress.backgroundColor);
  expect(sliderDuringPress.trackBackground).toBe(sliderBeforePress.trackBackground);
  expect(sliderDuringPress.tapHighlight).toBe("rgba(0, 0, 0, 0)");

  await transparency.fill("80");
  await expect(transparency).toHaveValue("80");
  await expect(page.locator(".glass-transparency-control")).toContainText("80%");
  await page.getByRole("button", { name: "深色" }).click();

  await page.reload();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByLabel("液态玻璃通透程度")).toHaveValue("80");
  await page.getByRole("button", { name: "计时", exact: true }).click();
  await page.getByRole("button", { name: "开始 1 轮" }).click();
  await expect(page.getByLabel('项目建筑世界')).toHaveAttribute('data-glass-material', 'gpu');

  const material = await page.locator(".focus-panel").evaluate((panel) => {
    const style = getComputedStyle(panel);
    const root = getComputedStyle(document.documentElement);
    return {
      backgroundColor: style.backgroundColor,
      backdropFilter: style.backdropFilter,
      borderRadius: style.borderRadius,
      left: style.left,
      right: style.right,
      bottom: style.bottom,
      borderTopWidth: style.borderTopWidth,
      boxShadow: style.boxShadow,
      darkAlpha: root.getPropertyValue("--focus-glass-dark-alpha").trim(),
      blur: root.getPropertyValue("--focus-glass-blur").trim(),
    };
  });
  expect(material.darkAlpha).toBe("0.199");
  expect(material.blur).toBe("5.1px");
  // Engines serialize the same alpha with different decimal precision.
  expect(material.backgroundColor).toMatch(/^rgba\(20, 29, 25, [\d.]+\)$/);
  expect(Number(material.backgroundColor.match(/, ([\d.]+)\)$/)![1])).toBeCloseTo(.199, 2);
  expect(material.backdropFilter).toBe('none');
  expect(material.borderTopWidth).toBe("0px");
  expect(material.boxShadow).not.toContain("inset");
  expect(material.borderRadius).toBe("0px");
  expect(material.left).toBe("0px");
  expect(material.right).toBe("0px");
  expect(material.bottom).toBe("0px");
  await page.screenshot({ path: testInfo.outputPath("immersive-liquid-glass-dark-80.png"), fullPage: true });
  // Actual preference endpoints (including the GPU path) are exercised by
  // glass-material.spec.ts, not simulated by overriding CSS tokens on a live focus.
});

test("clicking a calendar day shows that day's focus detail without a date picker", async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date("2026-08-05T08:00:00Z") });
  await createDefaultProject(page);
  // 1-minute round, no break, so one round completes quickly.
  await page.getByRole("button", { name: "设置" }).click();
  const focusMinutes = page.getByLabel("普通任务专注分钟");
  await focusMinutes.fill("1");
  await focusMinutes.press("Enter");
  const breakMinutes = page.getByLabel("每轮休息分钟");
  await breakMinutes.fill("0");
  await breakMinutes.press("Enter");
  await page.getByRole("button", { name: "计时" }).click();
  await page.getByRole("button", { name: /^开始 \d+ 轮/ }).click();
  await page.clock.fastForward(61_000);
  await expect(page.getByRole("button", { name: /完成/ })).toBeVisible();
  await page.getByRole("button", { name: /完成/ }).click();

  await page.getByRole("button", { name: "统计", exact: true }).click();
  const unlockDialog = page.getByRole('dialog', { name: '新的成就' });
  await expect(unlockDialog).toBeVisible();
  await unlockDialog.getByRole('button', { name: '全部关闭' }).click();
  await expect(unlockDialog).toHaveCount(0);
  await page.locator('.focus-calendar-chart [data-date="2026-08-05"]').click();
  await expect(page.locator('.stats-page input[type="date"]')).toHaveCount(0);
  const tip = page.locator(".calendar-day-detail");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("1 分钟");
  await expect(tip).toContainText("1 次");
  await page.screenshot({path:testInfo.outputPath('calendar-filled-selected-light.png'),fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:'深色',exact:true}).click();
  await page.getByRole('button',{name:'统计',exact:true}).click();
  await page.screenshot({path:testInfo.outputPath('calendar-filled-selected-dark.png'),fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'查看前一天专注'}).click();
  await expect(tip).toContainText('这一天还没有有效专注记录');
  await page.getByRole('button',{name:'查看后一天专注'}).click();
  await expect(tip).toContainText('1 分钟');
  await page.getByRole('button',{name:'关闭日期详情'}).click();
  await expect(tip).toHaveCount(0);
  await page.locator('.focus-calendar-chart').press('End');
  await expect(tip).toContainText('2026年8月5日');
  await page.locator('.focus-calendar-chart').press('Escape');
  await expect(tip).toHaveCount(0);
});
