// V20 BX-01: block-by-block construction reveal, factored as pure logic so the
// diff and the pop schedule are unit-testable without a WebGL context.
//
// When a focus round completes, the finished building grows block by block over
// ~3.5 s instead of popping in whole. A reveal only applies to buildings whose
// completion actually advanced between two consecutive world snapshots — never
// the initial load, never environment or resource-pack swaps — and callers gate
// it off under reduced motion and in diagnostic screenshot modes where the world
// must render complete immediately. (The bounded ceremony is intentionally not
// gated on the performance lighting tier; that tier only disables idle ambient
// motion.)

export interface ConstructionRevealPlan {
  /** The completion basis points the building had before this rebuild; blocks with a build order above this are the new increment. */
  previousCompletionBasisPoints: number;
}

interface ConstructionWorldLike {
  projectId: string;
  blueprintId: string;
  buildingCompletionBasisPoints: number;
}

export function constructionRevealPlans(
  previousWorlds: readonly ConstructionWorldLike[],
  nextWorlds: readonly ConstructionWorldLike[],
  allowed: boolean,
): Map<string, ConstructionRevealPlan> {
  const plans = new Map<string, ConstructionRevealPlan>();
  if (!allowed || previousWorlds.length === 0) return plans;
  const previousByProject = new Map(previousWorlds.map((world) => [world.projectId, world]));
  for (const world of nextWorlds) {
    const before = previousByProject.get(world.projectId);
    if (!before) continue;
    // Blueprint swaps are user edits, not focus-built increments: they pop in
    // whole. Only a completion advance on the same blueprint reveals.
    if (world.blueprintId === before.blueprintId && world.buildingCompletionBasisPoints > before.buildingCompletionBasisPoints) {
      plans.set(world.projectId, { previousCompletionBasisPoints: before.buildingCompletionBasisPoints });
    }
  }
  return plans;
}

export interface ConstructionWaveSchedule {
  /** Consecutive blocks that pop together; large increments batch so the total never drags. */
  waveSize: number;
  /** Time between waves, sized so every block remains individually visible at a slow pace. */
  waveIntervalMs: number;
  /** Breathing room between the rebuild and the first pop. */
  leadInMs: number;
  /** Per-block pop animation length. */
  popDurationMs: number;
  popAtMsFor(startedMs: number, orderIndex: number): number;
}

export function constructionWaveSchedule(blockCount: number): ConstructionWaveSchedule {
  const waveSize = Math.max(1, Math.ceil(blockCount / 90));
  const waveCount = Math.ceil(blockCount / waveSize);
  const leadInMs = 240;
  const popDurationMs = 240;
  const waveIntervalMs = blockCount > 0 ? 3_300 / waveCount : 0;
  return {
    waveSize,
    waveIntervalMs,
    leadInMs,
    popDurationMs,
    popAtMsFor(startedMs, orderIndex) {
      return startedMs + leadInMs + Math.floor(orderIndex / waveSize) * waveIntervalMs;
    },
  };
}
