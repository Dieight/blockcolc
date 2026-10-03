export function shouldStopFullRun(exitCode, collectFailures) {
  return exitCode !== 0 && !collectFailures;
}

export function fullRunExitCode(steps) {
  return steps.find(step => step.exitCode !== 0)?.exitCode ?? 0;
}
