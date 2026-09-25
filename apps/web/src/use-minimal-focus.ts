import { useMemo, useRef, useState } from 'react';
import type { ApplicationResult, ApplicationService } from '@tomato-clock/application';
import type { FocusPreferences } from './app-types';
import { createMinimalFocusStarter, prepareMinimalFocus, type MinimalFocusDraft } from './minimal-focus';
import type { RoundPlan } from './round-plan';
import { useLocalMinuteClock } from './use-local-minute-clock';

export function useMinimalFocus({service, preferences, idleVisible, readPlan, writePlan, dispatch}: {
  service: ApplicationService;
  preferences: FocusPreferences;
  idleVisible: boolean;
  readPlan: () => RoundPlan | null;
  writePlan: (plan: RoundPlan | null) => void;
  dispatch: Parameters<typeof createMinimalFocusStarter>[0]['dispatch'];
}) {
  const latest = useRef({readPlan, writePlan, dispatch});
  latest.current = {readPlan, writePlan, dispatch};
  const starter = useMemo(() => createMinimalFocusStarter({
    snapshot: () => service.snapshot(),
    readPlan: () => latest.current.readPlan(),
    writePlan: plan => latest.current.writePlan(plan),
    dispatch: command => latest.current.dispatch(command) as Promise<ApplicationResult>,
  }), [service]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [draft, setDraft] = useState<MinimalFocusDraft>({hourDraft:'18',minuteDraft:'00',day:'today'});
  const clockText = useLocalMinuteClock(idleVisible || open);
  const preparation = open ? prepareMinimalFocus(service.snapshot(), readPlan(), draft, preferences) : null;
  const openSheet = () => {
    const now = new Date();
    const end = new Date(now.getTime() + (preferences.focusMinutes + 1) * 60_000);
    setDraft({hourDraft:String(end.getHours()).padStart(2,'0'),minuteDraft:String(end.getMinutes()).padStart(2,'0'),day:end.toDateString()===now.toDateString()?'today':'tomorrow'});
    setError(null); setWarning(null); setOpen(true);
  };
  const close = () => { if (!starter.busy) setOpen(false); };
  const update = (patch: Partial<MinimalFocusDraft>) => {setDraft(value=>({...value,...patch}));setError(null);};
  const submit = async (selection = draft) => {
    if (starter.busy) return;
    setBusy(true); setError(null);
    try {
      const result = await starter.start(selection, preferences);
      if (!result.ok) {setError(result.message); return;}
      setWarning(result.warning ?? null); setOpen(false);
    } finally {setBusy(false);}
  };
  const startAt = (endMs: number) => {
    const end = new Date(endMs);
    return submit({hourDraft:String(end.getHours()),minuteDraft:String(end.getMinutes()),
      day:end.toDateString()===new Date().toDateString()?'today':'tomorrow',endMs});
  };
  return {clockText,open,busy,error,warning,openSheet,close,startAt,
    sheetProps: {...draft,busy,invalidReason:error ?? (preparation && !preparation.ok ? preparation.message : null),
      onHourChange:(hourDraft:string)=>update({hourDraft}),onMinuteChange:(minuteDraft:string)=>update({minuteDraft}),
      onDayChange:(day:MinimalFocusDraft['day'])=>update({day}),onClose:close,onSubmit:()=>void submit()}};
}
