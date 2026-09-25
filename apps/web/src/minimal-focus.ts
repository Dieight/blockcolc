import type { ApplicationCommand, ApplicationResult } from '@tomato-clock/application';
import type { DomainState } from '@tomato-clock/domain';
import type { FocusPreferences } from './app-types';
import { marathonEndInstant } from './marathon-end-time';
import { settledFocusSessionIds, unsettledMarathonSessions } from './marathon-settlement';
import { createAutomaticContinuationSchedule, MAX_MARATHON_ROUNDS, newAutomaticContinuationAuthorizationId, planRoundsForDuration, roundPlansEqual, type RoundPlan } from './round-plan';
import { markFocusPerformance } from './focus-performance';

export interface MinimalFocusDraft {
  hourDraft: string;
  minuteDraft: string;
  day: 'today' | 'tomorrow';
  /** A gesture selects an exact instant; never roll an expired selection to tomorrow. */
  endMs?: number;
}
type FocusTiming = Pick<FocusPreferences, 'focusMinutes' | 'breakMinutes'> & Partial<Pick<FocusPreferences, 'autoContinueFocus'>>;
type StartCommand = Extract<ApplicationCommand, { type: 'StartFocus' }>;
type Rejected = { ok: false; message: string };
export type MinimalFocusPreparation = Rejected | { ok: true; plan: RoundPlan; command: StartCommand };

/** No storage writes or inferred task selection. Re-run at submit, not only at preview. */
export function prepareMinimalFocus(
  state: DomainState, existingPlan: RoundPlan | null, draft: MinimalFocusDraft,
  preferences: FocusTiming, now = Date.now(),
): MinimalFocusPreparation {
  if (state.activeFocusSession) return { ok: false, message: '已有专注正在进行，请先完成当前轮次。' };
  if (existingPlan) return { ok: false, message: '已有专注计划，请先继续或结束当前计划。' };
  const settled = settledFocusSessionIds(state);
  if (unsettledMarathonSessions(state).length > 0 || state.focusHistory.some(session =>
    session.status === 'completed' && session.marathon !== true && !settled.has(session.id))) {
    return { ok: false, message: '还有已完成的专注等待汇报，请先提交进度。' };
  }
  const host = state.projects.find(project => project.id === state.activeProjectId && project.status === 'active');
  if (!host) return { ok: false, message: '请先在完整模式中建立或选择一个任务。' };
  if (!/^\d{1,2}$/.test(draft.hourDraft) || !/^\d{1,2}$/.test(draft.minuteDraft)) {
    return { ok: false, message: '请输入完整的结束小时和分钟。' };
  }
  const time = `${draft.hourDraft.padStart(2, '0')}:${draft.minuteDraft.padStart(2, '0')}`;
  // 用户指示回滚后极简单已无今天/明天切换；与马拉松计划一致，"过去时刻落明天"
  //（day 传 undefined，marathonEndInstant 对过去时刻自动滚动到明天）。
  const endMs = draft.endMs ?? marathonEndInstant(time, now);
  if (endMs === null || !Number.isFinite(endMs) || endMs <= now) return { ok: false, message: '请选择未来的有效结束时间。' };
  let schedule;
  try {
    // One extra round detects overflow instead of silently truncating the plan.
    schedule = planRoundsForDuration(endMs - now, preferences.focusMinutes, preferences.breakMinutes, MAX_MARATHON_ROUNDS + 1);
  } catch {
    return { ok: false, message: '专注或休息时长无效，请在设置中检查。' };
  }
  if (!schedule) return { ok: false, message: '结束时间过近，至少需要容纳一轮专注。' };
  if (schedule.rounds > MAX_MARATHON_ROUNDS) return { ok: false, message: `本场最多 ${MAX_MARATHON_ROUNDS} 轮，请选择更近的结束时间。` };
  return {
    ok: true,
    plan: {
      projectId: host.id, subtaskId: null, totalRounds: schedule.rounds, completedRounds: 0,
      status: 'ready', reportedSessionIds: [], mode: 'marathon', deferredSettlement: true,
      endAt: new Date(endMs).toISOString(),
    },
    command: { type: 'StartFocus', projectId: host.id, subtaskId: null,
      plannedDurationMs: preferences.focusMinutes * 60_000, marathon: true, deferredSettlement: true },
  };
}

export interface MinimalFocusStartDependencies {
  snapshot: () => DomainState;
  dispatch: (command: StartCommand) => Promise<ApplicationResult>;
  readPlan: () => RoundPlan | null;
  /** Write before publishing local state; throw on failure. */
  writePlan: (plan: RoundPlan | null) => void;
  newAuthorizationId?: () => string;
  now?: () => number;
}

export type MinimalFocusStartResult = Rejected | { ok: true; plan: RoundPlan; warning?: string };

/**
 * Owns a single submission lane. The ready plan is persisted before dispatch;
 * the domain commits focus before the local currentSessionId is published.
 * These stores are not atomic: a retained ready plan plus the authoritative
 * active session is sufficient for reconciliation if the second write fails.
 */
export function createMinimalFocusStarter(dependencies: MinimalFocusStartDependencies) {
  let busy = false;
  return {
    get busy() { return busy; },
    async start(draft: MinimalFocusDraft, preferences: FocusTiming): Promise<MinimalFocusStartResult> {
      if (busy) return { ok: false, message: '正在开始专注，请勿重复提交。' };
      busy = true;
      let prepared: Extract<MinimalFocusPreparation, { ok: true }> | undefined;
      try {
        const result = prepareMinimalFocus(dependencies.snapshot(), dependencies.readPlan(), draft, preferences, dependencies.now?.() ?? Date.now());
        if (!result.ok) return result;
        const plan = preferences.autoContinueFocus && result.plan.totalRounds > 1
          ? {
              ...result.plan,
              automaticContinuation: createAutomaticContinuationSchedule(
                dependencies.newAuthorizationId?.() ?? newAutomaticContinuationAuthorizationId(),
                result.command.plannedDurationMs,
                preferences.breakMinutes * 60_000,
              ),
            }
          : result.plan;
        prepared = { ...result, plan };
        dependencies.writePlan(plan);
        markFocusPerformance('plan-persisted');
        markFocusPerformance('command-queued');
        const started = await dependencies.dispatch(result.command);
        if (!started.ok) {
          if (roundPlansEqual(dependencies.readPlan(), result.plan)) dependencies.writePlan(null);
          return { ok: false, message: started.message };
        }
        const session = started.state.activeFocusSession;
        if (!session) throw new Error('专注未能开始，请返回完整模式检查当前状态。');
        markFocusPerformance('command-committed');
        const focusedPlan: RoundPlan = { ...prepared.plan, status: 'focus', currentSessionId: session.id };
        try { dependencies.writePlan(focusedPlan); }
        catch { return { ok: true, plan: focusedPlan, warning: '专注已保存；轮次界面保存失败，重新打开时将按真实计时恢复。' }; }
        return { ok: true, plan: focusedPlan };
      } catch (error) {
        // Never cancel a possibly committed focus to compensate for a UI write.
        if (prepared && !dependencies.snapshot().activeFocusSession) {
          try {
            if (roundPlansEqual(dependencies.readPlan(), prepared.plan)) dependencies.writePlan(null);
          } catch { /* Keep the recoverable draft; surface the original failure. */ }
        }
        return { ok: false, message: error instanceof Error ? error.message : '开始失败，请重试。' };
      } finally { busy = false; }
    },
  };
}
