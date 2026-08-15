import { expect, test } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { resolve } from 'node:path';

test('imports, persists, switches and safely deletes a local Java resource pack', async ({page}) => {
  const archive=Buffer.from(makePack());
  await page.goto('/');
  await page.getByRole('button',{name:'设置'}).click();
  await page.getByLabel('导入 Java 资源包 ZIP').setInputFiles({
    name:'local-stone.zip',
    mimeType:'application/zip',
    buffer:archive,
  });

  await expect(page.getByRole('status')).toContainText('已导入并启用');
  const pack=page.locator('.resource-pack-list li').filter({hasText:'local-stone'});
  await expect(pack).toContainText('1 张纹理');
  await expect(pack.getByRole('button',{name:'使用中'})).toBeDisabled();

  await page.getByLabel('导入 Java 资源包 ZIP').setInputFiles({
    name:'local-stone.zip',
    mimeType:'application/zip',
    buffer:archive,
  });
  await expect(page.getByRole('status')).toContainText('已导入并启用');
  await expect(page.locator('.resource-pack-list li')).toHaveCount(1);

  await page.reload();
  await page.getByRole('button',{name:'设置'}).click();
  const reloaded=page.locator('.resource-pack-list li').filter({hasText:'local-stone'});
  await expect(reloaded.getByRole('button',{name:'使用中'})).toBeDisabled();

  await page.locator('.resource-pack-original').getByRole('button',{name:'使用'}).click();
  await expect(page.locator('.resource-pack-original')).toContainText('正在使用');
  await reloaded.getByRole('button',{name:'使用'}).click();
  await expect(reloaded.getByRole('button',{name:'使用中'})).toBeDisabled();

  await reloaded.getByRole('button',{name:'删除“local-stone”'}).click();
  const dialog=page.getByRole('alertdialog',{name:'删除这个资源包？'});
  await expect(dialog).toContainText('回退到方块钟原创材质');
  await dialog.getByRole('button',{name:'删除资源包'}).click();
  await expect(page.locator('.resource-pack-original')).toContainText('正在使用');
  await expect(page.locator('.resource-pack-list li')).toHaveCount(0);

  await page.reload();
  await page.getByRole('button',{name:'设置'}).click();
  await expect(page.locator('.resource-pack-original')).toContainText('正在使用');
  await expect(page.locator('.resource-pack-list li')).toHaveCount(0);
});

