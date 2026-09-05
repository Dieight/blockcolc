import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import path from 'node:path';

const toolsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.dirname(toolsDirectory);
const webRoot = path.join(repositoryRoot, 'apps', 'web');
const viteEntry = path.join(repositoryRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const playwrightEntry = path.join(repositoryRoot, 'node_modules', '@playwright', 'test', 'cli.js');
const commandArguments = process.argv.slice(2);
const diagnosticMode = commandArguments.includes('--diagnostics');
const productionMode = commandArguments.includes('--production');
const releaseSuiteCheckMode = commandArguments.includes('--release-suites-check');
const releaseSuiteMode = commandArguments.includes('--release-suites') || releaseSuiteCheckMode;
if (diagnosticMode && releaseSuiteMode) throw new Error('Diagnostic and release-suite modes are mutually exclusive.');
const playwrightArguments = commandArguments.filter((argument) => argument !== '--diagnostics' && argument !== '--production' && argument !== '--release-suites' && argument !== '--release-suites-check');
if (releaseSuiteMode && playwrightArguments.some((argument) => argument === '--workers' || argument.startsWith('--workers='))) {
  throw new Error('Release-suite worker ownership comes from playwright.release-suites.json and cannot be overridden.');
}
const playwrightConfig = path.join(webRoot, diagnosticMode ? 'playwright.diagnostics.config.ts' : 'playwright.config.ts');
const serverUrl = 'http://127.0.0.1:41988';
const lastRunPath = path.join(webRoot, 'test-results', '.last-run.json');
const releaseSuiteManifestPath = path.join(webRoot, 'playwright.release-suites.json');
const releaseSummaryPath = path.join(webRoot, 'test-results', 'release-summary.json');
const releaseSummaryArchiveDirectory = path.join(repositoryRoot, 'artifacts', 'test-gates', 'web-release');

function spawnNode(arguments_, options = {}) {
  return spawn(process.execPath, arguments_, {
    windowsHide: true,
    ...options,
  });
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function getWorkingTreeFingerprint() {
  const runGit = (arguments_, encoding = 'utf8') => {
    const result = spawnSync('git', arguments_, {
      cwd: repositoryRoot,
      encoding,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0) throw new Error(`git ${arguments_.join(' ')} failed: ${result.stderr}`);
    return result.stdout;
  };
  const head = runGit(['rev-parse', 'HEAD']).trim();
  const trackedDiffSha256 = sha256(runGit(['diff', 'HEAD', '--binary'], null));
  const untrackedPaths = runGit(['ls-files', '--others', '--exclude-standard']).split(/\r?\n/u).filter(Boolean).sort();
  const untracked = [];
  for (const relativePath of untrackedPaths) {
    untracked.push({ relativePath, sha256: sha256(await fs.readFile(path.join(repositoryRoot, relativePath))) });
  }
  const fingerprintSha256 = sha256(JSON.stringify({ head, trackedDiffSha256, untracked }));
  return { head, trackedDiffSha256, untracked, fingerprintSha256 };
}

async function writeReleaseSummary(summary, archive = false) {
  const contents = `${JSON.stringify(summary, null, 2)}\n`;
  await fs.mkdir(path.dirname(releaseSummaryPath), { recursive: true });
  await fs.writeFile(releaseSummaryPath, contents, 'utf8');
  if (!archive) return;
  await fs.mkdir(releaseSummaryArchiveDirectory, { recursive: true });
  const archiveName = `${summary.startedAt.replaceAll(':', '-').replaceAll('.', '-')}.json`;
  const archivePath = path.join(releaseSummaryArchiveDirectory, archiveName);
  await fs.writeFile(archivePath, contents, 'utf8');
  process.stdout.write(`Web release evidence: ${archivePath}\n`);
}

async function waitForServer(processHandle) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Vite exited before becoming ready (exit ${processHandle.exitCode}).`);
    }
    try {
      const response = await fetch(serverUrl, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) {
        await response.arrayBuffer();
        return;
      }
      await response.arrayBuffer();
    } catch {
      // Vite normally needs a few attempts while it starts and pre-bundles dependencies.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Vite did not become ready at ${serverUrl}.`);
}

const completionDeadlineMs = Number.isFinite(Number(process.env.E2E_COMPLETION_DEADLINE_MS))
  ? Number(process.env.E2E_COMPLETION_DEADLINE_MS)
  : 1_500_000;

async function waitForTestCompletion(processHandle) {
  const deadline = Date.now() + completionDeadlineMs;
  let completionMarkerAt = 0;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) return processHandle.exitCode ?? 1;
    try {
      const result = JSON.parse(await fs.readFile(lastRunPath, 'utf8'));
      if ((result?.status === 'passed' || result?.status === 'failed') && completionMarkerAt === 0) {
        completionMarkerAt = Date.now();
      }
    } catch {
      // The reporter writes the marker after all workers finish.
    }
    if (completionMarkerAt > 0 && Date.now() - completionMarkerAt > 30_000) {
      throw new Error('Playwright wrote its completion marker but did not exit within 30 seconds.');
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Playwright did not exit within ${Math.round(completionDeadlineMs / 1000)} seconds.`);
}

async function stopProcessTree(processHandle) {
  if (processHandle.exitCode !== null || processHandle.signalCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(processHandle.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  processHandle.kill('SIGTERM');
}

async function runPlaywright(arguments_, reportPath) {
  await fs.rm(lastRunPath, { force: true });
  if (reportPath) await fs.rm(reportPath, { force: true });
  const playwright = spawnNode([
    playwrightEntry,
    'test',
    '--config',
    playwrightConfig,
    ...arguments_,
    ...(reportPath ? ['--reporter=line,json'] : []),
  ], {
    cwd: webRoot,
    stdio: 'inherit',
    env: reportPath
      ? { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath, BLOCKCOLC_E2E_RELEASE_GATE: '1' }
      : process.env,
  });
  let exitCode = 1;
  try {
    exitCode = await waitForTestCompletion(playwright);
  } finally {
    await stopProcessTree(playwright);
  }
  const report = reportPath ? JSON.parse(await fs.readFile(reportPath, 'utf8')) : undefined;
  return { exitCode, report };
}

function collectReportEvidence(report, suiteName) {
  const tests = [];
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const durationMs = (test.results ?? []).reduce((total, result) => total + Number(result.duration ?? 0), 0);
        tests.push({
          suite: suiteName,
          file: spec.file,
          line: spec.line,
          title: spec.title,
          project: test.projectName,
          status: test.status,
          durationSeconds: Math.round(durationMs / 100) / 10,
          skipReason: test.status === 'skipped'
            ? test.annotations?.find((annotation) => annotation.type === 'skip')?.description ?? 'explicit test.skip'
            : undefined,
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report?.suites ?? []) visit(suite);
  return tests;
}

function listTestCount(arguments_) {
  const result = spawnSync(process.execPath, [
    playwrightEntry,
    'test',
    '--config',
    playwrightConfig,
    ...arguments_,
    '--list',
    '--reporter=json',
  ], {
    cwd: webRoot,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Unable to list Playwright tests.\n${result.stderr || result.stdout}`);
  const report = JSON.parse(result.stdout);
  if (report.errors?.length) throw new Error(`Playwright list reported errors: ${JSON.stringify(report.errors)}`);
  return Number(report.stats?.expected ?? 0) + Number(report.stats?.skipped ?? 0);
}

