import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { decodeProbeSamples, screenPoint } from './android-performance-protocol.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const serial = option('--serial', ''), apk = option('--apk', ''), output = option('--output', '');
const iterations = Number(option('--iterations', '3'));
const captureZoom = args.includes('--zoom');
if (!/^[\w-]+$/.test(serial) || !apk || !output || !Number.isInteger(iterations) || iterations < 1 || iterations > 5) throw new Error('Required: --serial, --apk, --output; iterations 1–5.');
const adb = path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe');
const pkg = 'com.blockcolc.app', activity = `${pkg}/.MainActivity`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const started = Date.now(), absoluteOutput = path.resolve(output);
let run = '', requestIndex = 0;
const evidence = { schemaVersion: 1, status: 'running', measuredAt: new Date().toISOString(), apkSha256: createHash('sha256').update(await readFile(apk)).digest('hex'),
  scope: 'OnePlus current real world; no task writes, no settings/pack changes; physical ADB swipes and navigation taps', samples: [], limitations: ['Web rAF is presentation opportunity, not GPU-completed FPS.', 'Renderer CPU includes submission and driver waits; GPU times only when disjoint timer is available.', 'No synthetic task submission or native pinch on real user data.'], device: {} };

async function adbCall(...argv) {
  if (Date.now() - started > 12 * 60_000 && argv.includes('force-stop')) throw new Error('Measurement wall-clock budget exceeded.');
  return new Promise((resolve, reject) => {
    const child = spawn(adb, ['-s', serial, ...argv], { windowsHide: true });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill(), 30_000);
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(new Error(`ADB ${argv[0]} failed (${code}): ${stderr.slice(0, 150)}`)); });
  });
}
async function assertReady() {
  const policy = await adbCall('shell', 'dumpsys', 'window', 'policy');
  if (!/interactiveState=INTERACTIVE_STATE_AWAKE/.test(policy) || !/mIsShowing=false/.test(policy)) throw new Error('Unlock and wake the authorized phone.');
  const activities = await adbCall('shell', 'dumpsys', 'activity', 'activities');
  if (!new RegExp(`topResumedActivity=.*${pkg.replaceAll('.', '\\.')}/`).test(activities)) throw new Error('Application no longer foreground; refuse to interrupt another app.');
  const battery = await adbCall('shell', 'dumpsys', 'battery');
  const temperature = Number(/temperature:\s*(\d+)/.exec(battery)?.[1]);
  if (!Number.isFinite(temperature) || temperature >= 440) throw new Error('Unknown/hot battery: defer measurement.');
  return temperature / 10;
}
async function operation(operation, extras = [], waitAck = false) {
  const request = `q${++requestIndex}`;
  await adbCall('shell', 'am', 'start', '-n', activity, '-a', `${pkg}.action.PERFORMANCE`, '--es', 'probeOperation', operation,
    '--es', 'probeRequestId', request, ...extras);
  if (waitAck) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const log = await adbCall('logcat', '-d', '-v', 'brief', '-s', 'BlockcolcPerf:I', '*:S');
      if (log.includes(`event=ack run=${run} request=${request}`)) return request;
      await sleep(400);
    }
    throw new Error('Diagnostic APK did not acknowledge the opted-in command.');
  }
  return request;
}
async function collect(operationName = 'snapshot', extras = []) {
  const request = await operation(operationName, extras);
  // Initial geometry can monopolise WebView JS longer than twelve seconds.
  // Preserve that cost; wait for a real complete sample rather than dropping it.
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const log = await adbCall('logcat', '-d', '-v', 'brief', '-s', 'BlockcolcPerf:I', '*:S');
    const values = decodeProbeSamples(log, run, request);
    if (values.length) return values.at(-1);
    await sleep(400);
  }
  throw new Error('Missing complete native sample; not a successful measurement.');
}
function assertIdle(sample) {
  if (!sample.safety?.known || !sample.safety?.idle) throw new Error('Focus, plan, report or unknown state: do not restart/mutate the app.');
}
async function waitWorld() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const value = await collect();
    if (value.worldReady && typeof value.phases?.['opening-complete'] === 'number') return value;
    await sleep(750);
  }
  throw new Error('World/opening did not complete in 90 seconds.');
}
async function begin(label) { await operation('window', ['--es', 'probeWindow', label], true); await sleep(100); }
async function record(label) {
  const value = await collect(); assertIdle(value);
  evidence.samples.push({ label, ...value, batteryTemperatureC: await assertReady() });
  await writeEvidence(); return value;
}
async function writeEvidence() { await mkdir(path.dirname(absoluteOutput), { recursive: true }); await writeFile(absoluteOutput, JSON.stringify(evidence, null, 2)); }

