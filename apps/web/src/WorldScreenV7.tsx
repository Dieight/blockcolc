import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ActiveProjectProjection, ApplicationCommand, ApplicationResult, ApplicationService } from '@blockcolc/application';
import { completedPomodorosOn, dailyGoalForDate, localDateOf, type FocusInterruptionCategory } from '@blockcolc/domain';
import type { ResourcePackRepository } from '@blockcolc/resource-pack-indexeddb';
import { localDateForDate, weatherForLocalDate, type WeatherState } from '@blockcolc/voxel/environment';
import { AlertTriangle } from 'lucide-react';
import { PixelTasks as ListTodo, PixelClock as Clock3, PixelStop as Square, PixelPlay, PixelPortal as Minimize2, PixelChest, PixelClose } from './ui/PixelIcon';
import { BuildingMemoryPanel, createBuildingMemory } from './BuildingMemoryPanel';
import type { FocusPreferences } from './app-types';
import type { RecordedIntegrityNotice } from './application-lifecycle';
import { useBackLayer } from './back-layer';
import { useBlueprintCatalog, blueprintName, loadVoxelModule, testBuildEnabled } from './voxel-runtime';
import { planRoundsForDuration, plannedDurationMs, reconcileRoundPlan, remainingPlanDurationMs, isUnstartedMarathonPlan, type RoundPlan } from './round-plan';
import { useRoundPlan } from './use-round-plan';
import { useAutomaticContinuation } from './use-automatic-continuation';
import { useFocusFlow } from './use-focus-flow';
import type { FocusPlanDraft } from './focus-flow';
import { useImmersiveControls } from './use-immersive-controls';
import { useMinimalFocus } from './use-minimal-focus';
import { deriveFocusViewState } from './focus-view-state';
import { marathonEndInstant } from './marathon-end-time';
import { WorldCanvasV7 } from './WorldCanvasV7';
import { localWeatherConditionLabel, WorldWeatherAttribution } from './WorldWeatherStatus';
import type { WorldWeatherView } from './use-world-weather';
import { initialEnvironmentPending } from './initial-environment';
import type { WorldDebugProjection } from './world-debug';
import { FocusFace } from './ui/FocusFace';
import { MinimalClockGesture } from './ui/MinimalClockGesture';
import { MinimalBreakClock } from './ui/MinimalBreakClock';
import { MinimalIdleCarousel } from './MinimalIdleCarousel';
import { HolidayEmblem } from './ui/HolidayEmblem';
import { MinimalPanelWeatherOverlay } from './MinimalPanelWeatherOverlay';
import { FocusTimer } from './FocusTimer';
import { FocusPlanSheet, HabitFocusPlanSheet } from './FocusPlanSheets';
import { HabitBuildingSelection } from './HabitBuildingSelection';
import { ProgressReportV7, MarathonProgressReport } from './FocusReports';
import { EndFocusDialog } from './EndFocusDialog';
import { formatClockDuration, formatDurationSummary, formatClockTime } from './focus-format';
import { WorkspaceRest } from './WorkspaceRest';

const SKIP_BREAK_REQUEST_KEY = 'blockcolc-skip-break-request-v1';
function breakPlanIdentity(plan: RoundPlan | null): string | null {
  if (!plan || plan.status !== 'break' || !plan.breakEndsAt) return null;
  return [plan.projectId, plan.subtaskId ?? '', plan.breakEndsAt, plan.completedRounds, plan.totalRounds, plan.endAfterBreak === true ? 'end' : 'next'].join('\u0000');
}
function immersiveBandTestOverride():{bottom:number;right:number}|undefined{if(!testBuildEnabled())return undefined;const read=(key:string)=>{const raw=new URLSearchParams(location.search).get(key);if(raw===null)return undefined;const value=Number(raw);return Number.isFinite(value)&&value>=0&&value<=0.75?value:undefined;};const bottom=read('__immersiveBand');const right=read('__immersiveRightBand');if(bottom===undefined&&right===undefined)return undefined;return{bottom:bottom??0,right:right??0};}

