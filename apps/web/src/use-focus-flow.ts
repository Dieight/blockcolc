import { useMemo, useRef } from 'react';
import { createFocusFlow, type FocusFlowPorts } from './focus-flow';

/** Stable callbacks read the current committed context when invoked, not an old render. */
export function useFocusFlow(ports: FocusFlowPorts) {
  const latest = useRef(ports);
  latest.current = ports;
  return useMemo(() => createFocusFlow({
    snapshot: () => latest.current.snapshot(), dispatch: (command, options) => latest.current.dispatch(command, options), refresh: () => latest.current.refresh?.(),
    resume: () => latest.current.resume(), readPlan: () => latest.current.readPlan(),
    writePlan: plan => latest.current.writePlan(plan), preferences: () => latest.current.preferences(),
    draft: () => latest.current.draft(), nowMs: () => latest.current.nowMs(),
    closeEnding: () => latest.current.closeEnding(), closePlan: () => latest.current.closePlan(),
    resetDraftMode: () => latest.current.resetDraftMode(), constructionFeedback: () => latest.current.constructionFeedback(),
  }), []);
}