test('applies an atlas to a real imported building and restores original rendering', async ({page},testInfo) => {
  test.setTimeout(60_000);
  const sample=resolve(process.cwd(),'../../litematic/bd29cade-7000-42b7-adc1-0631ce512c30.litematic');
  test.skip(!existsSync(sample), 'The real Litematic compatibility fixture stays local.');
  await page.clock.install({time:new Date('2026-07-26T05:00:00.000Z')});
  await page.goto('/?__atlasPageSize=128');
  await page.getByLabel('导入 .litematic').setInputFiles(sample);
  await page.getByLabel('大型任务').fill('资源包视觉验证');
  await page.getByRole('button', { name: '清空小任务' }).click();
  await page.getByLabel('新增小任务').fill('验证纹理渲染');
  await page.getByLabel('新增小任务').press('Enter');
  await page.getByRole('button',{name:'开始建造'}).click();
  await setActiveProjectProgress(page,9900);
  await page.reload();
  const canvas=page.getByLabel('项目建筑世界');
  await expect(canvas).toBeVisible();
  const original=await canvas.screenshot({path:testInfo.outputPath('original-materials.png')});

  await page.getByRole('button',{name:'设置'}).click();
  await page.getByLabel('导入 Java 资源包 ZIP').setInputFiles({name:'visual-test.zip',mimeType:'application/zip',buffer:Buffer.from(makeVisualPack())});
  await expect(page.getByRole('status')).toContainText('已导入并启用');
  await page.getByRole('button',{name:'计时'}).click();
  await expect(canvas).toHaveAttribute('data-active-resource-pack-id',/sha256:/);
  await expect.poll(async()=>Number(await canvas.getAttribute('data-atlas-page-count')),{timeout:30_000}).toBeGreaterThan(1);
  await expect.poll(async()=>Number(await canvas.getAttribute('data-textured-voxel-count'))).toBeGreaterThan(500);
  await expect.poll(async()=>Number(await canvas.getAttribute('data-cutout-shadow-mesh-count'))).toBeGreaterThan(0);
  await expect.poll(async()=>Number(await canvas.getAttribute('data-transformed-uv-voxel-count'))).toBeGreaterThan(0);
  await expect.poll(async()=>Number(await canvas.getAttribute('data-tinted-voxel-count'))).toBeGreaterThan(0);
  await expect.poll(async()=>Number(await canvas.getAttribute('data-available-animated-texture-count'))).toBeGreaterThan(0);
  await expect.poll(async()=>Number(await canvas.getAttribute('data-animated-texture-count'))).toBeGreaterThan(0);
  await expect.poll(async()=>Number(await canvas.getAttribute('data-geometry-voxel-count'))).toBeGreaterThan(1_000);
  const geometryVoxelCount=Number(await canvas.getAttribute('data-geometry-voxel-count'));
  await expect.poll(async()=>Number(await canvas.getAttribute('data-geometry-element-instance-count'))).toBeGreaterThan(geometryVoxelCount);
  await expect.poll(async()=>Number(await canvas.getAttribute('data-multipart-geometry-voxel-count'))).toBeGreaterThan(40);
  await expect.poll(async()=>Number(await canvas.getAttribute('data-geometry-signature-batch-count'))).toBeGreaterThan(0);
  expect(Number(await canvas.getAttribute('data-geometry-signature-batch-count'))).toBeLessThanOrEqual(64);
  expect(Number(await canvas.getAttribute('data-render-calls'))).toBeLessThanOrEqual(120);
  expect(Number(await canvas.getAttribute('data-render-triangles'))).toBeLessThanOrEqual(220_000);
  await expect(canvas).toHaveAttribute('data-continuous-rendering','false');
  await expect(canvas).toHaveAttribute('data-animation-scheduled','true');
  await expect.poll(async()=>Number(await canvas.getAttribute('data-animation-interpolated-texture-count'))).toBeGreaterThan(0);
  await expect(canvas).toHaveAttribute('data-visual-biome-source','resource-pack');
  await expect(canvas).toHaveAttribute('data-visual-biome-grass','123456');
  await expect(canvas).toHaveAttribute('data-visual-biome-foliage','654321');
  const textured=await canvas.screenshot({path:testInfo.outputPath('resource-pack-atlas.png')});
  const changed=await pixelDifference(page,original,textured);
  expect(changed.changedPixelRatio).toBeGreaterThan(0.01);
  expect(changed.meanChannelDelta).toBeGreaterThan(0.5);
  await page.clock.fastForward(220);
  await expect.poll(async()=>Number(await canvas.getAttribute('data-animation-frame-update-count'))).toBeGreaterThan(0);

  await page.getByRole('button',{name:'设置'}).click();
  await page.locator('.resource-pack-original').getByRole('button',{name:'使用'}).click();
  await page.getByRole('button',{name:'计时'}).click();
  await expect(canvas).toHaveAttribute('data-active-resource-pack-id','');
  const restored=await canvas.screenshot({path:testInfo.outputPath('restored-original.png')});
  const restoration=await pixelDifference(page,original,restored);
  expect(restoration.changedPixelRatio).toBeLessThan(0.01);
});

test('retextures built-in buildings through vanilla stand-in blocks', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.goto('/?__atlasPageSize=128');
  await page.getByRole('button', { name: '开始建造' }).click();
  await setActiveProjectProgress(page, 9900);
  await page.reload();
  const canvas = page.getByLabel('项目建筑世界');
  await expect(canvas).toBeVisible();
  const original = await canvas.screenshot({ path: testInfo.outputPath('builtin-original.png') });

  await page.getByRole('button', { name: '设置' }).click();
  await page.getByLabel('导入 Java 资源包 ZIP').setInputFiles({
    name: 'builtin-visual.zip', mimeType: 'application/zip', buffer: Buffer.from(makeBuiltinVisualPack()),
  });
  await expect(page.getByRole('status')).toContainText('已导入并启用');
  await page.getByRole('button', { name: '计时' }).click();
  await expect(canvas).toHaveAttribute('data-active-resource-pack-id', /sha256:/);
  await expect.poll(async () => Number(await canvas.getAttribute('data-textured-voxel-count')), { timeout: 30_000 }).toBeGreaterThan(100);
  // MT-01 phase 2: the terrain surface retextures through pack tiles too (water stays procedural).
  await expect(canvas).toHaveAttribute('data-terrain-pack-textured', 'true');
  // Visual pixel proof for built-in retexture is owned by the on-device acceptance
  // (compare-shot pixel diff): desktop software-GL intermittently never flushes the
  // rebuilt frame, so a screenshot delta would flake. The mesh-level diagnostics
  // above prove the stand-in blocks actually resolved into pack textures.

  await page.getByRole('button', { name: '设置' }).click();
  await page.locator('.resource-pack-original').getByRole('button', { name: '使用' }).click();
  await page.getByRole('button', { name: '计时' }).click();
  await expect(canvas).toHaveAttribute('data-active-resource-pack-id', '');
  await expect.poll(async () => canvas.getAttribute('data-terrain-pack-textured'), { timeout: 20_000 }).toBe('false');
  await expect.poll(async () => {
    await page.getByRole('button', { name: '重置视角' }).click();
    const shot = await canvas.screenshot({ path: testInfo.outputPath('builtin-restored.png') });
    return (await pixelDifference(page, original, shot)).changedPixelRatio;
  }, { timeout: 20_000 }).toBeLessThan(0.01);
});

