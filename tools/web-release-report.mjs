function* iterateTests(suites) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) yield { spec, test };
      yield* iterateTests(spec.suites);
    }
    yield* iterateTests(suite.suites);
  }
}

function testDurationMs(test) {
  return (test.results ?? []).reduce((total, result) => total + Number(result.duration ?? 0), 0);
}

function isFlakyTest(test) {
  const results = test.results ?? [];
  const finalStatus = results.at(-1)?.status;
  const recoveredAfterFailure = results.length > 1
    && ['passed', 'expected'].includes(finalStatus)
    && results.slice(0, -1).some((result) => !['passed', 'expected'].includes(result.status));
  return test.status === 'flaky' || recoveredAfterFailure;
}

export function collectReportEvidence(report, suiteName) {
  return [...iterateTests(report?.suites)].map(({ spec, test }) => {
    const evidence = {
      suite: suiteName,
      file: spec.file,
      line: spec.line,
      title: test.title ?? spec.title,
      project: test.projectName,
      status: test.status,
      durationSeconds: Math.round(testDurationMs(test) / 100) / 10,
    };
    if (test.status === 'skipped') {
      evidence.skipReason = test.annotations?.find((annotation) => annotation.type === 'skip')?.description
        ?? 'explicit test.skip';
    }
    return evidence;
  });
}

export function summarizePlaywrightReport(report, suiteName) {
  const tests = [...iterateTests(report?.suites)];
  const evidence = collectReportEvidence(report, suiteName);
  const retryCount = tests.reduce((total, { test }) => total + Math.max(0, (test.results ?? []).length - 1), 0);
  const flakyTestCount = tests.filter(({ test }) => isFlakyTest(test)).length;
  const skippedTests = evidence.filter((test) => test.status === 'skipped');
  return {
    retryCount,
    flakyTestCount,
    skippedTestCount: skippedTests.length,
    skippedTests,
    stats: report?.stats ?? null,
    testCount: tests.length,
  };
}
