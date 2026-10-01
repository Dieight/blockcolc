import { describe, expect, it, vi } from 'vitest';
import { createInitialState, type DomainErrorCode } from '@blockcolc/domain';
import type { ApplicationCommand, ApplicationResult } from '@blockcolc/application';
import type { CommandRunnerOptions } from './command-runner';
import { applyTaskProgressSelection, focusReportSurfaceClass, submitFocusMarathonReport, submitFocusProgressReport, submitMarathonReportOnce } from './FocusReports';
import { readFocusSubmissionDiagnosticsForTest, resetFocusSubmissionDiagnosticsForTest } from './submission-performance';
import { createCommandRunner } from './command-runner';

function okResult(): ApplicationResult {
  return { ok: true, state: createInitialState(), events: [], warnings: [] };
}

function rejectedResult(code: DomainErrorCode = 'FOCUS_ALREADY_REPORTED'): ApplicationResult {
  return { ok: false, state: createInitialState(), code, message: '已处理', warnings: [] };
}

const command = {
  type: 'ReportMarathonFocus' as const,
  entries: [],
  habitAllocations: [],
  focusSessionIds: ['session-1'],
};

describe('MarathonProgressReport submission boundary', () => {
  it('correlates the ordinary report command with the real command runner options', async () => {
    resetFocusSubmissionDiagnosticsForTest();
    const reportCommand = { type: 'ReportSubtaskProgress' as const, subtaskId: 'task-local', focusSessionIds: ['session-local'], progressBasisPoints: 5000 };
    const onSubmitted = vi.fn();
    const run = vi.fn(async (_command:ApplicationCommand,_options?:CommandRunnerOptions) => okResult());
    await submitFocusProgressReport({ command: reportCommand, run, onSubmitted });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toEqual(reportCommand);
    expect(run.mock.calls[0]?.[1]).toMatchObject({ submissionToken: expect.any(Number) });
    expect(onSubmitted).toHaveBeenCalledTimes(1);
    expect(readFocusSubmissionDiagnosticsForTest()).toMatchObject([{ category: 'progress', phases: [{ stage: 'submitted' }] }]);
  });

  it.each([
    ['a domain rejection', async () => rejectedResult()],
    ['a thrown save failure', async () => { throw new Error('private title'); }],
  ])('keeps an ordinary report retryable after %s', async (_label, firstRun) => {
    resetFocusSubmissionDiagnosticsForTest();
    const command = { type: 'ReportSubtaskProgress' as const, subtaskId: 'task-local', focusSessionIds: ['session-local'], progressBasisPoints: 5000 };
    const dispatch = vi.fn(async () => okResult()).mockImplementationOnce(firstRun).mockResolvedValueOnce(okResult());
    const run = createCommandRunner({
      service:{dispatch}, feedback:vi.fn(), failure:vi.fn(), refresh:vi.fn(),
    });
    const onSubmitted = vi.fn();
    try { await submitFocusProgressReport({ command, run, onSubmitted }); } catch { /* caller retains the report surface */ }
    await submitFocusProgressReport({ command, run, onSubmitted });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(onSubmitted).toHaveBeenCalledTimes(1);
    expect(readFocusSubmissionDiagnosticsForTest()).toMatchObject([
      { terminal: 'failed', failedPhase: 'dispatch' },
      { terminal: 'pending', category: 'progress' },
    ]);
    expect(JSON.stringify(readFocusSubmissionDiagnosticsForTest())).not.toContain('private title');
  });

  it('correlates marathon settlement without storing the command identifiers', async () => {
    resetFocusSubmissionDiagnosticsForTest();
    const reportCommand = { type: 'ReportMarathonFocus' as const, entries: [], habitAllocations: [], focusSessionIds: ['session-private'] };
    const run = vi.fn(async (_command:ApplicationCommand,_options?:CommandRunnerOptions) => okResult());
    const result = await submitFocusMarathonReport({
      busyRef: { current: false }, setBusy: vi.fn(), canSubmit: true, run,
      command: reportCommand, onSubmitted: vi.fn(),
    });
    expect(result).toBe('submitted');
    expect(run.mock.calls[0]?.[0]).toEqual(reportCommand);
    expect(run.mock.calls[0]?.[1]).toMatchObject({ submissionToken: expect.any(Number) });
    expect(readFocusSubmissionDiagnosticsForTest()).toMatchObject([{ category: 'marathon', phases: [{ stage: 'submitted' }] }]);
    expect(JSON.stringify(readFocusSubmissionDiagnosticsForTest())).not.toContain('session-private');
  });

  it('does not allocate a marathon token when submission is ignored or has no domain command', async () => {
    resetFocusSubmissionDiagnosticsForTest();
    const command = { type: 'ReportMarathonFocus' as const, entries: [], habitAllocations: [], focusSessionIds: ['session-private'] };
    const run = vi.fn(async (_command:ApplicationCommand,_options?:CommandRunnerOptions) => okResult());
    await expect(submitFocusMarathonReport({busyRef:{current:true},setBusy:vi.fn(),canSubmit:true,run,command,onSubmitted:vi.fn()})).resolves.toBe('ignored');
    await expect(submitFocusMarathonReport({busyRef:{current:false},setBusy:vi.fn(),canSubmit:false,run,command,onSubmitted:vi.fn()})).resolves.toBe('ignored');
    await expect(submitFocusMarathonReport({busyRef:{current:false},setBusy:vi.fn(),canSubmit:true,run,command:null,onSubmitted:vi.fn()})).resolves.toBe('submitted');
    expect(run).not.toHaveBeenCalled();
    expect(readFocusSubmissionDiagnosticsForTest()).toEqual([]);
  });

  it('offers the same report surface with an explicit immersive presentation variant', () => {
    expect(focusReportSurfaceClass('embedded')).toBe('focus-report-surface');
    expect(focusReportSurfaceClass('immersive')).toBe('focus-report-surface focus-report-surface--immersive');
    expect(focusReportSurfaceClass('minimal')).toBe('focus-report-surface focus-report-surface--immersive focus-report-surface--minimal');
  });
  it('treats unchanged progress as an explicit choice and clears it only on a second click', () => {
    const selected = applyTaskProgressSelection({}, {}, 'subtask-1', 2500);
    expect(selected.choices).toEqual({ 'subtask-1': 2500 });
    expect(selected.taskRounds).toEqual({});

    const changed = applyTaskProgressSelection(selected.choices, { 'subtask-1': 1 }, 'subtask-1', 5000);
    expect(changed.choices).toEqual({ 'subtask-1': 5000 });
    expect(changed.taskRounds).toEqual({ 'subtask-1': 1 });

    const allocated = applyTaskProgressSelection(selected.choices, { 'subtask-1': 1 }, 'subtask-1', 2500);
    expect(allocated.choices).toEqual({});
    expect(allocated.taskRounds).toEqual({});
  });

  it.each([
    ['a false result', async () => rejectedResult()],
    ['a thrown write failure', async () => { throw new Error('write failed'); }],
  ])('keeps the draft retryable after %s', async (_label, firstRun) => {
    const busyRef = { current: false };
    const setBusy = vi.fn();
    const onSubmitted = vi.fn();
    const run = vi.fn()
      .mockImplementationOnce(firstRun)
      .mockResolvedValueOnce(okResult());

    await expect(submitMarathonReportOnce({ busyRef, setBusy, canSubmit: true, run, command, onSubmitted })).resolves.toBe('failed');
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(busyRef.current).toBe(false);

    await expect(submitMarathonReportOnce({ busyRef, setBusy, canSubmit: true, run, command, onSubmitted })).resolves.toBe('submitted');
    expect(onSubmitted).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('ignores a repeated submission while the first write is in flight', async () => {
    const busyRef = { current: false };
    const setBusy = vi.fn();
    const onSubmitted = vi.fn();
    let resolve!: (result: ApplicationResult) => void;
    const run = vi.fn(() => new Promise<ApplicationResult>(result => { resolve = result; }));
    const first = submitMarathonReportOnce({ busyRef, setBusy, canSubmit: true, run, command, onSubmitted });
    await expect(submitMarathonReportOnce({ busyRef, setBusy, canSubmit: true, run, command, onSubmitted })).resolves.toBe('ignored');
    resolve(okResult());
    await expect(first).resolves.toBe('submitted');
    expect(run).toHaveBeenCalledTimes(1);
    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });

  it('acknowledges an empty settlement without dispatching a command', async () => {
    const busyRef = { current: false };
    const onSubmitted = vi.fn();
    const run = vi.fn();
    await expect(submitMarathonReportOnce({ busyRef, setBusy: () => undefined, canSubmit: true, run, command: null, onSubmitted })).resolves.toBe('submitted');
    expect(run).not.toHaveBeenCalled();
    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });

  it('does not acknowledge a second domain rejection after the first success', async () => {
    const busyRef = { current: false };
    const onSubmitted = vi.fn();
    const run = vi.fn().mockResolvedValueOnce(okResult()).mockResolvedValueOnce(rejectedResult());
    await submitMarathonReportOnce({ busyRef, setBusy: () => undefined, canSubmit: true, run, command, onSubmitted });
    await expect(submitMarathonReportOnce({ busyRef, setBusy: () => undefined, canSubmit: true, run, command, onSubmitted })).resolves.toBe('failed');
    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });
});
