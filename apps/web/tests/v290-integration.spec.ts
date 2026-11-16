import {test,expect,type Page} from '@playwright/test';
import {waitForPreparedWorld} from './world-ready';
import {readPersistedDomainState,executeAndReloadPersistedCommand} from './persisted-domain-state';
import {NIGHT_SKY_GLSL} from '../../../packages/voxel/src/sky-spectacle';

const BASE=new Date('2026-10-18T04:00:00Z');
test('the floating-island galaxy actually draws below the horizon; physical sky and reflections do not',async({page},info)=>{
  await page.goto('/');
  const measured=await page.evaluate(source=>{
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const gl=canvas.getContext('webgl2',{preserveDrawingBuffer:true})!;if(!gl)throw Error('WebGL2 required');
    const compile=(kind:number,code:string)=>{const shader=gl.createShader(kind)!;gl.shaderSource(shader,code);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader)!);return shader;};
    const vertex=compile(gl.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0,1);}');
    const fragment=compile(gl.FRAGMENT_SHADER,`#version 300 es\nprecision highp float;\n${source}\nuniform bool floating;out vec4 color;void main(){vec2 p=gl_FragCoord.xy/64.-1.;vec3 d=normalize(vec3(p.x,-.7,p.y));color=vec4(floating?bcFloatingNightSky(d):bcNightSky(d),1);}`);
    const program=gl.createProgram()!;gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program)!);gl.useProgram(program);
    gl.uniform1f(gl.getUniformLocation(program,'bcSkyGalaxy'),1);gl.uniform1f(gl.getUniformLocation(program,'bcSkyMeteor'),-1);gl.viewport(0,0,128,128);
    gl.uniform3f(gl.getUniformLocation(program,'bcSkyGalaxyNormal'),.82,.22,-.52);
    const sample=(floating:boolean)=>{gl.uniform1i(gl.getUniformLocation(program,'floating'),floating?1:0);gl.drawArrays(gl.TRIANGLES,0,3);const bytes=new Uint8Array(128*128*4);gl.readPixels(0,0,128,128,gl.RGBA,gl.UNSIGNED_BYTE,bytes);let max=0,lit=0;for(let i=0;i<bytes.length;i+=4){const peak=Math.max(bytes[i]!,bytes[i+1]!,bytes[i+2]!);max=Math.max(max,peak);if(peak>4)lit++;}return{max,lit};};
    const floating=sample(true),image=canvas.toDataURL(),ordinary=sample(false);gl.deleteProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);return{floating,ordinary,image};
  },NIGHT_SKY_GLSL);
  expect(measured.floating.max).toBeGreaterThan(12);expect(measured.floating.lit).toBeGreaterThan(1000);expect(measured.ordinary).toEqual({max:0,lit:0});
  await info.attach('floating-galaxy-lower-dome',{body:Buffer.from(measured.image.split(',')[1]!,'base64'),contentType:'image/png'});
});
async function start(page:Page,extra:Record<string,unknown>={}){
  await page.clock.setFixedTime(BASE);await page.emulateMedia({reducedMotion:'reduce'});
  await page.addInitScript(extra=>{
    localStorage.setItem('blockcolc-tutorial-v1','1');
    localStorage.setItem('blockcolc-focus-preferences-v1',JSON.stringify({focusMinutes:1,breakMinutes:0,lightingQuality:'performance',environmentStyle:'classic-island',...extra}));
    const OriginalAudio=Audio;const captures:HTMLAudioElement[]=[];Object.assign(window,{ambientTestPlayers:captures});
    window.Audio=new Proxy(OriginalAudio,{construct(target,args){const audio=Reflect.construct(target,args) as HTMLAudioElement;captures.push(audio);return audio;}});
  },extra);
  await page.goto('/');await page.getByRole('button',{name:'开始建造',exact:true}).click();await waitForPreparedWorld(page);
}