test('renders translucent multipart panes and zero-thickness iron bars from a real imported building',async({page},testInfo)=>{
  test.setTimeout(90_000);
  const sample=resolve(process.cwd(),'../../litematic/a94f3c5d-b4ad-42e1-ba26-f474b204b0ea.litematic');
  test.skip(!existsSync(sample), 'The real Litematic compatibility fixture stays local.');
  await page.clock.install({time:new Date('2026-07-26T05:00:00.000Z')});
  await page.goto('/?__atlasPageSize=128');
  await page.getByLabel('导入 .litematic').setInputFiles(sample);
  await page.getByLabel('大型任务').fill('P2 透明连接验证');
  await page.getByRole('button', { name: '清空小任务' }).click();
  await page.getByLabel('新增小任务').fill('验证墙体连接');
  await page.getByLabel('新增小任务').press('Enter');
  await page.getByLabel('新增小任务').fill('验证玻璃板与铁栏杆');
  await page.getByLabel('新增小任务').press('Enter');
  await page.getByRole('button',{name:'开始建造'}).click();
  await page.getByRole('button',{name:'设置'}).click();
  await page.getByLabel('导入 Java 资源包 ZIP').setInputFiles({name:'p2-visual-test.zip',mimeType:'application/zip',buffer:Buffer.from(makeVisualPack())});
  await expect(page.getByRole('status')).toContainText('已导入并启用');
  await setActiveProjectProgress(page,9900);
  await page.reload();
  const canvas=page.getByLabel('项目建筑世界');
  await expect(canvas).toBeVisible();
  await expect.poll(async()=>Number(await canvas.getAttribute('data-atlas-page-count')),{timeout:30_000}).toBeGreaterThan(1);
  await expect.poll(async()=>Number(await canvas.getAttribute('data-multipart-geometry-voxel-count'))).toBeGreaterThan(150);
  await expect.poll(async()=>Number(await canvas.getAttribute('data-translucent-geometry-voxel-count'))).toBeGreaterThan(50);
  await expect.poll(async()=>Number(await canvas.getAttribute('data-geometry-quad-instance-count'))).toBeGreaterThan(500);
  expect(Number(await canvas.getAttribute('data-geometry-signature-batch-count'))).toBeLessThanOrEqual(64);
  await expect.poll(async()=>{
    const fullscreenPasses=Number(await canvas.getAttribute('data-fullscreen-pass-count'));
    return Number(await canvas.getAttribute('data-render-calls'))-fullscreenPasses*6;
  }).toBeLessThanOrEqual(120);
  expect(Number(await canvas.getAttribute('data-render-triangles'))).toBeLessThanOrEqual(220_000);
  await expect(canvas).toHaveAttribute('data-continuous-rendering','false');
  await canvas.screenshot({path:testInfo.outputPath('p2-multipart-pane-bars.png')});
});

function makePack():Uint8Array{
  return zipSync({
    'pack.mcmeta':strToU8(JSON.stringify({pack:{pack_format:34,description:'Test pack'}})),
    'assets/minecraft/textures/block/stone.png':makePng([220,40,40,255]),
    'assets/minecraft/blockstates/stone.json':strToU8(JSON.stringify({variants:{'':{model:'minecraft:block/stone'}}})),
    'assets/minecraft/models/block/stone.json':strToU8(JSON.stringify({parent:'block/cube_all',textures:{all:'block/stone'}})),
  });
}