async function loadAndValidateReleaseSuites() {
  const manifest = JSON.parse(await fs.readFile(releaseSuiteManifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.suites) || !Array.isArray(manifest.diagnostics)) {
    throw new Error('Invalid playwright.release-suites.json schema.');
  }
  const testFiles = (await fs.readdir(path.join(webRoot, 'tests'))).filter((name) => name.endsWith('.spec.ts')).sort();
  const assigned = manifest.suites.flatMap((suite) => suite.specs ?? []);
  const duplicates = assigned.filter((name, index) => assigned.indexOf(name) !== index);
  if (duplicates.length) throw new Error(`Release specs are assigned more than once: ${[...new Set(duplicates)].join(', ')}`);
  const classified = [...assigned, ...manifest.diagnostics].sort();
  const missing = testFiles.filter((name) => !classified.includes(name));
  const unknown = classified.filter((name) => !testFiles.includes(name));
  if (missing.length || unknown.length) {
    throw new Error(`Release suite classification drift. Missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}.`);
  }
  for (const suite of manifest.suites) {
    if (!suite.name || !Number.isInteger(suite.workers) || suite.workers < 1 || !Array.isArray(suite.specs) || suite.specs.length === 0) {
      throw new Error(`Invalid release suite entry: ${JSON.stringify(suite)}`);
    }
  }
  return manifest.suites;
}

