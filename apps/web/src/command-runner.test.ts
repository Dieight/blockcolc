import { describe, expect, it, vi } from 'vitest';
import { createInitialState, execute } from '@blockcolc/domain';
import type { ApplicationResult } from '@blockcolc/application';
import { commandFeedback } from './command-feedback';
import { createCommandRunner } from './command-runner';
import { beginFocusSubmission, readFocusSubmissionDiagnosticsForTest, resetFocusSubmissionDiagnosticsForTest } from './submission-performance';

const created = execute(createInitialState('UTC'), { type: 'CreateProject', projectId: 'p', title: 'Work', blueprintId: 'cottage', subtasks: [{ id: 's', title: 'Task' }] }, { now: () => new Date('2026-09-08T00:00:00Z') });
if (!created.ok) throw Error(created.message);
const state = created.state;
const success = (events: Extract<ApplicationResult, { ok: true }>['events'] = [], warnings: Extract<ApplicationResult, { ok: true }>['warnings'] = []): ApplicationResult => ({ ok: true, state, events, warnings });
const warning = { code: 'NOTIFICATION_INEXACT' as const, message: 'warning' };
const interrupted = { type: 'FocusInterrupted' as const, sessionId: 'r', reason: 'app-switch-limit' as const, category: null };
describe('command feedback contract', () => {
  it('keeps integrity interruption out of the global toast, even with notification warnings', () => {
    expect(commandFeedback(success([interrupted], [warning])).message).toBeNull();
  });
  it('prioritizes interrupted effort and completed habit buildings over warnings', () => {
    expect(commandFeedback(success([{ ...interrupted, reason: 'user-cancelled' }], [warning])).message?.text).toContain('有效专注时间');
    expect(commandFeedback(success([{ type: 'HabitBuildingCompleted', projectId: 'p', buildingId: 'b', cycleNumber: 1 }], [warning])).message?.text).toContain('请选择下一座');
  });
  it('gives only notification warnings the settings action', () => {
    expect(commandFeedback(success([], [warning])).message?.action).toEqual({ label: '去设置', target: 'settings' });
    expect(commandFeedback(success([], [{ code: 'NOTIFICATION_SCHEDULE_FAILED', message: 'failed' }])).message?.action?.target).toBe('settings');
    expect(commandFeedback(success([{ type: 'ProjectDeleted', projectId: 'p' }])).message?.action).toBeUndefined();
  });
  it('resolves early completion from saved history, not the selected project', () => {
    const early = { type: 'FocusCompletedEarly' as const, sessionId: 'r', subtaskId: 's', actualDurationMs: 1000 };
    expect(commandFeedback(success([early])).message?.text).toContain('小任务');
    expect(commandFeedback(success([early, { type: 'HabitBuildingProgressed', projectId: 'p', completedRounds: 1, targetRounds: 10 }])).message?.text).toContain('习惯专注');
    const start = execute(state, { type: 'StartFocus', sessionId: 'r', subtaskId: 's', marathon: true, plannedDurationMs: 60000 }, { now: () => new Date('2026-09-08T00:00:00Z') });
    if (!start.ok) throw Error(start.message);
    const finish = execute(start.state, { type: 'CompleteFocusEarly', reportId: 'report' }, { now: () => new Date('2026-09-08T00:00:01Z') });
    if (!finish.ok) throw Error(finish.message);
    expect(commandFeedback({ ...finish, warnings: [] }).message?.text).toContain('本轮已提前完成');
  });
  it('derives the ceremony independently of ordinary feedback and ignores missing projects', () => {
    expect(commandFeedback(success([{ type: 'ProjectSealedAsMonument', projectId: 'p' }])).ceremony).toEqual({ projectId: 'p', title: 'Work' });
    expect(commandFeedback(success([{ type: 'ProjectSealedAsMonument', projectId: 'missing' }])).ceremony).toBeNull();
    expect(commandFeedback(success()).message).toBeNull();
  });
});