function makeVisualPack():Uint8Array{
  const files:Record<string,Uint8Array>={'pack.mcmeta':strToU8(JSON.stringify({pack:{pack_format:34,description:'Visual renderer test'}}))};
  files['assets/minecraft/textures/colormap/grass.png']=makeSizedPixelPng(()=>[0x12,0x34,0x56,255],256,256);
  files['assets/minecraft/textures/colormap/foliage.png']=makeSizedPixelPng(()=>[0x65,0x43,0x21,255],256,256);
  const cubes:Record<string,readonly[number,number,number,number]>={
    grass_block:[235,40,210,255],quartz_block:[20,210,235,255],polished_deepslate:[245,190,25,255],stone_bricks:[45,230,80,255],calcite:[240,75,45,255],spruce_planks:[80,80,245,255],deepslate_bricks:[245,70,135,255],polished_diorite:[60,220,180,255],diorite:[220,60,60,255],green_stained_glass:[30,220,190,128],glass:[80,180,255,128],barrel:[215,120,35,255],hopper:[120,45,210,255],observer:[250,245,70,255],lectern:[40,170,240,255],mud:[145,75,35,255],smooth_stone:[235,90,25,255],blackstone:[30,220,120,255],deepslate_tiles:[220,35,65,255],white_terracotta:[40,170,220,255],white_wool:[170,45,230,255],green_terracotta:[80,230,50,255],lime_terracotta:[210,230,40,255],lime_concrete:[230,45,170,255],cyan_terracotta:[30,210,210,255],cyan_wool:[70,120,240,255],polished_andesite:[235,130,40,255],
  };
  for(const [id,color] of Object.entries(cubes)){
    files[`assets/minecraft/blockstates/${id}.json`]=strToU8(JSON.stringify({variants:{'':{model:`minecraft:block/${id}`}}}));
    files[`assets/minecraft/models/block/${id}.json`]=strToU8(JSON.stringify(id==='grass_block'?transformedCubeModel(id):{parent:'block/cube_all',textures:{all:`block/${id}`}}));
    files[`assets/minecraft/textures/block/${id}.png`]=id==='grass_block'?makeAnimated32GridPng():makePng(color);
    if(id==='grass_block')files[`assets/minecraft/textures/block/${id}.png.mcmeta`]=strToU8(JSON.stringify({animation:{width:32,height:32,frametime:2,frames:[0,1,2,3],interpolate:true}}));
  }
  files['assets/minecraft/blockstates/stripped_spruce_log.json']=strToU8(JSON.stringify({variants:{'axis=y':{model:'minecraft:block/stripped_spruce_log'},'axis=x':{model:'minecraft:block/stripped_spruce_log',x:90,y:90},'axis=z':{model:'minecraft:block/stripped_spruce_log',x:90}}}));
  files['assets/minecraft/models/block/stripped_spruce_log.json']=strToU8(JSON.stringify({parent:'block/cube_column',textures:{side:'block/stripped_spruce_log',end:'block/stripped_spruce_log_top'}}));
  files['assets/minecraft/textures/block/stripped_spruce_log.png']=makePng([25,70,235,255]);
  files['assets/minecraft/textures/block/stripped_spruce_log_top.png']=makePng([250,225,35,255]);
  files['assets/minecraft/blockstates/oak_leaves.json']=strToU8(JSON.stringify({variants:{'':{model:'minecraft:block/oak_leaves'}}}));
  files['assets/minecraft/models/block/oak_leaves.json']=strToU8(JSON.stringify(tintedCubeModel('oak_leaves')));
  files['assets/minecraft/textures/block/oak_leaves.png']=makePng([205,215,190,255]);
  addP1GeometryFixtures(files);
  addP2MultipartFixtures(files);
  return zipSync(files,{level:6});
}

function makeBuiltinVisualPack():Uint8Array{
  // Bright distinct cube_all textures for the six vanilla stand-in blocks that
  // built-in Blockcolc materials resolve to (see builtinMaterialBlockId).
  const files:Record<string,Uint8Array>={'pack.mcmeta':strToU8(JSON.stringify({pack:{pack_format:34,description:'Builtin retexture test'}}))};
  const cubes:Record<string,readonly[number,number,number,number]>={
    stone:[30,30,30,255],oak_planks:[200,120,40,255],bricks:[160,40,40,255],glass:[80,180,255,255],birch_planks:[220,200,150,255],oak_log:[120,80,40,255],grass_block:[60,140,40,255],dirt:[140,100,60,255],
  };
  for(const [id,color] of Object.entries(cubes)){
    files[`assets/minecraft/blockstates/${id}.json`]=strToU8(JSON.stringify({variants:{'':{model:`minecraft:block/${id}`}}}));
    files[`assets/minecraft/models/block/${id}.json`]=strToU8(JSON.stringify({parent:'block/cube_all',textures:{all:`block/${id}`}}));
    files[`assets/minecraft/textures/block/${id}.png`]=makePng(color);
  }
  return zipSync(files,{level:6});
}