async function runReleaseSuites() {
  const suites = await loadAndValidateReleaseSuites();
  const fullTestCount = listTestCount([]);
  const planned = suites.map((suite) => {
    const specArguments = suite.specs.map((name) => `tests/${name}`);
    return { ...suite, specArguments, testCount: listTestCount(specArguments) };
  });
  const classifiedTestCount = planned.reduce((total, suite) => total + suite.testCount, 0);
  if (classifiedTestCount !== fullTestCount) {
    throw new Error(`Release suite test-count drift: classified ${classifiedTestCount}, full config ${fullTestCount}.`);
  }

  const summary = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    status: 'running',
    fullTestCount,
    source: await getWorkingTreeFingerprint(),
    suites: [],
    skippedTests: [],
    slowTests: [],
  };
  await writeReleaseSummary(summary);

  for (const suite of planned) {
    const startedAt = Date.now();
    const suiteReportPath = path.join(webRoot, `.release-${suite.name}-report.json`);
    process.stdout.write(`\n==> Web release suite ${suite.name}: ${suite.testCount} tests, ${suite.workers} worker(s)\n`);
    const { exitCode, report } = await runPlaywright([...suite.specArguments, `--workers=${suite.workers}`, ...playwrightArguments], suiteReportPath);
    const tests = collectReportEvidence(report, suite.name);
    await fs.rm(suiteReportPath, { force: true });
    summary.skippedTests.push(...tests.filter((test) => test.status === 'skipped'));
    summary.slowTests.push(...tests.filter((test) => test.status !== 'skipped'));
    summary.slowTests.sort((left, right) => right.durationSeconds - left.durationSeconds);
    summary.slowTests = summary.slowTests.slice(0, 20);
    summary.suites.push({
      name: suite.name,
      workers: suite.workers,
      specCount: suite.specs.length,
      testCount: suite.testCount,
      durationSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
      exitCode,
      status: exitCode === 0 ? 'passed' : 'failed',
    });
    if (exitCode !== 0) {
      summary.status = 'failed';
      summary.finishedAt = new Date().toISOString();
      await writeReleaseSummary(summary, true);
      return exitCode;
    }
    await writeReleaseSummary(summary);
  }
  summary.status = 'passed';
  summary.finishedAt = new Date().toISOString();
  summary.durationSeconds = summary.suites.reduce((total, suite) => total + suite.durationSeconds, 0);
  await writeReleaseSummary(summary, true);
  process.stdout.write(`\nAll ${fullTestCount} classified Web release tests completed across ${planned.length} suites.\n`);
  return 0;
}

async function checkReleaseSuites() {
  const suites = await loadAndValidateReleaseSuites();
  const fullTestCount = listTestCount([]);
  let classifiedTestCount = 0;
  for (const suite of suites) {
    const testCount = listTestCount(suite.specs.map((name) => `tests/${name}`));
    classifiedTestCount += testCount;
    process.stdout.write(`${suite.name}: ${suite.specs.length} specs, ${testCount} tests, ${suite.workers} worker(s)\n`);
  }
  if (classifiedTestCount !== fullTestCount) {
    throw new Error(`Release suite test-count drift: classified ${classifiedTestCount}, full config ${fullTestCount}.`);
  }
  process.stdout.write(`Release suite classification is complete: ${fullTestCount} tests.\n`);
}

if (releaseSuiteCheckMode) {
  await checkReleaseSuites();
  process.exit(0);
}

const useProductionServer = releaseSuiteMode || productionMode;
if (useProductionServer) {
  const build = spawnSync(process.execPath, [viteEntry, 'build', '--mode', 'test'], {
    cwd: webRoot,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const vite = spawnNode(useProductionServer
  ? [viteEntry, 'preview', '--host', '127.0.0.1', '--port', '41988', '--strictPort']
  : [viteEntry, '--host', '127.0.0.1', '--port', '41988', '--strictPort'], {
  cwd: webRoot,
  stdio: ['ignore', 'inherit', 'inherit'],
});

let exitCode = 1;
try {
  await waitForServer(vite);
  exitCode = releaseSuiteMode ? await runReleaseSuites() : (await runPlaywright(playwrightArguments)).exitCode;
} finally {
  await stopProcessTree(vite);
}

process.exit(exitCode);
