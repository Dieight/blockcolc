import { describe, expect, it, vi } from 'vitest';
import { createInitialState, type DomainErrorCode } from '@tomato-clock/domain';
import type { ApplicationResult } from '@tomato-clock/application';
import { applyTaskProgressSelection, submitMarathonReportOnce } from './FocusReports';

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