function runner(result: ApplicationResult) {
  const service = { dispatch: vi.fn(async () => result) };
  const ports = { service, feedback: vi.fn(), failure: vi.fn(), refresh: vi.fn() };
  return { ...ports, run: createCommandRunner(ports) };
}
describe('command execution boundary', () => {
  it('correlates a successful submitted report with committed dispatch and projection request', async () => {
    resetFocusSubmissionDiagnosticsForTest();
    const f = runner(success());
    const token = beginFocusSubmission('progress')!;
    await f.run({ type: 'CancelFocus', interruptionCategory: null }, { submissionToken: token });
    expect(readFocusSubmissionDiagnosticsForTest()).toMatchObject([{
      token,
      category: 'progress',
      terminal: 'pending',
      phases: [
        { stage: 'submitted' },
        { stage: 'dispatch-started' },
        { stage: 'dispatch-completed', persistenceCommitted: true },
      ],
    }]);
  });

  it('records rejected or thrown submitted writes as failed attempts without retaining error text', async () => {
    resetFocusSubmissionDiagnosticsForTest();
    const rejected = runner({ ok: false, state, code: 'FOCUS_NOT_ACTIVE', message: 'Rejected secret title', warnings: [] });
    const rejectedToken = beginFocusSubmission('progress')!;
    await rejected.run({ type: 'CancelFocus', interruptionCategory: null }, { submissionToken: rejectedToken });

    const thrown = runner(success());
    const thrownToken = beginFocusSubmission('marathon')!;
    thrown.service.dispatch.mockRejectedValue(Error('private command payload'));
    await expect(thrown.run({ type: 'CancelFocus', interruptionCategory: null }, { submissionToken: thrownToken })).rejects.toThrow();
    expect(readFocusSubmissionDiagnosticsForTest()).toMatchObject([
      { terminal: 'failed', failedPhase: 'dispatch', phases: [{ stage: 'submitted' }, { stage: 'dispatch-started' }, { stage: 'dispatch-rejected' }] },
      { terminal: 'failed', failedPhase: 'dispatch', phases: [{ stage: 'submitted' }, { stage: 'dispatch-started' }, { stage: 'dispatch-threw' }] },
    ]);
    expect(JSON.stringify(readFocusSubmissionDiagnosticsForTest())).not.toContain('secret');
    expect(JSON.stringify(readFocusSubmissionDiagnosticsForTest())).not.toContain('private');
  });

  it('does not relabel an already persisted report if a later UI refresh throws', async () => {
    resetFocusSubmissionDiagnosticsForTest();
    const f = runner(success());
    f.refresh.mockImplementation(() => { throw new Error('refresh failed'); });
    const token = beginFocusSubmission('progress')!;
    await expect(f.run({ type: 'ReportSubtaskProgress', subtaskId: 'private-id', focusSessionIds: ['private-session'], progressBasisPoints: 5000 }, { submissionToken: token })).rejects.toThrow('refresh failed');
    expect(readFocusSubmissionDiagnosticsForTest()).toMatchObject([{
      terminal: 'failed',
      failedPhase: 'projection',
      phases: [{ stage: 'submitted' }, { stage: 'dispatch-started' }, { stage: 'dispatch-completed', persistenceCommitted: true }, { stage: 'projection-failed' }],
    }]);
  });

  it('dispatches once, publishes ordinary feedback, and refreshes after completion', async () => {
    const result = success();
    const f = runner(result);
    expect(await f.run({ type: 'CancelFocus', interruptionCategory: null })).toBe(result);
    expect(f.service.dispatch).toHaveBeenCalledTimes(1);
    expect(f.feedback).toHaveBeenCalledWith(commandFeedback(result));
    expect(f.refresh).toHaveBeenCalledTimes(1);
  });
  it('returns domain rejection unchanged while preserving feedback', async () => {
    const result: ApplicationResult = { ok: false, state, code: 'FOCUS_NOT_ACTIVE', message: 'Rejected', warnings: [] };
    const f = runner(result);
    expect(await f.run({ type: 'CancelFocus', interruptionCategory: null })).toBe(result);
    expect(f.feedback).toHaveBeenCalledWith({ message: { text: 'Rejected' }, ceremony: null });
  });
  it('reports and rethrows the original storage error without retry or success feedback', async () => {
    const f = runner(success());
    const error = Error('save failed');
    f.service.dispatch.mockRejectedValue(error);
    await expect(f.run({ type: 'CancelFocus', interruptionCategory: null })).rejects.toBe(error);
    expect(f.failure).toHaveBeenCalledWith('save failed');
    expect(f.service.dispatch).toHaveBeenCalledTimes(1);
    expect(f.feedback).not.toHaveBeenCalled();
    expect(f.refresh).not.toHaveBeenCalled();
  });
  it('does not retry a committed command when only the notification failed', async () => {
    const f = runner(success([], [warning]));
    expect((await f.run({ type: 'CancelFocus', interruptionCategory: null })).ok).toBe(true);
    expect(f.service.dispatch).toHaveBeenCalledTimes(1);
    expect(f.failure).not.toHaveBeenCalled();
  });
  it('can defer a successful refresh while the caller publishes its persisted plan', async () => {
    const f = runner(success());
    await f.run({ type: 'CancelFocus', interruptionCategory: null }, { deferRefresh: true });
    expect(f.service.dispatch).toHaveBeenCalledTimes(1);
    expect(f.refresh).not.toHaveBeenCalled();
  });
});
