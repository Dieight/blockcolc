import { describe, expect, it } from "vitest";
import { commitRenderedWorldFrame, emptyWorldFrameCommitDiagnostics } from "../src/world-frame-commit";

describe("committed world frame diagnostics", () => {
  const input = {
    current: emptyWorldFrameCommitDiagnostics,
    worldRebuildCount: 1,
    renderedTriangles: 20,
    worldHasGeometry: true,
    committedAtMs: 73.5,
    visible: true,
    disposed: false,
  };

  it("advances only after a visible successful non-empty world render", () => {
    expect(commitRenderedWorldFrame(input)).toEqual({
      renderedWorldRebuildCount: 1,
      lastWorldFrameCommittedAtMs: 73.5,
    });
  });

  it.each([
    { renderedTriangles: 0 },
    { worldHasGeometry: false },
    { visible: false },
    { disposed: true },
    { worldRebuildCount: 0 },
  ])("does not report an empty, hidden, disposed, or stale render as committed (%o)", (override) => {
    expect(commitRenderedWorldFrame({ ...input, ...override })).toBe(emptyWorldFrameCommitDiagnostics);
  });

  it("retains the previous commit across a failed or queued next render", () => {
    const current = { renderedWorldRebuildCount: 1, lastWorldFrameCommittedAtMs: 73.5 };
    expect(commitRenderedWorldFrame({ ...input, current, worldRebuildCount: 2, renderedTriangles: 0 }))
      .toBe(current);
    expect(commitRenderedWorldFrame({ ...input, current, worldRebuildCount: 2, visible: false }))
      .toBe(current);
  });

  it("commits all rebuilds completed before the next successful frame", () => {
    expect(commitRenderedWorldFrame({ ...input, worldRebuildCount: 4 })).toEqual({
      renderedWorldRebuildCount: 4,
      lastWorldFrameCommittedAtMs: 73.5,
    });
  });
});