test('full stereo recordings play exclusively, retain their duration, and respect random silent gaps',async({page},info)=>{
  test.setTimeout(150000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await start(page);await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'白噪音',exact:true}).click();await page.getByRole('checkbox',{name:'自然白噪音',exact:true}).check();
  for(const [label,file,seconds] of [['贴岸小浪','shore-waves',164.628],['清晨林中鸟鸣','forest-birds',132.481]] as const){
    await page.getByRole('radio',{name:label,exact:true}).check();
    await expect.poll(()=>page.evaluate(file=>{
      const players=(window as unknown as {ambientTestPlayers:HTMLAudioElement[]}).ambientTestPlayers;
      const active=players.filter(p=>p.getAttribute('src'));const p=active[0];return {count:active.length,ready:!!p&&p.readyState>=2&&!p.paused,file:p?.getAttribute('src')?.includes(file),duration:p?.duration};
    },file)).toMatchObject({count:1,ready:true,file:true});
    const response=await page.request.get(`/audio/${file}.ogg`),bytes=await response.body(),header=bytes.indexOf(Buffer.from('OpusHead'));expect(response.ok()).toBe(true);expect(header).toBeGreaterThanOrEqual(0);expect(bytes[header+9]).toBe(2);
    // Opus stores a decoder pre-skip. Chromium's media metadata duration includes
    // it; compare decoded content separately instead of dropping/adding samples.
    const granule=Number(bytes.readBigUInt64LE(bytes.lastIndexOf(Buffer.from('OggS'))+6)),preSkip=bytes.readUInt16LE(header+10);
    expect((granule-preSkip)/48000).toBeCloseTo(seconds,3);
    const duration=await page.evaluate(()=>(window as unknown as {ambientTestPlayers:HTMLAudioElement[]}).ambientTestPlayers.at(-1)!.duration);expect(duration).toBeCloseTo(granule/48000,5);
  }
  await page.evaluate(()=>{
    const original=setTimeout;Object.assign(window,{ambientGapDelay:0,ambientGapStarted:0,ambientGapElapsed:0});
    window.setTimeout=((callback:TimerHandler,delay?:number,...args:unknown[])=>{if(delay!==undefined&&delay>=12000&&delay<=30000&&new Error().stack?.includes('ambient-recording-loop'))Object.assign(window,{ambientGapDelay:delay,ambientGapStarted:performance.now()});return original(callback,delay,...args);}) as typeof setTimeout;
    const p=(window as unknown as {ambientTestPlayers:HTMLAudioElement[]}).ambientTestPlayers.at(-1)!;
    p.addEventListener('playing',()=>{const state=window as unknown as {ambientGapStarted:number};if(state.ambientGapStarted&&p.currentTime<2)Object.assign(window,{ambientGapElapsed:performance.now()-state.ambientGapStarted});});
    p.currentTime=p.duration-.1;
  });
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {ambientTestPlayers:HTMLAudioElement[]}).ambientTestPlayers.at(-1)!.ended)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {ambientGapDelay:number}).ambientGapDelay)).toBeGreaterThanOrEqual(12000);
  const gap=await page.evaluate(()=>(window as unknown as {ambientGapDelay:number}).ambientGapDelay);expect(gap).toBeLessThanOrEqual(30000);
  expect(await page.evaluate(()=>(window as unknown as {ambientTestPlayers:HTMLAudioElement[]}).ambientTestPlayers.at(-1)!.paused)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {ambientGapElapsed:number}).ambientGapElapsed),{timeout:35000}).toBeGreaterThan(0);
  expect(await page.evaluate(()=>(window as unknown as {ambientGapElapsed:number}).ambientGapElapsed)).toBeGreaterThanOrEqual(gap-1);
  expect(await page.evaluate(()=>(window as unknown as {ambientTestPlayers:HTMLAudioElement[]}).ambientTestPlayers.at(-1)!.paused)).toBe(false);
  await page.getByRole('checkbox',{name:'自然白噪音',exact:true}).uncheck();expect(await page.evaluate(()=>(window as unknown as {ambientTestPlayers:HTMLAudioElement[]}).ambientTestPlayers.every(p=>p.paused&&!p.getAttribute('src')))).toBe(true);
  expect(errors).toEqual([]);await page.screenshot({path:info.outputPath('ambient-settings.png')});
});

