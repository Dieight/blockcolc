import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const toolsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.dirname(toolsDirectory);
const webRoot = path.join(repositoryRoot, 'apps', 'web');
const viteEntry = path.join(repositoryRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const playwrightEntry = path.join(repositoryRoot, 'node_modules', '@playwright', 'test', 'cli.js');
const playwrightConfig = path.join(webRoot, 'playwright.config.ts');
const serverUrl = 'http://127.0.0.1:41988';
const lastRunPath = path.join(webRoot, 'test-results', '.last-run.json');

function spawnNode(arguments_, options = {}) {
  return spawn(process.execPath, arguments_, {
    windowsHide: true,
    ...options,
  });
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
  : 900_000;

async function waitForTestCompletion(processHandle) {
  const deadline = Date.now() + completionDeadlineMs;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) return processHandle.exitCode ?? 1;
    try {
      const result = JSON.parse(await fs.readFile(lastRunPath, 'utf8'));
      if (result?.status === 'passed') return 0;
      if (result?.status === 'failed') return 1;
    } catch {
      // The reporter writes the marker after all workers finish.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Playwright did not produce a completion marker within ${Math.round(completionDeadlineMs / 1000)} seconds.`);
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

const vite = spawnNode([viteEntry, '--host', '127.0.0.1', '--port', '41988'], {
  cwd: webRoot,
  stdio: ['ignore', 'inherit', 'inherit'],
});

let exitCode = 1;
try {
  await waitForServer(vite);
  await fs.rm(lastRunPath, { force: true });
  const playwright = spawnNode([
    playwrightEntry,
    'test',
    '--config',
    playwrightConfig,
    ...process.argv.slice(2),
  ], {
    cwd: webRoot,
    stdio: 'inherit',
  });
  exitCode = await waitForTestCompletion(playwright);
  await stopProcessTree(playwright);
} finally {
  await stopProcessTree(vite);
}

process.exit(exitCode);
