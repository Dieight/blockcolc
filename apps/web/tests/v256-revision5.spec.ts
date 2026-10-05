import {expect,test} from '@playwright/test';

test('world colour keeps one unframed neutral percentage per row; predictions occupy that same slot in both themes',async({page},info)=>{
  test.setTimeout(120000);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.addInitScript(()=>localStorage.setItem('blockcolc-focus-preferences-v1',JSON.stringify({minimalMode:false,lightingQuality:'performance',themeMode:'light'})));
  await page.goto('/');await page.getByRole('button',{name:'开始建造',exact:true}).click();
  await expect(page.locator('.world-screen')).toHaveAttribute('data-world-ready','true',{timeout:30000});
  await page.getByRole('button',{name:'设置',exact:true}).click();
  const controls=page.locator('.world-color-setting');await controls.locator('summary').click();
  for(const fontSize of [16,32]){
    await page.evaluate(size=>{document.documentElement.style.fontSize=`${size}px`;},fontSize);
    for(const theme of ['浅色','深色']){
    await page.getByRole('button',{name:theme,exact:true}).click();
    for(const name of ['饱和度','亮度','对比度']){
      const input=page.getByLabel(`世界${name}`,{exact:true}),physical=input.locator('..'),row=physical.locator('..'),output=row.locator('output');
      await input.fill('100');await physical.scrollIntoViewIfNeeded();
      const before=(await row.boundingBox())!,rail=(await physical.locator('.physical-slider-rail').boundingBox())!;
      await expect(output).toHaveCSS('color',theme==='浅色'?'rgb(17, 17, 17)':'rgb(255, 255, 255)');
      await expect(output).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
      await expect(output).toHaveCSS('border-width','0px');await expect(output).toHaveCSS('box-shadow','none');
      await page.mouse.move(rail.x+rail.width/2,rail.y+3);await page.mouse.down();
      await page.mouse.move(rail.x+rail.width/2-22,rail.y+48,{steps:6});
      await expect(output).toContainText('预计');await expect(physical.locator('output')).toHaveCount(0);
      expect((await row.boundingBox())!.height).toBeCloseTo(before.height,0);
      const textLayout=await output.evaluate(node=>{
        const style=getComputedStyle(node),ctx=document.createElement('canvas').getContext('2d')!;
        ctx.font=`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const rect=node.getBoundingClientRect();
        return {left:rect.left,right:rect.right,viewport:document.documentElement.clientWidth,
          available:node.clientWidth,required:ctx.measureText(node.textContent??'').width};
      });
      expect(textLayout.left).toBeGreaterThanOrEqual(0);expect(textLayout.right).toBeLessThanOrEqual(textLayout.viewport+.5);
      expect(textLayout.available).toBeGreaterThanOrEqual(textLayout.required);
      const predicted=Number((await output.innerText()).match(/\d+/)![0]);expect(predicted).toBeGreaterThan(100);
      await page.mouse.up();await expect(output).not.toContainText('预计');
      await expect(input).toHaveValue(String(predicted));await expect(output).toHaveText(`${predicted}%`);
    }
    await expect(controls.locator('output')).toHaveCount(3);
    await controls.screenshot({path:info.outputPath(`world-colour-${theme}-${fontSize}px.png`)});
    }
  }
});