export function WorldScreenV7({ service, active: committedActive, state: committedState, stateRevision, hasActiveProject: committedHasActiveProject, onCreateProject, resourcePacks, run, refresh, onReconcileFocus, preferences, worldWeather, worldDebug = null, minimalWanted, fullDeferredPresentation, onMinimalPresentationChange, onImmersiveLayoutChange, onExitMinimal, onEnterMinimal, recordedIntegrityNotice, focusedProjectId, memoryProjectId, onFocusWorldProject, onInitialProjectFocus, onClearWorldFocus, onCloseWorldMemory, visible, onScenePrepared, onScenePreparationFailed }: {
  service: ApplicationService;
  /** Display facts from one parent commit; event handlers may read the live service. */
  active: ActiveProjectProjection;
  state: ReturnType<ApplicationService['snapshot']>;
  stateRevision: number;
  hasActiveProject: boolean;
  onCreateProject: () => void;
  resourcePacks: ResourcePackRepository;
  run: (command: ApplicationCommand) => Promise<ApplicationResult>;
  refresh: () => void;
  preferences: FocusPreferences;
  worldWeather: WorldWeatherView;
  worldDebug?: WorldDebugProjection | null;
  onReconcileFocus: () => Promise<void>;
  minimalWanted: boolean;
  fullDeferredPresentation: boolean;
  onMinimalPresentationChange: (enabled: boolean) => void;
  /** Keeps the app shell/navigation in sync with the shared immersive face. */
  onImmersiveLayoutChange: (enabled: boolean) => void;
  onExitMinimal: () => void;
  onEnterMinimal: () => void;
  recordedIntegrityNotice: RecordedIntegrityNotice | null;
  focusedProjectId: string | null;
  memoryProjectId: string | null;
  onFocusWorldProject: (projectId: string) => void;
  onInitialProjectFocus: (projectId: string) => void;
  onClearWorldFocus: () => void;
  onCloseWorldMemory: () => void;
  visible: boolean;
  onScenePrepared?: (environment:ReturnType<ApplicationService['snapshot']>['worldSettings']['environmentStyle'])=>void;
  onScenePreparationFailed?: (environment:ReturnType<ApplicationService['snapshot']>['worldSettings']['environmentStyle'])=>void;
}) {
  const [reportPresentation, setReportPresentation] = useState<{
    active: ActiveProjectProjection; state: typeof committedState; plan: RoundPlan | null; hasActiveProject: boolean;
  } | null>(null);
  // Other committed-state subscribers may refresh the shell during a saved
  // receipt. Keep only this busy report's display stable; the actor/world stay live.
  // A synchronous local-plan publication can render before the parent's
  // domain refresh. Never reconcile that new plan against stale focus facts.
  const liveRevision = service.stateRevision();
  const facts = useMemo(() => liveRevision === stateRevision
    ? { active: committedActive, state: committedState }
    : { active: service.activeProjectProjection() ?? committedActive, state: service.snapshot() },
  [service, liveRevision, stateRevision, committedActive, committedState]);
  const active = reportPresentation?.active ?? facts.active;
  const state = reportPresentation?.state ?? facts.state;
  const hasActiveProject = reportPresentation?.hasActiveProject ?? committedHasActiveProject;
  const blueprintCatalog = useBlueprintCatalog();
  const isHabit = active.project.kind === 'habit';
  const habit = active.project.habit;
  const [selected, setSelected] = useState<string | null>(isHabit ? null : active.project.subtasks.find((subtask) => subtask.progressBasisPoints < 10000)?.id ?? active.project.subtasks[0]!.id);
  const [rounds, setRounds] = useState(1);
  const { plan: committedPlan, setPlan, readPlan, reconcilePlan, planStorageError } = useRoundPlan(active.project.id);
  const plan = reportPresentation ? reportPresentation.plan : committedPlan;
  const onReportBusyChange = (busy: boolean) => setReportPresentation(previous => busy
    ? previous ?? { active, state, plan, hasActiveProject } : null);
  const automaticContinuation = useAutomaticContinuation({ service, preferences, readPlan, writePlan: setPlan, refresh });
  useEffect(() => {
    // A host switch selects a different persisted plan without necessarily
    // emitting a plan-save event. Recheck its authorization and deadline.
    void automaticContinuation.reconcile();
  }, [active.project.id, automaticContinuation.reconcile]);
  // Keep the expired break facts long enough to hand the return reminder to
  // the ready face. Reconciliation may replace break with ready in one render,
  // so this is presentation state, never another timer source.
  const breakReminderPlanRef = useRef<RoundPlan | null>(null);
  const manuallyExitedBreakRef = useRef<string | null>(null);
  const currentBreakIdentity = breakPlanIdentity(plan);
  if (currentBreakIdentity !== null && breakPlanIdentity(breakReminderPlanRef.current) !== currentBreakIdentity) {
    breakReminderPlanRef.current = { ...plan! };
    manuallyExitedBreakRef.current = null;
  }
  const [ending, setEnding] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const sheetPlanRef=useRef<RoundPlan|null>(null);
  // V21 marathon scheduling draft: the user picks only an end time; rounds and
  // breaks are derived from the remaining duration with the normal per-round
  // settings, and progress is reported once after the last round.
  const [planMode, setPlanMode] = useState<'rounds' | 'marathon'>('rounds');
  const [endAtDraft, setEndAtDraft] = useState('18:00');
  const [planDraft, setPlanDraft] = useState<FocusPlanDraft>({ rounds: 1, mode: 'rounds', endAt: '18:00', selectedId: selected });
  const focusPanelRef = useRef<HTMLElement>(null);
  const [worldReady, setWorldReady] = useState(false);
  const [immersiveBand, setImmersiveBand] = useState({ bottom: 0, right: 0 });
  const [pickedCell, setPickedCell] = useState<{ x: number; y: number; z: number } | null>(null);
  const [integrityNotice, setIntegrityNotice] = useState<{ sessionId: string; count: number; max: number; sequence: number } | null>(null);
  // V20 FX-04 exit: conditional controls stay mounted for a ~180 ms fade-down
  // after their close/hide action so enter and exit read as one symmetric move.
  const [integrityLeaving, setIntegrityLeaving] = useState(false);
  const [endingLeaving, setEndingLeaving] = useState(false);
  const [planLeaving, setPlanLeaving] = useState(false);
  const exitTimersRef = useRef<number[]>([]);
  const exitAfter = (ms: number, done: () => void): void => {
    const timer = window.setTimeout(done, ms);
    exitTimersRef.current.push(timer);
  };
  const integrityNoticeSequenceRef = useRef(0);
  const integrityNoticeTimerRef = useRef<number | null>(null);
  const integrityNoticeExitTimerRef = useRef<number | null>(null);
  const [constructionFeedback, setConstructionFeedback] = useState(0);
  const reconciling = useRef(false);

  const showIntegrityNotice = useCallback((sessionId: string, count: number, max: number) => {
    if (integrityNoticeTimerRef.current !== null) window.clearTimeout(integrityNoticeTimerRef.current);
    if (integrityNoticeExitTimerRef.current !== null) window.clearTimeout(integrityNoticeExitTimerRef.current);
    const sequence = ++integrityNoticeSequenceRef.current;
    setIntegrityLeaving(false);
    setIntegrityNotice({ sessionId, count, max, sequence });
    integrityNoticeTimerRef.current = window.setTimeout(() => {
      setIntegrityLeaving(true);
      integrityNoticeExitTimerRef.current = window.setTimeout(() => {
        setIntegrityNotice((current) => current?.sequence === sequence ? null : current);
        setIntegrityLeaving(false);
      }, 180);
    }, 5_000);
  }, []);

  const reconcile = useCallback(async () => {
    if (reconciling.current) return;
    const current = service.snapshot().activeFocusSession;
    if (!current || Date.parse(current.endsAt) > Date.now()) return;
    reconciling.current = true;
    try {
      await onReconcileFocus();
      await automaticContinuation.onResume();
    } finally { reconciling.current = false; }
  }, [service, onReconcileFocus, automaticContinuation.onResume]);
  const flow = useFocusFlow({
    snapshot: () => service.snapshot(), dispatch: run, refresh, resume: reconcile,
    readPlan, writePlan: setPlan, preferences: () => preferences, nowMs: Date.now,
    draft: () => ({ rounds, mode: planMode, endAt: endAtDraft, selectedId: selected }),
    planDraft: () => planDraft,
    commitDraft: draft => { setRounds(draft.rounds); setPlanMode(draft.mode); setEndAtDraft(draft.endAt); setSelected(draft.selectedId); },
    closeEnding: () => closeEnding(), closePlan: () => closePlan(),
    resetDraftMode: () => setPlanMode('rounds'), constructionFeedback: () => fireConstructionFeedback(),
  });
  const { startFocus, interruptFocus, completeEarly, cancelPlan, confirmPlan, finishBreak } = flow;
  const [starting, setStarting] = useState(false);
  const startWithFeedback = useCallback(async () => {
    if (flow.busy) return;
    setStarting(true);
    try { await startFocus(); }
    catch { /* The command runner keeps the current plan and reports the error. */ }
    finally { setStarting(false); }
  }, [flow, startFocus]);

  useEffect(() => {
    setSelected(active.project.kind === 'habit' ? null : active.project.subtasks.find((subtask) => subtask.progressBasisPoints < 10000)?.id ?? active.project.subtasks[0]!.id);
    setPlanOpen(false);
    setPlanMode('rounds');
  }, [active.project.id]);
  // The "materials delivered" beat fires when the user commits progress (which
  // is also when the construction blocks land), not when a session merely ends.
  const fireConstructionFeedback = useCallback(() => {
    setConstructionFeedback((value) => value + 1);
  }, []);
  // Start its lifetime only after the submitted world has had a chance to
  // paint. A large projection can otherwise consume the entire 1.8 s while
  // React is still committing, leaving no visible acknowledgement.
  useEffect(() => {
    if (constructionFeedback === 0) return;
    let secondFrame = 0;
    let timeout = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        timeout = window.setTimeout(() => setConstructionFeedback(0), 1800);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
      if (timeout) window.clearTimeout(timeout);
    };
  }, [constructionFeedback]);

  const pending = active.unreportedCompletedSessions;
  const habitAwaiting = isHabit && habit?.awaitingNextBuilding === true;
  const focusView = deriveFocusViewState({ state, plan, nowMs: Date.now(), breakMinutes: preferences.breakMinutes,
    minimalWanted, fullDeferredPresentation, hasPendingReport: pending.length > 0 });
  const { session, integrityFailure, plan: reconciledPlan, isBreak, minimal, minimalBreak, isImmersiveLayout,
    minimalIdle, planHostProject, planHostIsHabit, marathonPlan, marathonReportPhase, activePendingBlocksWorkbench,
    activeHabitAwaitingBlocksWorkbench } = focusView;
  const [panelWeather, setPanelWeather] = useState<WeatherState | null>(null);
  const effectiveWeatherOverride = worldDebug?.weather ?? worldWeather.override;
  const localWeather = weatherForLocalDate(localDateForDate(new Date()), state.worldSettings.environmentStyle === 'ocean-island');
  useEffect(() => {
    if (!visible || !minimalIdle) { setPanelWeather(null); return; }
    let activeEffect = true;
    const refresh = () => {
      void loadVoxelModule().then(({ localDateForDate, weatherForExternalOverride, weatherForLocalDate }) => {
        if (!activeEffect) return;
        const localDate = localDateForDate(new Date(worldDebug?.date ?? Date.now()));
        setPanelWeather(effectiveWeatherOverride
          ? weatherForExternalOverride(localDate, effectiveWeatherOverride)
          : weatherForLocalDate(localDate, state.worldSettings.environmentStyle === 'ocean-island'));
      }).catch(error => { if (activeEffect) console.warn('Minimal panel weather unavailable', error); });
    };
    refresh();
    const interval = window.setInterval(refresh, 60_000);
    return () => { activeEffect = false; window.clearInterval(interval); };
  }, [visible, minimalIdle, effectiveWeatherOverride, worldDebug?.date, state.worldSettings.environmentStyle]);
  // A ready or break plan is already on the shared immersive face. Keep the
  // editable workbench heading/context for true idle only; otherwise a locked
  // marathon would render its host task and the old plan summary above the
  // generic round slots.
  const showIdleWorkbench = !session && !minimal && !isImmersiveLayout;
  const minimalRest = !session && isImmersiveLayout && (isBreak || reconciledPlan?.status === 'ready');
  const { controlsVisible, controlsLeaving, hintVisible, idleExitRevealed, breakControlsRevealed, handlePanelTap, hideControls } = useImmersiveControls(session?.id ?? null, minimalIdle, minimalRest);
  const [continueError, setContinueError] = useState<string | null>(null);
  const [continuing, setContinuing] = useState(false);
  const clearBreakReminder = useCallback(() => {
    const identity = breakPlanIdentity(plan) ?? breakPlanIdentity(breakReminderPlanRef.current);
    if (identity !== null) manuallyExitedBreakRef.current = identity;
    breakReminderPlanRef.current = null;
    void service.cancelBreakCompletion().catch(error => console.warn('Break reminder cleanup failed', error));
  }, [plan, service]);
  const continueFromBreak = async () => {
    clearBreakReminder();
    setContinueError(null); setContinuing(true);
    try { await flow.continueFromBreak(); }
    catch (error) { setContinueError(error instanceof Error ? error.message : '无法继续专注，请重试。'); }
    finally { setContinuing(false); }
  };
  const startNextFocus = useCallback(() => {
    clearBreakReminder();
    void startWithFeedback();
  }, [clearBreakReminder, startWithFeedback]);
  const cancelPlanWithReminder = useCallback(async (reason: FocusInterruptionCategory | null, note: string) => {
    const cancelled = await cancelPlan(reason, note);
    if (cancelled) clearBreakReminder();
    return cancelled;
  }, [cancelPlan, clearBreakReminder]);
  const minimalFlow = useMinimalFocus({service,preferences,idleVisible:visible && minimalIdle,
    readPlan: () => reconcileRoundPlan(readPlan(), service.snapshot(), service.snapshot().activeProjectId ?? active.project.id, Date.now(), preferences.breakMinutes * 60_000, preferences.breakMinutes * 60_000),
    writePlan:setPlan,dispatch:run});
  useLayoutEffect(() => {
    onMinimalPresentationChange(minimal);
    return () => onMinimalPresentationChange(false);
  }, [minimal, onMinimalPresentationChange]);
  useLayoutEffect(() => {
    // Break/ready now use the same immersive surface as an active focus. Only
    // publish it while this route is visible; a hidden resident world must not
    // hide the navigation belonging to another tab.
    onImmersiveLayoutChange(visible && isImmersiveLayout);
    return () => onImmersiveLayoutChange(false);
  }, [isImmersiveLayout, onImmersiveLayoutChange, visible]);
  const skipBreak = useCallback(() => {
    clearBreakReminder();
    try { localStorage.removeItem(SKIP_BREAK_REQUEST_KEY); } catch {}
    flow.skipBreak();
  }, [clearBreakReminder, flow]);
  useEffect(() => {
    const onNativeSkipBreak = () => skipBreak();
    window.addEventListener('blockcolc-skip-break', onNativeSkipBreak);
    try {
      if (localStorage.getItem(SKIP_BREAK_REQUEST_KEY) === '1') skipBreak();
    } catch {}
    return () => window.removeEventListener('blockcolc-skip-break', onNativeSkipBreak);
  }, [skipBreak, reconciledPlan?.status, reconciledPlan?.breakEndsAt]);
  // V21: in immersive focus the world fills the screen but a frosted band covers
  // part of it (bottom on portrait, right-hand column on landscape). Measure that
  // band so the renderer can center the world on the visible window instead of
  // the full-screen center.
  useEffect(() => {
    if (!isImmersiveLayout || !visible) {
      setImmersiveBand({ bottom: 0, right: 0 });
      return;
    }
    const override = immersiveBandTestOverride();
    if (override !== undefined) {
      setImmersiveBand(override);
      return;
    }
    const panel = focusPanelRef.current;
    if (!panel) return;
    const measure = () => {
      const rect = panel.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const bottomBand = rect.width >= vw * 0.6;
      setImmersiveBand(bottomBand
        ? { bottom: Math.min(0.62, rect.height / vh), right: 0 }
        : { bottom: 0, right: Math.min(0.62, rect.width / vw) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [isImmersiveLayout, visible]);

  // Preserve the original V19 world-overlay notice. Session start owns the
  // initial 0/N presentation; subsequent counts come from the authoritative
  // lifecycle result instead of being inferred from a render-time snapshot.
  useEffect(() => {
    if (!session || !state.focusIntegrityPolicy.enabled) {
      if (integrityNoticeTimerRef.current !== null) window.clearTimeout(integrityNoticeTimerRef.current);
      if (integrityNoticeExitTimerRef.current !== null) window.clearTimeout(integrityNoticeExitTimerRef.current);
      integrityNoticeTimerRef.current = null;
      integrityNoticeExitTimerRef.current = null;
      setIntegrityLeaving(false);
      setIntegrityNotice(null);
      return;
    }
    showIntegrityNotice(session.id, session.integrity.effectiveExcursions, state.focusIntegrityPolicy.maxEffectiveExcursions);
  }, [session?.id, state.focusIntegrityPolicy.enabled, state.focusIntegrityPolicy.maxEffectiveExcursions, showIntegrityNotice]);
  useEffect(() => {
    if (!recordedIntegrityNotice) return;
    showIntegrityNotice(recordedIntegrityNotice.sessionId, recordedIntegrityNotice.count, recordedIntegrityNotice.max);
  }, [recordedIntegrityNotice, showIntegrityNotice]);
  // V22 follow-up: the app-switch-limit notice plays the same bounded entrance
  // and fade-out as the other transient controls instead of lingering forever.
  const [integrityEndedLeaving, setIntegrityEndedLeaving] = useState(false);
  const [integrityEndedHidden, setIntegrityEndedHidden] = useState(false);
  useEffect(() => {
    if (!integrityFailure) {
      setIntegrityEndedLeaving(false);
      setIntegrityEndedHidden(false);
      return;
    }
    setIntegrityEndedLeaving(false);
    setIntegrityEndedHidden(false);
    const timer = window.setTimeout(() => {
      setIntegrityEndedLeaving(true);
      exitAfter(180, () => { setIntegrityEndedHidden(true); setIntegrityEndedLeaving(false); });
    }, 5_000);
    return () => window.clearTimeout(timer);
  }, [integrityFailure]);
  useEffect(() => {
    if (reportPresentation) return; // Never write a held display plan back to storage.
    if (plan?.mode === 'marathon' && reconciledPlan === null) setPlanMode('rounds');
    reconcilePlan(reconciledPlan);
  }, [plan, reconciledPlan, reconcilePlan, reportPresentation]);
  const selectedId = reconciledPlan?.subtaskId ?? selected;
  const subtask = active.project.subtasks.find((item) => item.id === selectedId) ?? active.project.subtasks[0]!;
  const today = localDateOf(new Date(), state.calendar.timeZone);
  const dailyGoal = dailyGoalForDate(state, today);
  const completedToday = completedPomodorosOn(state, today);
  const dailySummary = dailyGoal.enabled ? `今日 ${completedToday} / ${dailyGoal.targetPomodoros} 轮` : `今日已完成 ${completedToday} 轮`;

  const naturalReadyReminderPlan = !session
    && reconciledPlan?.status === 'ready'
    && manuallyExitedBreakRef.current === null
    && breakReminderPlanRef.current !== null
    && Date.parse(breakReminderPlanRef.current.breakEndsAt ?? '') <= Date.now()
    ? breakReminderPlanRef.current
    : null;
  const breakPlanForNotification = reconciledPlan?.status === 'break'
    && manuallyExitedBreakRef.current !== breakPlanIdentity(reconciledPlan)
    ? reconciledPlan
    : naturalReadyReminderPlan;
  const dueReturnReminder = naturalReadyReminderPlan !== null && breakPlanForNotification === naturalReadyReminderPlan;

  useEffect(() => {
    const hostPlan = breakPlanForNotification;
    const hostProject = hostPlan
      ? state.projects.find((project) => project.id === hostPlan.projectId) ?? active.project
      : active.project;
    const nextTaskTitle = hostPlan?.endAfterBreak
      ? '休息后返回工作台'
      : hostPlan?.deferredSettlement === true
        ? '下一轮专注 · 全部完成后统一汇报'
      : hostProject.kind === 'habit'
        ? hostProject.title
        : hostProject.subtasks.find((item) => item.id === hostPlan?.subtaskId)?.title
          ?? hostProject.subtasks.find((item) => item.progressBasisPoints < 10000)?.title
          ?? hostProject.title;
    const returnToFocus = preferences.returnToFocusReminders === true
      && (minimal || hostPlan?.mode === 'marathon')
      && !!hostPlan
      && hostPlan.completedRounds < hostPlan.totalRounds;
    const operation = hostPlan?.status === 'break' && hostPlan.breakEndsAt
      && (!dueReturnReminder || returnToFocus)
      ? service.scheduleBreakCompletion({
          endsAt: hostPlan.breakEndsAt,
          completedRounds: hostPlan.completedRounds,
          totalRounds: hostPlan.totalRounds,
          nextTaskTitle,
          // Natural expiry keeps the same return reminder alive after the
          // round-plan projection changes from break to ready.
          returnToFocus,
          ...(dueReturnReminder ? { deadlineReached: true } : {}),
        })
      : service.cancelBreakCompletion();
    void operation.then((warnings) => {
      for (const warning of warnings) console.warn(warning.message, warning.cause);
    });
  }, [service, state.projects, active.project, minimal, breakPlanForNotification, dueReturnReminder, preferences.returnToFocusReminders, reconciledPlan?.projectId, reconciledPlan?.subtaskId, reconciledPlan?.status, reconciledPlan?.breakEndsAt, reconciledPlan?.completedRounds, reconciledPlan?.totalRounds, reconciledPlan?.endAfterBreak, plan?.status, plan?.breakEndsAt]);

  useEffect(() => {
    if (habitAwaiting && plan !== null && plan.deferredSettlement !== true) setPlan(null);
  }, [habitAwaiting, plan, setPlan]);

  // FX-04 exit: close actions play the symmetric fade-down before unmounting.
  const closeEnding = useCallback(() => {
    setEndingLeaving(true);
    exitAfter(180, () => { setEnding(false); setEndingLeaving(false); });
  }, []);
  const closePlan = useCallback(() => {
    setPlanLeaving(true);
    exitAfter(180, () => { setPlanOpen(false); setPlanLeaving(false); });
  }, []);
  const openPlan = () => {
    // Hold the sheet's face through its exit. A confirmed draft must not flash
    // the newly locked cancellation form before the old sheet has left.
    sheetPlanRef.current=reconciledPlan;
    const end = reconciledPlan?.endAt ? new Date(reconciledPlan.endAt) : null;
    setPlanDraft({ rounds: reconciledPlan?.totalRounds ?? rounds, mode: reconciledPlan?.mode ?? planMode,
      endAt: end ? `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}` : endAtDraft,
      selectedId: reconciledPlan?.subtaskId ?? selected });
    setPlanOpen(true);
  };
  // V22: cancel is the only exit from a locked end-time plan, and it settles
  // immediately: the current round (if any) is interrupted and every finished
  // round enters the cross-project settlement report.
  // V22: confirming a marathon draft locks the schedule right away (the sheet
  // button becomes the red “cancel plan”), without starting the first round.
  useEffect(() => () => {
    for (const timer of exitTimersRef.current) window.clearTimeout(timer);
    if (integrityNoticeTimerRef.current !== null) window.clearTimeout(integrityNoticeTimerRef.current);
    if (integrityNoticeExitTimerRef.current !== null) window.clearTimeout(integrityNoticeExitTimerRef.current);
  }, []);
  const afterReport = (sessionId: string) => flow.afterReport(reconciledPlan, sessionId);
  const [marathonNow, setMarathonNow] = useState(Date.now());
  const isMarathonContext = marathonPlan || planMode === 'marathon';
  const settlementPresentation=minimalWanted || Boolean(isMarathonContext);
  const wasSettlementPresentation=useRef(settlementPresentation);
  useEffect(()=>{
    // Entering a plan/minimal view starts from the settlement, not the ordinary
    // cold-start building focus. Later intentional building taps still work.
    if(settlementPresentation && !wasSettlementPresentation.current)onClearWorldFocus();
    wasSettlementPresentation.current=settlementPresentation;
  },[settlementPresentation,onClearWorldFocus]);
  const focusMinutes = isMarathonContext
    ? preferences.focusMinutes
    : planHostIsHabit ? preferences.habitFocusMinutes : preferences.focusMinutes;
  useEffect(() => {
    if (!marathonPlan) return;
    const timer = window.setInterval(() => setMarathonNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [marathonPlan]);
  const marathonDraftEndMs = planMode === 'marathon' && !reconciledPlan ? marathonEndInstant(endAtDraft) : null;
  const marathonDraftSchedule = marathonDraftEndMs === null
    ? null
    : planRoundsForDuration(marathonDraftEndMs - Date.now(), focusMinutes, preferences.breakMinutes);
  const plannedRounds = reconciledPlan?.totalRounds ?? rounds;
  const fullPlanDurationMs = plannedDurationMs(focusMinutes, preferences.breakMinutes, plannedRounds);
  // While idle the clock shows the per-round length for the classic schedule,
  // but for a marathon it keeps counting the total time still left until the
  // chosen end instant.
  const marathonEndsAt = isMarathonContext
    ? (reconciledPlan?.endAt ?? (marathonDraftEndMs !== null ? new Date(marathonDraftEndMs).toISOString() : undefined))
    : undefined;
  const timerMode = isBreak ? 'break' : session ? 'focus' : isMarathonContext ? 'marathon' : reconciledPlan?.status === 'ready' ? 'ready' : 'plan';
  const timerEndsAt = focusView.endsAt ?? (timerMode === 'marathon' ? marathonEndsAt : undefined);
  const timerFallbackMs = focusMinutes * 60_000;
  // While a plan waits for the next round (including the break that just
  // finished), show all remaining focus plus the following inter-round breaks.
  // This is deliberately not the selected end-time countdown and is shared by
  // ordinary, habit, marathon and minimal plans.
  const remainingTotalMs = reconciledPlan
    ? remainingPlanDurationMs(reconciledPlan, focusMinutes, preferences.breakMinutes)
    : undefined;
  const marathonRemainingTotalMs = marathonPlan ? remainingTotalMs : undefined;
  const marathonSummary = marathonPlan && reconciledPlan?.endAt
    ? `结束 ${formatClockTime(reconciledPlan.endAt)} · 剩余 ${formatClockDuration(Math.max(0, Date.parse(reconciledPlan.endAt) - marathonNow))} · 约 ${reconciledPlan.totalRounds} 轮`
    : marathonDraftEndMs !== null && marathonDraftSchedule
      ? `${marathonDraftSchedule.rounds} 轮 · 结束 ${formatClockTime(marathonDraftEndMs)}`
      : '按结束时间排程';
  const planSummary = marathonPlan || planMode === 'marathon'
    ? marathonSummary
    : `${plannedRounds} 轮 · 总计 ${formatDurationSummary(fullPlanDurationMs)}`;
  const startLabel = marathonPlan && reconciledPlan?.endAt
    ? `开始到 ${formatClockTime(reconciledPlan.endAt)}`
    : planMode === 'marathon' && !reconciledPlan
      ? (marathonDraftEndMs !== null && marathonDraftSchedule ? `开始到 ${formatClockTime(marathonDraftEndMs)}` : '选择结束时间')
      : `开始 ${plannedRounds} 轮`;
  const startDisabled = planMode === 'marathon' && !reconciledPlan && !(marathonDraftEndMs !== null && marathonDraftSchedule);
  const canReenterMinimal = preferences.minimalMode === true && !minimalWanted
    && (session?.deferredSettlement === true || reconciledPlan?.deferredSettlement === true);
  const reenterMinimalButton = canReenterMinimal
    ? <button type="button" className="task-switch-action minimal-entry" aria-label="进入极简模式" onClick={onEnterMinimal}><Minimize2/><span>极简</span></button>
    : null;
  const adjustPlanButton = !minimal && marathonPlan && reconciledPlan !== null && !showIdleWorkbench
    ? <button type="button" className="task-switch-action immersive-plan-action" aria-label="调整本次计划" aria-expanded={planOpen} onClick={openPlan}><ListTodo/><span>调整</span></button>
    : null;
  // A locked end-time plan is its own lane. Facts from whichever project is
  // currently selected must not cover or replace that lane.

  const currentBuildingLabel = state.buildingBlueprintResources.find(resource => resource.id === active.project.blueprintId)?.displayName
    ?? active.project.importedBlueprint?.title
    ?? blueprintName(blueprintCatalog, active.project.blueprintId);

  // Android back inside the world screen dismisses its own overlays first:
  // revealed end controls, then the end-focus dialog, then the plan sheet.
  useBackLayer(Boolean(session && (controlsVisible || controlsLeaving)), () => { hideControls(); return true; });
  useBackLayer(Boolean(ending), () => { closeEnding(); return true; });
  useBackLayer(Boolean(planOpen), () => { closePlan(); return true; });

  const memoryProjection = visible && !isImmersiveLayout && memoryProjectId
    ? service.worldProjection().projects.find(project => project.project.id === memoryProjectId)
    : undefined;
  const memory = memoryProjection ? createBuildingMemory(state, memoryProjection,
    state.buildingBlueprintResources.find(resource => resource.id === memoryProjection.building.blueprintId)?.displayName
      ?? memoryProjection.building.importedBlueprint?.title
      ?? blueprintName(blueprintCatalog, memoryProjection.building.blueprintId)) : null;
  const rewardMemory=visible&&!isImmersiveLayout&&memoryProjectId?.startsWith('reward:')
    ?service.worldProjection().projects.flatMap(project=>project.importedDecorations).find(reward=>`reward:${reward.rewardId}`===memoryProjectId):undefined;
  const switchBlockedReason = session ? '结束本轮专注后才能切换任务。'
    : pending.length > 0 ? '先完成当前任务的进度汇报，再切换任务。' : undefined;
  useLayoutEffect(() => {
    if (focusPanelRef.current) focusPanelRef.current.scrollTop = 0;
  }, [memory?.projectId]);
  const sheetPlan=sheetPlanRef.current;
  const sheetLocked=Boolean(sheetPlan),sheetMode=sheetPlan?.mode??planDraft.mode;
  const sheetUnstarted=isUnstartedMarathonPlan(sheetPlan,Boolean(session));

  return <div data-world-ready={worldReady} data-minimal-mode={minimal ? 'true' : 'false'} data-clear-glass={preferences.focusGlassTransparency >= 75 ? 'true' : 'false'} className={isImmersiveLayout ? 'world-screen is-focusing' : marathonReportPhase ? 'world-screen has-report' : activePendingBlocksWorkbench ? 'world-screen has-report' : activeHabitAwaitingBlocksWorkbench ? 'world-screen is-choosing-habit-building' : 'world-screen'}>
    <div className="world-stage">
      <WorldCanvasV7 service={service} stateRevision={stateRevision} resourcePacks={resourcePacks} lightingQuality={preferences.lightingQuality}
        worldColorAdjustment={preferences.worldColorAdjustment}
        constructionOutlineVisibility={preferences.constructionOutlineVisibility} showWorldCoordinates={preferences.showWorldCoordinates}
        environmentStyle={state.worldSettings.environmentStyle} worldSeed={state.worldSettings.worldSeed}
        terrainGenerationVersion={state.worldSettings.terrainGenerationVersion} constructionFeedback={constructionFeedback}
        sessionActive={!!session} immersivePresentation={isImmersiveLayout} immersiveBand={immersiveBand} onReadyChange={setWorldReady}
        onScenePrepared={onScenePrepared} onScenePreparationFailed={onScenePreparationFailed}
        glassClarity={preferences.focusGlassTransparency}
        externalWeatherOverride={worldWeather.override} astronomyContext={worldWeather.astronomyContext ?? null} worldDebug={worldDebug}
        initialEnvironmentPending={initialEnvironmentPending(preferences.realWeatherEnabled, worldWeather)}
        openingProjectId={minimalWanted || marathonPlan || planMode === 'marathon' ? null : active.project.id}
        focusedProjectId={focusedProjectId} onSelectProject={onFocusWorldProject} onInitialProjectFocus={onInitialProjectFocus}
        onClearWorldFocus={onClearWorldFocus}
        visible={visible} onPickTerrain={setPickedCell} pickedCell={pickedCell}/>
      <WorldWeatherAttribution view={worldWeather} localConditionText={localWeatherConditionLabel(localWeather.kind)}/>
      {rewardMemory&&<aside className="reward-memory-plate" aria-label="每日奖励记忆"><PixelChest/><div><strong>{rewardMemory.blueprint.title}</strong><p>{rewardMemory.date.replaceAll('-','.')} 获得的建造奖励</p></div><button type="button" aria-label="关闭奖励记忆" onClick={onCloseWorldMemory}><PixelClose/></button></aside>}
    </div>
    {visible && <section ref={focusPanelRef} className={`focus-panel focus-workbench-panel${memory ? ' is-memory' : ''}`} onPointerUp={(event) => { if (!memory) handlePanelTap({ target: event.target, clientX: event.clientX, clientY: event.clientY }); }}>
      {!hasActiveProject && !memory && !marathonReportPhase ? <WorkspaceRest state={state} run={run} onCreate={onCreateProject}/> : memory ? <BuildingMemoryPanel key={memory.projectId} memory={memory} switchBlockedReason={memory.isActive ? undefined : switchBlockedReason}
        onClose={onCloseWorldMemory} onContinue={async () => {
          if (memory.projectId !== state.activeProjectId) {
            const result = await run({ type: 'SwitchActiveProject', projectId: memory.projectId });
            if (!result.ok) return;
          }
          onCloseWorldMemory();
        }}/> : <>
      <MinimalPanelWeatherOverlay active={minimalIdle} weather={panelWeather ? { kind: panelWeather.kind,
        precipitationIntensity: panelWeather.precipitationIntensity, visualPrecipitationIntensity: panelWeather.visualPrecipitationIntensity, seed: panelWeather.seed,
        thunderstorm: panelWeather.thunderstorm } : null}/>
      {showIdleWorkbench && <div className="workbench-heading">
        <h1>{marathonPlan ? '按结束时间排程' : active.project.title}</h1>
        <div className="workbench-heading-actions">
          {preferences.minimalMode === true && !minimalWanted && (!marathonPlan || reconciledPlan?.deferredSettlement === true) && <button className="task-switch-action minimal-entry" type="button" aria-label="进入极简模式" onClick={onEnterMinimal}><Minimize2/><span>极简</span></button>}
        </div>
      </div>}
       {showIdleWorkbench && !isBreak && !activePendingBlocksWorkbench && !activeHabitAwaitingBlocksWorkbench && !marathonReportPhase && <>
         {marathonPlan
           ? <div className="workbench-context"><span>本场安排</span><strong>按结束时间排程</strong><small>{planHostIsHabit ? `习惯轮次直接推进建筑 · 已完成 ${reconciledPlan?.completedRounds ?? 0} / ${reconciledPlan?.totalRounds ?? 1} 轮` : '本场不指定小任务，结束后统一汇报'}</small><HolidayEmblem date={today} slot={0}/></div>
           : isHabit
             ? <div className="workbench-context"><span>当前习惯建筑 · 第 {habit!.cycleNumber} 座</span><strong>{currentBuildingLabel}</strong><small>本周期 {habit!.completedFocusSessionIds.length} / {habit!.targetRounds} 轮 · {dailySummary}</small><HolidayEmblem date={today} slot={0}/></div>
             : <div className="workbench-context"><span>当前小任务</span><strong>{subtask!.title}</strong><small>已完成 {Math.round(subtask!.progressBasisPoints / 100)}% · {dailySummary}</small><HolidayEmblem date={today} slot={0}/></div>}
         <button type="button" className="plan-summary" aria-label="调整本次计划" aria-expanded={planOpen} onClick={openPlan}><span>{planSummary}</span><span>调整</span></button>
       </>}
         {minimalIdle && <div className="holiday-panel-slot"><HolidayEmblem date={today} slot={0}/></div>}
         {minimalRest ? <FocusFace
           context={<>{isBreak && <div className="focus-task-context"><strong>休息中</strong></div>}{!isBreak && <div className="focus-task-context"><strong>准备第 {(reconciledPlan?.completedRounds ?? 0) + 1} / {reconciledPlan?.totalRounds ?? 1} 轮</strong></div>}{integrityFailure && !integrityEndedHidden && <div className={`focus-integrity-ended${integrityEndedLeaving ? ' is-leaving' : ''}`} role="alert"><AlertTriangle/>本轮专注因达到离开应用次数上限而结束。下次可以从这里继续。</div>}</>}
           timer={<MinimalBreakClock phase={isBreak ? 'break' : 'ready'} busy={continuing} onContinue={() => void continueFromBreak()}><FocusTimer mode={isBreak ? 'break' : 'ready'} endsAt={isBreak ? timerEndsAt : undefined} fallbackMs={isBreak ? 0 : remainingTotalMs ?? 0} onElapsed={finishBreak}/></MinimalBreakClock>}
           controls={marathonPlan ? <button type="button" className={`task-switch-action minimal-rest-adjust${breakControlsRevealed ? '' : ' is-veiled'}`} aria-label="调整本次计划" onClick={openPlan}><ListTodo/><span>调整计划</span></button> : null}/>
         : minimalIdle ? <MinimalIdleCarousel state={state} date={today}
          clock={<MinimalClockGesture clockText={minimalFlow.clockText} busy={minimalFlow.busy} focusMinutes={preferences.focusMinutes} breakMinutes={preferences.breakMinutes} onConfirm={endMs => void minimalFlow.startAt(endMs)}/>}
          exit={<button type="button" className={`minimal-exit${idleExitRevealed ? '' : ' is-veiled'}`} disabled={minimalFlow.busy} onClick={onExitMinimal}>返回完整模式</button>}/>
        : activeHabitAwaitingBlocksWorkbench ? <HabitBuildingSelection state={state} active={active} resourcePacks={resourcePacks} run={run} targetRounds={preferences.habitTargetRounds}/>
        : marathonReportPhase ? <MarathonProgressReport variant="minimal" state={state} hostProjectId={reconciledPlan!.projectId} run={run} cancellationReason={reconciledPlan?.cancellationReason} cancellationNote={reconciledPlan?.cancellationNote} onSubmitted={flow.afterMarathonReport} onBusyChange={onReportBusyChange}/>
         : !session && pending.length > 0 && !marathonPlan ? <ProgressReportV7 variant="immersive" active={active} run={run} cancellationReason={reconciledPlan?.cancellationReason} cancellationNote={reconciledPlan?.cancellationNote} onSubmitted={afterReport} onBusyChange={onReportBusyChange}/> : <>
         {(session && state.focusIntegrityPolicy.enabled && integrityNotice?.sessionId === session.id) && <div className={`${integrityNotice.count > 0 ? 'focus-integrity-warning flash active' : 'focus-integrity-warning flash'}${integrityLeaving ? ' is-leaving' : ''}`} role="status"><AlertTriangle/>有效离开 {integrityNotice.count} / {integrityNotice.max} 次</div>}
         {integrityFailure && !integrityEndedHidden && <div className={`focus-integrity-ended${integrityEndedLeaving ? ' is-leaving' : ''}`} role="alert"><AlertTriangle/>本轮专注因达到离开应用次数上限而结束。下次可以从这里继续。</div>}
        {/* 用户指示：极简中因中断（达到离开次数上限）结束本轮后，提供退出极简模式
         * 的入口，让用户回到完整模式管理这次中断。 */}
        {integrityFailure && !integrityEndedHidden && minimal && <button type="button" className="minimal-exit" onClick={onExitMinimal}>退出极简模式</button>}
         <FocusFace enabled={isImmersiveLayout}
           context={session ? <div className="focus-task-context"><strong>{(session.deferredSettlement === true || marathonPlan) ? `专注中 第${(reconciledPlan?.completedRounds ?? 0) + 1}/${reconciledPlan?.totalRounds ?? 1}轮` : isHabit ? active.project.title : subtask!.title}</strong>{reenterMinimalButton}</div>
             : isBreak ? <div className="focus-task-context"><strong>休息中</strong></div>
             : reconciledPlan?.status === 'ready' ? <div className="focus-task-context"><strong>准备第 {reconciledPlan.completedRounds + 1} / {reconciledPlan.totalRounds} 轮</strong></div>
             : undefined}
           timer={<FocusTimer mode={timerMode} endsAt={timerEndsAt} fallbackMs={reconciledPlan?.status === 'ready' ? remainingTotalMs ?? timerFallbackMs : timerFallbackMs} marathonRemainingMs={marathonRemainingTotalMs} onElapsed={session ? reconcile : finishBreak}/>}
          controls={isBreak ? <div className="immersive-round-controls"><button className="primary secondary-action" onClick={skipBreak}>跳过休息</button>{adjustPlanButton}{reenterMinimalButton}</div>
          : reconciledPlan?.status === 'ready' ? <div className="immersive-round-controls"><button className="primary" disabled={starting} aria-busy={starting} onClick={startNextFocus}><Clock3/>{starting ? '正在开始…' : marathonPlan && reconciledPlan.completedRounds === 0 ? startLabel : '开始下一轮'}</button>{adjustPlanButton}{reenterMinimalButton}</div>
            : session ? <div className={`immersive-controls${controlsLeaving ? ' is-leaving' : ''}`}>{(controlsVisible || controlsLeaving)
              ? <button className="destructive primary" onClick={() => void setEnding(true)}><Square/>结束本次专注</button>
              : <p className={hintVisible ? 'immersive-hint' : 'immersive-hint is-faded'} role="status">双击下方空白处唤出结束按钮</p>}</div>
            : <button className="primary" disabled={startDisabled || starting} aria-busy={starting} onClick={() => void startWithFeedback()}><PixelPlay/>{starting ? '正在开始…' : startLabel}</button>}/>
      </>}
      {/* 用户指示：极简专注运行中直接复用各模式共用的沉浸 UI，不再提供
       * "返回完整模式"按钮，专注期间的临时退出页面整体移除。 */}
      {minimalFlow.warning && <p role="status" className="plan-sheet-note">{minimalFlow.warning}</p>}
      {minimalIdle && minimalFlow.error && <p role="alert" className="minimal-clock-error">{minimalFlow.error}</p>}
      {minimalRest && continueError && <p role="alert" className="minimal-clock-error">{continueError}</p>}
      {planStorageError && <p role="alert" className="plan-sheet-note is-invalid">{planStorageError}</p>}
      </>}
    </section>}
    {ending && session && (
      <div className={endingLeaving ? 'dialog-leave' : undefined}>
        <EndFocusDialog taskTitle={planHostIsHabit ? planHostProject?.title ?? active.project.title : marathonPlan ? `马拉松 第 ${(reconciledPlan?.completedRounds ?? 0) + 1} / ${reconciledPlan?.totalRounds ?? 1} 轮` : subtask!.title} habit={planHostIsHabit} marathon={reconciledPlan?.mode === 'marathon'} isLastMarathonRound={reconciledPlan?.mode === 'marathon' && (reconciledPlan?.completedRounds ?? 0) + 1 >= (reconciledPlan?.totalRounds ?? 1)} multiRound={(reconciledPlan?.totalRounds ?? 1) > 1} cancellationReason={reconciledPlan?.cancellationReason} cancellationNote={reconciledPlan?.cancellationNote} onCancelPlan={cancelPlanWithReminder} onClose={closeEnding} onInterrupt={interruptFocus} onCompleteEarly={completeEarly}/>
      </div>
    )}
    {(planOpen || planLeaving) && !session && <div className={planLeaving ? 'dialog-leave' : undefined}>{planHostIsHabit
      ? <HabitFocusPlanSheet rounds={planDraft.rounds} focusMinutes={sheetMode === 'marathon' ? preferences.focusMinutes : preferences.habitFocusMinutes} breakMinutes={preferences.breakMinutes} locked={sheetLocked} unstarted={sheetUnstarted} mode={sheetMode} endAtDraft={planDraft.endAt} cancellationReason={sheetPlan?.cancellationReason} cancellationNote={sheetPlan?.cancellationNote} onModeChange={mode => setPlanDraft(draft => ({ ...draft, mode }))} onEndAtDraftChange={endAt => setPlanDraft(draft => ({ ...draft, endAt }))} onRoundsChange={rounds => setPlanDraft(draft => ({ ...draft, rounds }))} onClose={closePlan} onConfirm={confirmPlan} onCancelPlan={cancelPlanWithReminder}/>
      : <FocusPlanSheet subtasks={active.project.subtasks} selectedId={sheetPlan?.subtaskId ?? planDraft.selectedId ?? ''} rounds={planDraft.rounds} focusMinutes={preferences.focusMinutes} breakMinutes={preferences.breakMinutes} locked={sheetLocked} unstarted={sheetUnstarted} mode={sheetMode} endAtDraft={planDraft.endAt} cancellationReason={sheetPlan?.cancellationReason} cancellationNote={sheetPlan?.cancellationNote} onModeChange={mode => setPlanDraft(draft => ({ ...draft, mode }))} onEndAtDraftChange={endAt => setPlanDraft(draft => ({ ...draft, endAt }))} onSelect={selectedId => setPlanDraft(draft => ({ ...draft, selectedId }))} onRoundsChange={rounds => setPlanDraft(draft => ({ ...draft, rounds }))} onClose={closePlan} onConfirm={confirmPlan} onCancelPlan={cancelPlanWithReminder}/>}</div>}
  </div>;
}
