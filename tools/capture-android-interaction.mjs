import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';

const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
const serial = option('--serial'), apk = option('--apk'), output = path.resolve(option('--output'));
const steady = args.includes('--steady');
const noProfile = args.includes('--no-profile');
if (!/^[\w-]+$/.test(serial ?? '') || !apk) throw new Error('Explicit authorized serial, APK and output required.');
const adb = path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe');
const pkg = 'com.blockcolc.app', activity = `${pkg}/.MainActivity`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { status: 'running', apkSha256: createHash('sha256').update(await readFile(apk)).digest('hex'),
  method: 'OnePlus: cold first orbit, held-quality control, shade return; physical ADB touch; V8 stacks + numeric frame trace',
  limitations: ['V8 profiler changes timings; unprofiled measurements remain the performance comparison.',
    'No GPU timer or native/OS stacks; GL calls may include driver waits.', 'No task text, location, heap, storage or console payloads captured.'], samples: [] };
if (steady) {
  report.method = 'Settled coast; repeated physical ADB orbits; no V8 profiler; bounded Android scheduling/graphics trace';
  report.limitations = ['Android tracing and ADB input can affect timings; no GPU counters or native call stacks.',
    'System trace contains scheduling/graphics metadata only; no logcat, heap, network, location or task payloads.'];
}
else if(noProfile){
  report.method='OnePlus cold first/repeated orbit and shade return; physical ADB touch; numeric frame trace without V8 profiler';
  report.limitations=['ADB/probe callbacks can affect timings; no GPU counters, V8 or native call stacks.',
    'Notification-shade hidden intervals are not application rendering time.'];
}
let cdp, forward, profiling = false;
async function adbCall(...argv) {
  return new Promise((resolve, reject) => {
    const child = spawn(adb, ['-s', serial, ...argv], { windowsHide: true });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill(), 30_000);
    child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(new Error(`ADB ${argv[0]} (${code}): ${stderr.slice(0, 120)}`)); });
  });
}
async function ready() {
  const policy = await adbCall('shell', 'dumpsys', 'window', 'policy');
  const activityState = await adbCall('shell', 'dumpsys', 'activity', 'activities');
  if (!/interactiveState=INTERACTIVE_STATE_AWAKE/.test(policy) || !/mIsShowing=false/.test(policy)
    || !new RegExp(`topResumedActivity=.*${pkg.replaceAll('.', '\\.')}/`).test(activityState)) throw new Error('Phone must be unlocked and Blockcolc foreground.');
  const battery = await adbCall('shell', 'dumpsys', 'battery');
  const temperature = Number(/temperature:\s*(\d+)/.exec(battery)?.[1]);
  if (!Number.isFinite(temperature) || temperature >= 440) throw new Error('Unknown/hot phone.');
  return temperature / 10;
}
async function port() {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const result = server.address().port; await new Promise(resolve => server.close(resolve)); return result;
}
async function connect(url) {
  const socket = new WebSocket(url), pending = new Map(); let sequence = 0;
  socket.addEventListener('message', event => {
    const value = JSON.parse(String(event.data)), entry = pending.get(value.id);
    if (!entry) return; pending.delete(value.id); clearTimeout(entry.timer);
    value.error ? entry.reject(new Error(`CDP ${entry.method} failed`)) : entry.resolve(value.result);
  });
  socket.addEventListener('close', () => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('CDP closed')); } pending.clear(); });
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  return { close: () => socket.close(), send(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }, 60_000);
      pending.set(id, { resolve, reject, timer, method }); socket.send(JSON.stringify({ id, method, params }));
    });
  } };
}
async function attach() {
  const pid = (await adbCall('shell', 'pidof', pkg)).trim();
  if (!/^\d+$/.test(pid)) throw new Error('No unique app process');
  forward = `tcp:${await port()}`;
  await adbCall('forward', '--no-rebind', forward, `localabstract:webview_devtools_remote_${pid}`);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const targets = (await fetch(`http://127.0.0.1:${forward.slice(4)}/json/list`, { signal: AbortSignal.timeout(1000) }).then(r => r.json()))
        .filter(t => t.type === 'page' && /^https?:\/\/localhost(?:[:/]|$)/.test(t.url));
      if (targets.length === 1) {
        const ws = new URL(targets[0].webSocketDebuggerUrl); ws.hostname = '127.0.0.1'; ws.port = forward.slice(4);
        cdp = await connect(ws.href); return;
      }
    } catch { /* Wait for this app's sole WebView, never attach to another app. */ }
    await pause(250);
  }
  throw new Error('No unique app-owned WebView');
}
async function evaluate(expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error('Diagnostic expression failed');
  return result.result.value;
}
async function snapshot() { return evaluate('window.__blockcolcPerformanceProbe?.snapshot()'); }
const idle = sample => { if (!sample?.safety?.known || !sample.safety.idle) throw new Error('Active/unknown plan: refuse restart'); };
async function cleanup() {
  if (profiling && cdp) { try { await cdp.send('Profiler.stop'); } catch {} profiling = false; }
  if (cdp) { try { await evaluate('window.__blockcolcPerformanceProbe?.stop()'); } catch {} cdp.close(); cdp = undefined; }
  if (forward) { await adbCall('forward', '--remove', forward); forward = undefined; }
}
async function save() { await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2)); }
try {
  if ((await adbCall('shell', 'getprop', 'ro.product.manufacturer')).trim().toLowerCase() !== 'oneplus') throw new Error('OnePlus-only experiment');
  const installed = (await adbCall('shell', 'pm', 'path', pkg)).split(/\r?\n/).find(v => v.endsWith('base.apk'))?.replace(/^package:/, '').trim();
  if (!installed || !(await adbCall('shell', 'sha256sum', installed)).startsWith(report.apkSha256)) throw new Error('Installed APK digest mismatch');
  await ready();
  for (const mode of (steady ? ['adaptive'] : ['adaptive', 'held'])) {
    // Inspect the currently installed state before the first restart too.
    const run = `orbit-${Date.now()}-${mode}`;
    await adbCall('shell', 'am', 'start', '-n', activity, '-a', `${pkg}.action.PERFORMANCE`, '--es', 'probeOperation', 'arm', '--es', 'probeRunId', run, '--es', 'probeRequestId', 'arm');
    await attach(); await pause(500); idle(await snapshot()); await ready();
    if (!steady) {
      await cleanup();
      await adbCall('shell', 'am', 'force-stop', pkg);
      await adbCall('shell', 'am', 'start', '-n', activity, '-a', `${pkg}.action.PERFORMANCE`, '--es', 'probeOperation', 'arm', '--es', 'probeRunId', run, '--es', 'probeRequestId', 'boot');
      await pause(500); await attach();
    }
    const deadline = Date.now() + 90_000; let initial;
    while (Date.now() < deadline) {
      const sample = await snapshot();
      if (sample?.worldReady && (steady || Number.isFinite(sample.phases?.['opening-complete']))) { idle(sample); initial = sample; break; }
      await pause(500);
    }
    if (!initial) throw new Error('Opening incomplete');
    if (mode === 'held') await evaluate('window.__blockcolcPerformanceProbe.holdQuality(true)');
    await pause(2500);
    const rect = await evaluate(`(()=>{const r=document.querySelector('canvas[data-world-canvas]').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:devicePixelRatio}})()`);
    const from = [rect.x + rect.width * .3, rect.y + rect.height * .42].map(v => String(Math.round(v * rect.scale)));
    const to = [rect.x + rect.width * .7, rect.y + rect.height * .42].map(v => String(Math.round(v * rect.scale)));
    if (steady) {
      const deviceTrace = '/data/misc/perfetto-traces/blockcolc-steady-orbit.perfetto-trace';
      const traceOutput = output.replace(/\.json$/, '.perfetto-trace');
      const capture = adbCall('shell', 'perfetto', '-t', '25s', '-b', '16mb', '-a', pkg,
        'gfx', 'view', 'webview', 'sched', 'freq', 'idle', '-o', deviceTrace)
        .then(()=>null, error=>error);
      await pause(1000);
      for (const reverse of [false, true]) {
        idle(await snapshot()); await ready();
        await evaluate('window.__blockcolcPerformanceProbe.beginWindow("rotation-repeat")');
        const beforeMs = await evaluate('performance.now()');
        for (let i=0;i<4;i++) {
          await adbCall('shell', 'input', 'touchscreen', 'swipe', ...(reverse?to:from), ...(reverse?from:to), '1600');
          await pause(200);
        }
        const afterMs = await evaluate('performance.now()');
        report.samples.push({mode,label:reverse?'steady-reverse':'steady-forward',beforeMs,afterMs,
          temperatureC:await ready(),probe:await snapshot(),frames:await evaluate('window.__blockcolcPerformanceProbe.frameTrace()')});
      }
      const error = await capture;
      if (error) throw error;
      await mkdir(path.dirname(traceOutput), {recursive:true});
      await adbCall('pull', deviceTrace, traceOutput);
      report.nativeTrace = traceOutput;
      await cleanup();continue;
    }
    if(!noProfile){await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });}
    for (const label of ['rotation-first', 'rotation-repeat', 'return']) {
      await ready(); idle(await snapshot());
      if(!noProfile){await cdp.send('Profiler.start'); profiling = true;}
      await evaluate(`window.__blockcolcPerformanceProbe.beginWindow('${label}')`);
      const beforeMs = await evaluate('performance.now()');
      if (label === 'return') {
        await adbCall('shell', 'cmd', 'statusbar', 'expand-notifications'); await pause(1000);
        await adbCall('shell', 'cmd', 'statusbar', 'collapse'); await pause(150);
      }
      await adbCall('shell', 'input', 'touchscreen', 'swipe', ...from, ...to, '1600');
      await pause(500);
      const afterMs = await evaluate('performance.now()');
      const probe=await snapshot(),frames=await evaluate('window.__blockcolcPerformanceProbe.frameTrace()');
      let filename=null;
      if(!noProfile){
        const { profile } = await cdp.send('Profiler.stop'); profiling = false;
        for (const node of profile.nodes) {
          if (node.callFrame.url) { try { const url = new URL(node.callFrame.url); url.search = ''; url.hash = ''; node.callFrame.url = url.href; } catch { node.callFrame.url = ''; } }
        }
        filename = output.replace(/\.json$/, `-${mode}-${label}.cpuprofile`);
        await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, JSON.stringify(profile));
      }
      report.samples.push({ mode, label, beforeMs, afterMs, profile: filename, temperatureC: await ready(), probe, frames });
      await save();
    }
    await cleanup();
  }
  report.status = 'completed';
} catch (error) { report.status = 'failed'; report.failure = error.message; process.exitCode = 1; }
finally { try { await cleanup(); } catch { report.limitations.push('Probe expires; forwarding cleanup failed'); } report.finishedAt = new Date().toISOString(); await save(); console.log(`Interaction capture ${report.status}: ${output}`); }