for(const restMinutes of [0,1])test(`end-time plan finishes exactly, with ${restMinutes?'terminal rest':'a short final focus'} and no invented rounds`,async({page},info)=>{
  test.setTimeout(150000);await start(page,{autoContinueFocus:true,breakMinutes:restMinutes});
  const snapshot=(await readPersistedDomainState(page)).state,project=snapshot.projects.find(p=>p.id===snapshot.activeProjectId)!;
  const end=BASE.getTime()+(restMinutes?90:75)*1000,rounds=restMinutes?1:2;
  await page.evaluate(({project,end,rounds})=>localStorage.setItem('blockcolc-round-plan-v1',JSON.stringify({projectId:project.id,subtaskId:project.subtasks[0]!.id,mode:'marathon',deadlinePolicy:'exact',endAt:new Date(end).toISOString(),status:'ready',totalRounds:rounds,completedRounds:0,reportedSessionIds:[]})),{project,end,rounds});
  await page.reload();await waitForPreparedWorld(page);await page.getByRole('button',{name:/^开始到/}).click();
  await expect.poll(async()=>(await readPersistedDomainState(page)).state.activeFocusSession?.plannedDurationMs).toBe(60000);
  await page.clock.setFixedTime(new Date(BASE.getTime()+61000));
  if(restMinutes){
    await expect.poll(async()=>JSON.parse(await page.evaluate(()=>localStorage.getItem('blockcolc-round-plan-v1'))??'null')?.status).toBe('break');
    await expect(page.locator('.timer-label')).toContainText('休息中');
    expect((await readPersistedDomainState(page)).state.activeFocusSession).toBeNull();
  }else{
    await expect.poll(async()=>(await readPersistedDomainState(page)).state.activeFocusSession?.plannedDurationMs).toBe(15000);
    expect((await readPersistedDomainState(page)).state.activeFocusSession?.endsAt).toBe(new Date(end).toISOString());
    await page.reload();await waitForPreparedWorld(page);
  }
  await page.clock.setFixedTime(new Date(end));
  await expect(page.locator('.marathon-progress-report')).toBeVisible();
  const history=(await readPersistedDomainState(page)).state.focusHistory;expect(history).toHaveLength(rounds);expect(history.every(s=>s.status==='completed')).toBe(true);
  expect(history.reduce((sum,s)=>sum+s.actualDurationMs,0)).toBe(restMinutes?60000:75000);expect(history.at(-1)!.endsAt).toBe(new Date(restMinutes?BASE.getTime()+60000:end).toISOString());
  await page.screenshot({path:info.outputPath('exact-time-report.png')});
});

test('a saved daily-goal achievement triggers its own celebration once, not on reload or preview',async({page},info)=>{
  test.setTimeout(150000);await start(page);await executeAndReloadPersistedCommand(page,(await readPersistedDomainState(page)).state,{type:'SetDailyGoal',date:'2026-10-18',targetPomodoros:1},BASE.getTime());await waitForPreparedWorld(page);
  await page.getByRole('button',{name:'开始 1 轮',exact:true}).click();await page.clock.setFixedTime(new Date(BASE.getTime()+61000));
  await expect(page.locator('[data-celebration="goal"]')).toBeVisible();
  expect((await readPersistedDomainState(page)).state.dailyGoals.find(g=>g.date==='2026-10-18')?.reachedAt).toBeTruthy();
  await page.reload();await waitForPreparedWorld(page);await expect(page.locator('[data-celebration="goal"]')).toHaveCount(0);
  // A completed ordinary round intentionally keeps the immersive report as the
  // only next step; finish it before trying to use the normal navigation.
  await page.getByRole('button',{name:'保持 0%',exact:true}).click();
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('checkbox',{name:'临时调试世界',exact:true}).check();
  await page.emulateMedia({reducedMotion:'no-preference'});
  const before=await readPersistedDomainState(page);await page.getByRole('button',{name:'播放目标彩纸',exact:true}).click();const preview=page.locator('[data-celebration="goal-preview"]');await expect(preview).toBeVisible();
  await expect.poll(()=>preview.locator('canvas').evaluate(c=>{const data=(c as HTMLCanvasElement).getContext('2d')!.getImageData(0,0,(c as HTMLCanvasElement).width,(c as HTMLCanvasElement).height).data;let visible=0;for(let i=3;i<data.length;i+=4)if(data[i])visible++;return visible;})).toBeGreaterThan(100);
  await page.screenshot({path:info.outputPath('goal-confetti-preview.png')});expect(await readPersistedDomainState(page)).toEqual(before);await expect(preview).toHaveCount(0);
});