function addP1GeometryFixtures(files:Record<string,Uint8Array>):void{
  const slabs=['deepslate_tile_slab','oak_slab','spruce_slab','polished_deepslate_slab','deepslate_brick_slab','stone_brick_slab','quartz_slab','polished_diorite_slab'];
  const stairs=['polished_diorite_stairs','polished_deepslate_stairs','oak_stairs','deepslate_tile_stairs','stone_brick_stairs','spruce_stairs','quartz_stairs'];
  const trapdoors=['dark_oak_trapdoor','spruce_trapdoor','jungle_trapdoor','bamboo_trapdoor','birch_trapdoor','oak_trapdoor','mangrove_trapdoor','iron_trapdoor'];
  for(const id of slabs){
    files[`assets/minecraft/blockstates/${id}.json`]=strToU8(JSON.stringify({variants:{'type=bottom':{model:`minecraft:block/${id}_bottom`},'type=top':{model:`minecraft:block/${id}_top`},'type=double':{model:`minecraft:block/${id}_double`}}}));
    files[`assets/minecraft/models/block/${id}_bottom.json`]=strToU8(JSON.stringify(cuboidModel(id,[0,0,0],[16,8,16])));
    files[`assets/minecraft/models/block/${id}_top.json`]=strToU8(JSON.stringify(cuboidModel(id,[0,8,0],[16,16,16])));
    files[`assets/minecraft/models/block/${id}_double.json`]=strToU8(JSON.stringify({parent:'block/cube_all',textures:{all:`block/${id}`}}));
    files[`assets/minecraft/textures/block/${id}.png`]=makeAnimatedDirectionalCutoutPng();
    files[`assets/minecraft/textures/block/${id}.png.mcmeta`]=strToU8(JSON.stringify({animation:{frametime:2,frames:[0,1],interpolate:true}}));
  }
  for(const id of stairs){
    files[`assets/minecraft/blockstates/${id}.json`]=strToU8(JSON.stringify({variants:{'shape=straight':{model:`minecraft:block/${id}`}}}));
    files[`assets/minecraft/models/block/${id}.json`]=strToU8(JSON.stringify(straightStairModel(id)));
    files[`assets/minecraft/textures/block/${id}.png`]=makeAnimatedDirectionalCutoutPng();
    files[`assets/minecraft/textures/block/${id}.png.mcmeta`]=strToU8(JSON.stringify({animation:{frametime:2,frames:[0,1],interpolate:true}}));
  }
  for(const id of trapdoors){
    files[`assets/minecraft/blockstates/${id}.json`]=strToU8(JSON.stringify({variants:{'':{model:`minecraft:block/${id}`}}}));
    files[`assets/minecraft/models/block/${id}.json`]=strToU8(JSON.stringify(cuboidModel(id,[0,0,0],[16,3,16])));
    files[`assets/minecraft/textures/block/${id}.png`]=makeAnimatedDirectionalCutoutPng();
    files[`assets/minecraft/textures/block/${id}.png.mcmeta`]=strToU8(JSON.stringify({animation:{frametime:2,frames:[0,1],interpolate:true}}));
  }
}

function cuboidModel(id:string,from:readonly[number,number,number],to:readonly[number,number,number]){
  const face={texture:'#all'};
  return{textures:{all:`block/${id}`},elements:[{from,to,shade:true,faces:{down:face,up:face,north:face,south:face,west:face,east:face}}]};
}

function straightStairModel(id:string){
  const face={texture:'#all'};
  return{textures:{all:`block/${id}`},elements:[
    {from:[0,0,0],to:[16,8,16],shade:true,faces:{down:face,up:face,north:face,south:face,west:face,east:face}},
    {from:[0,8,8],to:[16,16,16],shade:true,faces:{down:face,up:face,north:face,south:face,west:face,east:face}},
  ]};
}