try {
  const manufacturer = (await adbCall('shell', 'getprop', 'ro.product.manufacturer')).trim();
  if (manufacturer.toLowerCase() !== 'oneplus') throw new Error('This run is scoped to the connected OnePlus.');
  evidence.device = { serial, manufacturer, model: (await adbCall('shell', 'getprop', 'ro.product.model')).trim(), android: (await adbCall('shell', 'getprop', 'ro.build.version.release')).trim() };
  const apkPath = (await adbCall('shell', 'pm', 'path', pkg)).split(/\r?\n/).find(line => /base\.apk/.test(line))?.replace(/^package:/, '').trim();
  if (!apkPath || !(await adbCall('shell', 'sha256sum', apkPath)).startsWith(evidence.apkSha256)) throw new Error('Installed APK does not match the explicitly selected immutable APK.');
  await assertReady();
  run = `perf-${Date.now()}-primer`;
  await operation('arm', ['--es', 'probeRunId', run], true);
  await sleep(250); assertIdle(await collect());
  for (let iteration = 1; iteration <= iterations; iteration++) {
    assertIdle(await collect()); await assertReady();
    await operation('stop', [], true);
    await adbCall('shell', 'am', 'force-stop', pkg);
    run = `perf-${Date.now()}-cold${iteration}`;
    const launch = await adbCall('shell', 'am', 'start', '-W', '-n', activity, '-a', `${pkg}.action.PERFORMANCE`,
      '--es', 'probeOperation', 'arm', '--es', 'probeRunId', run, '--es', 'probeRequestId', 'boot');
    const value = await waitWorld(); assertIdle(value);
    evidence.samples.push({ label: `cold-${iteration}`, ...value, launchState: /LaunchState:\s*(\S+)/.exec(launch)?.[1] ?? null,
      androidTotalTimeMs: Number(/TotalTime:\s*(\d+)/.exec(launch)?.[1] ?? NaN) });
    await begin('idle'); await sleep(10_000); await record(`post-ready-idle-${iteration}`);
  }
  const canvas = await collect('target', ['--es', 'probeTarget', 'canvas']);
  if (canvas.rect?.height < 100) throw new Error('World canvas is not ready for a real touch measurement.');
  for (const label of ['rotation-first', 'rotation-repeat']) {
    assertIdle(await collect()); await begin(label);
    const from = screenPoint(canvas, .3, .42), to = screenPoint(canvas, .7, .42);
    await adbCall('shell', 'input', 'touchscreen', 'swipe', ...from.map(String), ...to.map(String), '1600');
    await sleep(500); await record(label);
  }
  if (captureZoom) {
    assertIdle(await collect()); await begin('zoom');
    for (const direction of ['in', 'in', 'out', 'out']) { await operation('zoom', ['--es', 'probeZoom', direction], true); await sleep(400); }
    await sleep(500); await record('zoom-wheel-handler');
    evidence.limitations.push('Zoom invokes a bounded WheelEvent through the real renderer handler; not a hardware multi-touch pinch.');
  }
  for (const label of ['tasks', 'stats', 'settings', 'world', 'stats', 'world']) {
    const target = await collect('target', ['--es', 'probeTarget', label]);
    if (!target.visible) { evidence.limitations.push('Navigation buttons hidden by minimal mode; did not change preference to expose them.'); break; }
    assertIdle(await collect()); await begin('navigation');
    await adbCall('shell', 'input', 'tap', ...screenPoint(target).map(String));
    await sleep(1500); await record(`navigation-${label}`);
  }
  await begin('return');
  await adbCall('shell', 'input', 'keyevent', 'KEYCODE_HOME'); await sleep(1500);
  await adbCall('shell', 'am', 'start', '-W', '-n', activity);
  await sleep(2000); await record('hot-return');
  evidence.status = 'completed';
} catch (error) {
  evidence.status = 'failed'; evidence.failure = error.message; process.exitCode = 1;
} finally {
  try { if (run) await operation('stop'); } catch { evidence.limitations.push('Could not send stop; probe/screen lease self-expires after four minutes.'); }
  evidence.finishedAt = new Date().toISOString(); await writeEvidence();
  console.log(`Android performance ${evidence.status}: ${absoluteOutput}`);
}
