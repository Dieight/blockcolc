export interface WorldFrameCommitDiagnostics {
  renderedWorldRebuildCount: number;
  lastWorldFrameCommittedAtMs: number | null;
}

export const emptyWorldFrameCommitDiagnostics: WorldFrameCommitDiagnostics = Object.freeze({
  renderedWorldRebuildCount: 0,
  lastWorldFrameCommittedAtMs: null,
});

/** Advance only after the current non-empty world has completed a visible render. */
export function commitRenderedWorldFrame(input: {
  current: WorldFrameCommitDiagnostics;
  worldRebuildCount: number;
  renderedTriangles: number;
  worldHasGeometry: boolean;
  committedAtMs: number;
  visible: boolean;
  disposed: boolean;
}): WorldFrameCommitDiagnostics {
  if (input.disposed || !input.visible || !input.worldHasGeometry || input.renderedTriangles <= 0
    || input.worldRebuildCount <= input.current.renderedWorldRebuildCount) return input.current;
  return {
    renderedWorldRebuildCount: input.worldRebuildCount,
    lastWorldFrameCommittedAtMs: input.committedAtMs,
  };
}