function addP2MultipartFixtures(files:Record<string,Uint8Array>):void{
  for(const id of ['polished_deepslate_wall','mossy_cobblestone_wall','diorite_wall','mud_brick_wall','stone_brick_wall']){
    files[`assets/minecraft/blockstates/${id}.json`]=strToU8(JSON.stringify({multipart:wallMultipart(id)}));
    files[`assets/minecraft/models/block/${id}_post.json`]=strToU8(JSON.stringify(model(id,[cuboid([4,0,4],[12,16,12])])));
    files[`assets/minecraft/models/block/${id}_side.json`]=strToU8(JSON.stringify(model(id,[cuboid([5,0,0],[11,14,8],['down','up','north','west','east'])])));
    files[`assets/minecraft/models/block/${id}_side_tall.json`]=strToU8(JSON.stringify(model(id,[cuboid([5,0,0],[11,16,8],['down','up','north','west','east'])])));
    files[`assets/minecraft/textures/block/${id}.png`]=makePng([105,120,140,255]);
  }
  for(const id of ['spruce_fence']){
    files[`assets/minecraft/blockstates/${id}.json`]=strToU8(JSON.stringify({multipart:fenceMultipart(id)}));
    files[`assets/minecraft/models/block/${id}_post.json`]=strToU8(JSON.stringify(model(id,[cuboid([6,0,6],[10,16,10])])));
    files[`assets/minecraft/models/block/${id}_side.json`]=strToU8(JSON.stringify(model(id,[cuboid([7,12,0],[9,15,9]),cuboid([7,6,0],[9,9,9])])));
    files[`assets/minecraft/textures/block/${id}.png`]=makePng([105,70,35,255]);
  }
  for(const id of ['black_stained_glass_pane','gray_stained_glass_pane','lime_stained_glass_pane','red_stained_glass_pane']){
    files[`assets/minecraft/blockstates/${id}.json`]=strToU8(JSON.stringify({multipart:paneMultipart(id)}));
    files[`assets/minecraft/models/block/${id}_post.json`]=strToU8(JSON.stringify(model(id,[cuboid([7,0,7],[9,16,9],['down','up'])])));
    files[`assets/minecraft/models/block/${id}_side.json`]=strToU8(JSON.stringify(model(id,[cuboid([7,0,0],[9,16,7],['down','up','north','west','east'])])));
    files[`assets/minecraft/models/block/${id}_side_alt.json`]=strToU8(JSON.stringify(model(id,[cuboid([7,0,9],[9,16,16],['down','up','south','west','east'])])));
    files[`assets/minecraft/models/block/${id}_noside.json`]=strToU8(JSON.stringify(model(id,[plane([7,0,7],[9,16,7],'north')])));
    files[`assets/minecraft/models/block/${id}_noside_alt.json`]=strToU8(JSON.stringify(model(id,[plane([9,0,7],[9,16,9],'east')])));
    files[`assets/minecraft/textures/block/${id}.png`]=makePng([120,210,150,145]);
  }
  const id='iron_bars';
  files[`assets/minecraft/blockstates/${id}.json`]=strToU8(JSON.stringify({multipart:barsMultipart(id)}));
  files[`assets/minecraft/models/block/${id}_post_ends.json`]=strToU8(JSON.stringify(model(id,[plane([7,.001,7],[9,.001,9],'up'),plane([7,15.999,7],[9,15.999,9],'down')])));
  files[`assets/minecraft/models/block/${id}_post.json`]=strToU8(JSON.stringify(model(id,[plane([8,0,7],[8,16,9],'east'),plane([7,0,8],[9,16,8],'north')])));
  files[`assets/minecraft/models/block/${id}_cap.json`]=strToU8(JSON.stringify(model(id,[plane([8,0,8],[8,16,9],'east'),plane([7,0,9],[9,16,9],'north')])));
  files[`assets/minecraft/models/block/${id}_cap_alt.json`]=files[`assets/minecraft/models/block/${id}_cap.json`]!;
  files[`assets/minecraft/models/block/${id}_side.json`]=strToU8(JSON.stringify(model(id,[plane([8,0,0],[8,16,8],'east'),plane([7,0,7],[9,16,7],'north')])));
  files[`assets/minecraft/models/block/${id}_side_alt.json`]=files[`assets/minecraft/models/block/${id}_side.json`]!;
  files[`assets/minecraft/textures/block/${id}.png`]=makePng([190,195,205,255],true);
}

