import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { AfterReloadEvidence, BeforeReloadEvidence } from "../src/harness.js";

test("persists and recovers the complete first backend vertical slice", async ({ page }) => {
  await page.goto("/");
  const beforeReload = await page.evaluate(() => window.tomatoClockHarness.runBeforeReload());

  expect(beforeReload.completedAt).toBe(beforeReload.endsAt);
  expect(beforeReload.completedLocalDate).toBe("2026-07-23");
  expect(beforeReload.buildingCompletionBasisPoints).toBe(2500);
  expect(beforeReload.buildingConditionBasisPoints).toBe(10000);
  expect(beforeReload.scheduled).toContainEqual({ sessionId: beforeReload.completedSessionId, endsAt: beforeReload.endsAt });
  expect(beforeReload.cancelled).toContain(beforeReload.completedSessionId);

  await page.reload();
  const afterReload = await page.evaluate(
    (evidence) => window.tomatoClockHarness.runAfterReload(evidence),
    beforeReload,
  );

  expect(afterReload.persistedCompletionBasisPoints).toBe(2500);
  expect(afterReload.persistedConditionBasisPoints).toBe(10000);
  expect(afterReload.completedPomodorosBeforeCancel).toBe(1);
  expect(afterReload.completedPomodorosAfterCancel).toBe(1);
  expect(afterReload.interruptedSessions).toBe(1);
  expect(afterReload.staleWrite).toEqual({
    rejected: true,
    error: "ApplicationPersistenceError",
    cause: "StorageConflictError",
  });
  expect(afterReload.titleAfterConflict).toBe("Domain loop");

  await writeArtifact({
    verifiedAt: new Date().toISOString(),
    browser: "chromium",
    database: "real IndexedDB",
    assertions: {
      emptyInitialization: true,
      absoluteTimerPersistence: true,
      processRecreationRecovery: true,
      completionAtEndsAt: true,
      dailyGoalReached: true,
      notificationCancelled: true,
      progressAndConditionSeparated: true,
      pageReloadPersistence: true,
      cancellationIsInterruption: true,
      cancellationDoesNotCountForGoal: true,
      staleRevisionRejected: true,
    },
    beforeReload,
    afterReload,
  });
});

async function writeArtifact(result: {
  verifiedAt: string;
  browser: string;
  database: string;
  assertions: Record<string, boolean>;
  beforeReload: BeforeReloadEvidence;
  afterReload: AfterReloadEvidence;
}): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const artifacts = resolve(here, "..", "artifacts");
  await mkdir(artifacts, { recursive: true });
  await writeFile(resolve(artifacts, "core-loop-result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
}