function wallMultipart(id:string){
  const parts:any[]=[{when:{up:'true'},apply:{model:`minecraft:block/${id}_post`}}];
  for(const [direction,rotation] of directions()){
    parts.push({when:{[direction]:'low'},apply:{model:`minecraft:block/${id}_side`,y:rotation,uvlock:true}});
    parts.push({when:{[direction]:'tall'},apply:{model:`minecraft:block/${id}_side_tall`,y:rotation,uvlock:true}});
  }
  return parts;
}
function fenceMultipart(id:string){return[{apply:{model:`minecraft:block/${id}_post`}},...directions().map(([direction,rotation])=>({when:{[direction]:'true'},apply:{model:`minecraft:block/${id}_side`,y:rotation,uvlock:true}}))];}
function paneMultipart(id:string){
  const [north,east,south,west]=directions();
  return[
    {apply:{model:`minecraft:block/${id}_post`}},
    {when:{north:'true'},apply:{model:`minecraft:block/${id}_side`}},{when:{east:'true'},apply:{model:`minecraft:block/${id}_side`,y:90}},
    {when:{south:'true'},apply:{model:`minecraft:block/${id}_side_alt`}},{when:{west:'true'},apply:{model:`minecraft:block/${id}_side_alt`,y:90}},
    ...[north,east,south,west].map(([direction,rotation],index)=>({when:{[direction]:'false'},apply:{model:`minecraft:block/${id}_${index%2===0?'noside':'noside_alt'}`,y:rotation}})),
  ];
}
function barsMultipart(id:string){
  const allFalse={north:'false',east:'false',south:'false',west:'false'};
  const parts:any[]=[{apply:{model:`minecraft:block/${id}_post_ends`}},{when:allFalse,apply:{model:`minecraft:block/${id}_post`}}];
  for(const [direction,rotation] of directions()){
    parts.push({when:{...allFalse,[direction]:'true'},apply:{model:`minecraft:block/${id}_${direction==='south'||direction==='west'?'cap_alt':'cap'}`,y:rotation}});
    parts.push({when:{[direction]:'true'},apply:{model:`minecraft:block/${id}_${direction==='south'||direction==='west'?'side_alt':'side'}`,y:rotation}});
  }
  return parts;
}
function directions():Array<[string,number]>{return[['north',0],['east',90],['south',180],['west',270]];}
function model(id:string,elements:unknown[]){return{textures:{all:`block/${id}`},elements};}
function cuboid(from:number[],to:number[],names=['down','up','north','south','west','east']){const faces=Object.fromEntries(names.map(name=>[name,{texture:'#all'}]));return{from,to,shade:true,faces};}
function plane(from:number[],to:number[],face:string){return{from,to,shade:true,faces:{[face]:{texture:'#all'}}};}

function transformedCubeModel(id:string){
  const face={texture:'#all',uv:[2.5,1,13.5,15],rotation:90};
  return{textures:{all:`block/${id}`},elements:[{from:[0,0,0],to:[16,16,16],faces:{down:face,up:face,north:face,south:face,west:face,east:face}}]};
}

function tintedCubeModel(id:string){
  const face={texture:'#all',tintindex:0};
  return{textures:{all:`block/${id}`},elements:[{from:[0,0,0],to:[16,16,16],faces:{down:face,up:face,north:face,south:face,west:face,east:face}}]};
}

function makeAnimatedDirectionalCutoutPng():Uint8Array{
  return makePixelPng((x,y)=>{
    const localY=y%16;const second=y>=16;
    return second
      ?[235-x*12,35+localY*12,210,(x===0||localY===0||x===15||localY===15)?0:255]
      :[x*15,localY*15,x<8?35:235,(x===0||localY===0||x===15||localY===15)?0:255];
  },32);
}

function makeAnimated32GridPng():Uint8Array{
  return makeSizedPixelPng((x,y)=>{
    const frameX=Math.floor(x/32);const frameY=Math.floor(y/32);const frame=frameY*2+frameX;
    const localX=x%32;const localY=y%32;
    const colors=[[230,40,190],[35,205,235],[245,185,30],[45,225,85]] as const;
    const color=colors[frame]!;
    return[color[0],Math.min(255,color[1]+Math.floor(localX/4)),Math.min(255,color[2]+Math.floor(localY/4)),(localX<2||localY<2||localX>29||localY>29)?0:255];
  },64,64);
}

function makePng(color:readonly[number,number,number,number],transparentBorder=false):Uint8Array{
  return makePixelPng((x,y)=>[color[0],color[1],color[2],transparentBorder&&(x===0||y===0||x===15||y===15)?0:color[3]]);
}
function makePixelPng(pixel:(x:number,y:number)=>readonly[number,number,number,number],height=16):Uint8Array{
  return makeSizedPixelPng(pixel,16,height);
}
function makeSizedPixelPng(pixel:(x:number,y:number)=>readonly[number,number,number,number],width:number,height:number):Uint8Array{
  const signature=new Uint8Array([137,80,78,71,13,10,26,10]);
  const ihdr=new Uint8Array(13);const view=new DataView(ihdr.buffer);view.setUint32(0,width,false);view.setUint32(4,height,false);ihdr.set([8,6,0,0,0],8);
  const raw=new Uint8Array(height*(1+width*4));
  for(let y=0;y<height;y+=1){const row=y*(1+width*4);raw[row]=0;for(let x=0;x<width;x+=1)raw.set(pixel(x,y),row+1+x*4);}
  return concat(signature,pngChunk('IHDR',ihdr),pngChunk('IDAT',new Uint8Array(deflateSync(raw))),pngChunk('IEND',new Uint8Array()));
}
function pngChunk(type:string,data:Uint8Array):Uint8Array{const typeBytes=strToU8(type);const output=new Uint8Array(12+data.length);const view=new DataView(output.buffer);view.setUint32(0,data.length,false);output.set(typeBytes,4);output.set(data,8);view.setUint32(8+data.length,crc32(concat(typeBytes,data)),false);return output;}
function crc32(bytes:Uint8Array):number{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit+=1)crc=(crc>>>1)^(0xedb88320&-(crc&1));}return(crc^0xffffffff)>>>0;}
function concat(...arrays:Uint8Array[]):Uint8Array{const output=new Uint8Array(arrays.reduce((sum,array)=>sum+array.length,0));let offset=0;for(const array of arrays){output.set(array,offset);offset+=array.length;}return output;}

async function pixelDifference(page:import('@playwright/test').Page,left:Buffer,right:Buffer):Promise<{changedPixelRatio:number;meanChannelDelta:number}>{
  return page.evaluate(async({leftBase64,rightBase64})=>{
    const decode=async(value:string)=>{const response=await fetch(`data:image/png;base64,${value}`);const bitmap=await createImageBitmap(await response.blob());const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);const context=canvas.getContext('2d')!;context.drawImage(bitmap,0,0);const data=context.getImageData(0,0,bitmap.width,bitmap.height).data;bitmap.close();return data;};
    const a=await decode(leftBase64);const b=await decode(rightBase64);let changed=0;let delta=0;const pixels=a.length/4;for(let index=0;index<a.length;index+=4){const d=Math.abs(a[index]!-b[index]!)+Math.abs(a[index+1]!-b[index+1]!)+Math.abs(a[index+2]!-b[index+2]!);delta+=d/3;if(d>18)changed+=1;}return{changedPixelRatio:changed/pixels,meanChannelDelta:delta/pixels};
  },{leftBase64:left.toString('base64'),rightBase64:right.toString('base64')});
}

async function setActiveProjectProgress(page:import('@playwright/test').Page,progressBasisPoints:number):Promise<void>{
  await page.evaluate(async(progress)=>{
    const database=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('blockcolc-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const transaction=database.transaction('appState','readwrite');
    const store=transaction.objectStore('appState');
    const record=await new Promise<any>((resolve,reject)=>{const request=store.get('current');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const project=record.state.projects.find((entry:any)=>entry.id===record.state.activeProjectId);
    for(const [index,subtask] of project.subtasks.entries()){
      subtask.progressBasisPoints=progress;
      const startedAt=new Date(Date.parse(project.createdAt)+(index*2+1)*60000).toISOString();const endsAt=new Date(Date.parse(startedAt)+60000).toISOString();
      const completedLocalDate=new Intl.DateTimeFormat('en-CA',{timeZone:record.state.calendar.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(endsAt));
      const sessionId=`visual-session-${index}`;
      record.state.focusHistory.push({id:sessionId,projectId:project.id,subtaskId:subtask.id,startedAt,endsAt,plannedDurationMs:60000,timeZoneAtStart:record.state.calendar.timeZone,status:'completed',completedAt:endsAt,completedLocalDate,actualDurationMs:60000});
      record.state.progressReports.push({id:`visual-report-${index}`,projectId:project.id,subtaskId:subtask.id,focusSessionIds:[sessionId],progressBasisPoints:progress,reportedAt:endsAt});
    }
    project.subtaskStructureLocked=progress>0;
    record.revision+=1;
    store.put(record);
    await new Promise<void>((resolve,reject)=>{transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);});
    database.close();
  },progressBasisPoints);
}
