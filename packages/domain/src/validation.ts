import { assertISODate, assertValidTimeZone, localDateOf } from "./calendar.js";
import type {
  ActiveFocusSession,
  DailyGoal,
  DecayPolicy,
  DomainState,
  FocusCalendar,
  FocusSession,
  FocusSessionBase,
  ProgressReport,
  Project,
  ProjectCondition,
  ImportedBlueprintV1,
  BuildingBlueprintResource,
  DecorationBlueprintResource,
  DecorationReward,
  HabitBuildingMonument,
  Subtask,
} from "./model.js";

export class DomainStateValidationError extends Error {
  readonly code = "INVALID_DOMAIN_STATE";
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "DomainStateValidationError";
  }
}

export function parseDomainState(raw: unknown): DomainState {
  const migrated = migrateV5State(migrateV4State(withBuildingBlueprintDefaults(migrateV2State(withDecorationDefaults(migrateV1State(raw))))));
  const root = object(migrated, "$", [
    "schemaVersion", "projects", "habitBuildings", "activeProjectId", "retiredSubtaskIds", "activeFocusSession",
    "focusHistory", "progressReports", "dailyGoals", "calendar", "decayPolicy", "projectConditions", "focusIntegrityPolicy",
    "decorationBlueprintResources", "decorationRewards", "buildingBlueprintResources", "worldSettings",
  ]);
  if (root.schemaVersion !== 6) invalid("$.schemaVersion", "must equal 6");
  const state: DomainState = {
    schemaVersion: 6,
    projects: array(root.projects, "$.projects", parseProject),
    habitBuildings: array(root.habitBuildings, "$.habitBuildings", parseHabitBuilding),
    activeProjectId: nullableString(root.activeProjectId, "$.activeProjectId"),
    retiredSubtaskIds: array(root.retiredSubtaskIds, "$.retiredSubtaskIds", nonBlankString),
    activeFocusSession: root.activeFocusSession === null ? null : parseActiveSession(root.activeFocusSession, "$.activeFocusSession"),
    focusHistory: array(root.focusHistory, "$.focusHistory", parseFocusSession),
    progressReports: array(root.progressReports, "$.progressReports", parseProgressReport),
    dailyGoals: array(root.dailyGoals, "$.dailyGoals", parseDailyGoal),
    calendar: parseCalendar(root.calendar, "$.calendar"),
    decayPolicy: parseDecayPolicy(root.decayPolicy, "$.decayPolicy"),
    projectConditions: array(root.projectConditions, "$.projectConditions", parseProjectCondition),
    focusIntegrityPolicy: parseFocusIntegrityPolicy(root.focusIntegrityPolicy, "$.focusIntegrityPolicy"),
    decorationBlueprintResources: array(root.decorationBlueprintResources, "$.decorationBlueprintResources", parseDecorationResource),
    decorationRewards: array(root.decorationRewards, "$.decorationRewards", parseDecorationReward),
    buildingBlueprintResources: array(root.buildingBlueprintResources, "$.buildingBlueprintResources", parseBuildingResource),
    worldSettings: parseWorldSettings(root.worldSettings, "$.worldSettings"),
  };
  validateReferences(state);
  return state;
}

function parseProject(raw: unknown, path: string): Project {
  const x = object(raw, path, ["id", "title", "kind", "settlementIndex", "blueprintId", "importedBlueprint", "createdAt", "status", "subtaskStructureLocked", "subtasks", "habit"]);
  const kind = enumeration(x.kind, path + ".kind", ["finite", "habit"] as const);
  const status = enumeration(x.status, path + ".status", ["active", "paused", "monument", "deleted"] as const);
  const importedBlueprint = x.importedBlueprint !== null
    ? parseImportedBlueprint(x.importedBlueprint, path + ".importedBlueprint")
    : null;
  const project: Project = {
    id: nonBlankString(x.id, path + ".id"),
    title: nonBlankString(x.title, path + ".title"),
    kind,
    settlementIndex: integer(x.settlementIndex, path + ".settlementIndex", 0),
    blueprintId: nonBlankString(x.blueprintId, path + ".blueprintId"),
    importedBlueprint,
    createdAt: instant(x.createdAt, path + ".createdAt"),
    status,
    subtaskStructureLocked: boolean(x.subtaskStructureLocked, path + ".subtaskStructureLocked"),
    subtasks: array(x.subtasks, path + ".subtasks", parseSubtask),
    habit: x.habit === null ? null : parseHabitState(x.habit, path + ".habit"),
  };
  if (project.importedBlueprint !== null && project.importedBlueprint.id !== project.blueprintId) invalid(path + ".importedBlueprint.id", "must match blueprintId");
  project.subtasks.forEach((item, index) => {
    if (item.order !== index) invalid(`${path}.subtasks[${index}].order`, "must match array order");
  });
  if (kind === "habit") {
    if (project.habit === null) invalid(path + ".habit", "must be present for a habit project");
    if (project.subtasks.length !== 0) invalid(path + ".subtasks", "habit projects must not contain subtasks");
    if (!project.subtaskStructureLocked) invalid(path + ".subtaskStructureLocked", "habit projects keep subtask structure locked");
    if (project.status === "monument") invalid(path + ".status", "habit projects do not become monuments");
    return project;
  }
  if (project.habit !== null) invalid(path + ".habit", "must be null for a finite project");
  if (project.subtasks.length === 0) invalid(path + ".subtasks", "must not be empty");
  const hasPositiveProgress = project.subtasks.some((item) => item.progressBasisPoints > 0);
  if (project.subtaskStructureLocked !== hasPositiveProgress) invalid(path + ".subtaskStructureLocked", "must be true exactly when the project has positive progress");
  const complete = project.subtasks.every((item) => item.progressBasisPoints === 10_000);
  if ((project.status === "monument") !== complete) invalid(path + ".status", "must be monument exactly when every subtask is complete");
  return project;
}

function parseHabitState(raw: unknown, path: string): NonNullable<Project["habit"]> {
  const x = object(raw, path, ["cycleNumber", "targetRounds", "completedFocusSessionIds", "awaitingNextBuilding"]);
  const targetRounds = integer(x.targetRounds, path + ".targetRounds", 10, 30);
  const completedFocusSessionIds = array(x.completedFocusSessionIds, path + ".completedFocusSessionIds", nonBlankString);
  unique(completedFocusSessionIds, path + ".completedFocusSessionIds");
  const awaitingNextBuilding = boolean(x.awaitingNextBuilding, path + ".awaitingNextBuilding");
  if (awaitingNextBuilding && completedFocusSessionIds.length !== 0) invalid(path + ".completedFocusSessionIds", "must be empty while awaiting the next building");
  if (!awaitingNextBuilding && completedFocusSessionIds.length >= targetRounds) invalid(path + ".completedFocusSessionIds", "must remain below targetRounds");
  return {
    cycleNumber: integer(x.cycleNumber, path + ".cycleNumber", 1),
    targetRounds,
    completedFocusSessionIds,
    awaitingNextBuilding,
  };
}

function parseHabitBuilding(raw: unknown, path: string): HabitBuildingMonument {
  const x = object(raw, path, ["id", "habitProjectId", "habitTitle", "cycleNumber", "settlementIndex", "blueprintId", "importedBlueprint", "targetRounds", "focusSessionIds", "completedAt"]);
  const importedBlueprint = x.importedBlueprint === null ? null : parseImportedBlueprint(x.importedBlueprint, path + ".importedBlueprint");
  const blueprintId = nonBlankString(x.blueprintId, path + ".blueprintId");
  if (importedBlueprint !== null && importedBlueprint.id !== blueprintId) invalid(path + ".importedBlueprint.id", "must match blueprintId");
  const targetRounds = integer(x.targetRounds, path + ".targetRounds", 10, 30);
  const focusSessionIds = array(x.focusSessionIds, path + ".focusSessionIds", nonBlankString);
  unique(focusSessionIds, path + ".focusSessionIds");
  if (focusSessionIds.length !== targetRounds) invalid(path + ".focusSessionIds", "must contain exactly targetRounds sessions");
  return {
    id: nonBlankString(x.id, path + ".id"),
    habitProjectId: nonBlankString(x.habitProjectId, path + ".habitProjectId"),
    habitTitle: nonBlankString(x.habitTitle, path + ".habitTitle"),
    cycleNumber: integer(x.cycleNumber, path + ".cycleNumber", 1),
    settlementIndex: integer(x.settlementIndex, path + ".settlementIndex", 0),
    blueprintId,
    importedBlueprint,
    targetRounds,
    focusSessionIds,
    completedAt: instant(x.completedAt, path + ".completedAt"),
  };
}

const IMPORTED_BLUEPRINT_MATERIALS = ["stone", "wood", "plank", "roof", "glass", "accent"] as const;
const IMPORTED_BLUEPRINT_STAGES = ["foundation", "frame", "walls", "roof", "details"] as const;
const MAX_SOURCE_BLOCK_STATE_PROPERTIES = 32;
const MAX_SOURCE_BLOCK_STATE_KEY_LENGTH = 64;
const MAX_SOURCE_BLOCK_STATE_VALUE_LENGTH = 128;
const SOURCE_BLOCK_STATE_KEY = /^[a-z0-9_.-]+$/;
const PROTOTYPE_POLLUTION_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function parseImportedBlueprint(raw: unknown, path = "$"): ImportedBlueprintV1 {
  const x = object(raw, path, ["schemaVersion", "id", "title", "bounds", "voxels"]);
  if (x.schemaVersion !== 1) invalid(path + ".schemaVersion", "must equal 1");
  const boundsRaw = object(x.bounds, path + ".bounds", ["minX", "maxX", "minY", "maxY", "minZ", "maxZ"]);
  const bounds = {
    minX: safeInteger(boundsRaw.minX, path + ".bounds.minX"),
    maxX: safeInteger(boundsRaw.maxX, path + ".bounds.maxX"),
    minY: safeInteger(boundsRaw.minY, path + ".bounds.minY"),
    maxY: safeInteger(boundsRaw.maxY, path + ".bounds.maxY"),
    minZ: safeInteger(boundsRaw.minZ, path + ".bounds.minZ"),
    maxZ: safeInteger(boundsRaw.maxZ, path + ".bounds.maxZ"),
  };
  if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY || bounds.minZ > bounds.maxZ) invalid(path + ".bounds", "minimums must not exceed maximums");
  if (bounds.maxX - bounds.minX + 1 > 48 || bounds.maxZ - bounds.minZ + 1 > 48) {
    invalid(path + ".bounds", "X and Z footprints must each span at most 48 blocks");
  }
  if (bounds.maxY - bounds.minY + 1 > 128) {
    invalid(path + ".bounds", "Y height must span at most 128 blocks");
  }
  if (!Array.isArray(x.voxels)) invalid(path + ".voxels", "must be an array");
  if (x.voxels.length === 0 || x.voxels.length > 100_000) invalid(path + ".voxels", "must contain from 1 through 100000 voxels");
  const coordinates = new Set<string>();
  const voxels = x.voxels.map((rawVoxel, index) => {
    const at = `${path}.voxels[${index}]`;
    const voxel = objectWithOptional(rawVoxel, at,
      ["x", "y", "z", "materialId", "stage", "buildOrder", "sourceBlockId", "sourceBlockState", "emissiveKind", "emissiveLevel"],
      ["sourceBlockId", "sourceBlockState", "emissiveKind", "emissiveLevel"]);
    const parsed: ImportedBlueprintV1["voxels"][number] = {
      x: safeInteger(voxel.x, at + ".x"),
      y: safeInteger(voxel.y, at + ".y"),
      z: safeInteger(voxel.z, at + ".z"),
      materialId: enumeration(voxel.materialId, at + ".materialId", IMPORTED_BLUEPRINT_MATERIALS),
      stage: enumeration(voxel.stage, at + ".stage", IMPORTED_BLUEPRINT_STAGES),
      buildOrder: integer(voxel.buildOrder, at + ".buildOrder", 0, 10_000),
    };
    if (voxel.sourceBlockId !== undefined) parsed.sourceBlockId = nonBlankString(voxel.sourceBlockId, at + ".sourceBlockId");
    if (voxel.sourceBlockState !== undefined) {
      const sourceBlockState = parseSourceBlockState(voxel.sourceBlockState, at + ".sourceBlockState");
      if (sourceBlockState !== undefined) parsed.sourceBlockState = sourceBlockState;
    }
    if (voxel.emissiveKind !== undefined) parsed.emissiveKind = nonBlankString(voxel.emissiveKind, at + ".emissiveKind");
    if (voxel.emissiveLevel !== undefined) parsed.emissiveLevel = integer(voxel.emissiveLevel, at + ".emissiveLevel", 0, 15);
    const key = `${parsed.x}:${parsed.y}:${parsed.z}`;
    if (coordinates.has(key)) invalid(at, `duplicates voxel coordinate ${key}`);
    coordinates.add(key);
    return parsed;
  });
  const first = voxels[0]!;
  const actual = { minX: first.x, maxX: first.x, minY: first.y, maxY: first.y, minZ: first.z, maxZ: first.z };
  for (let index = 1; index < voxels.length; index += 1) {
    const voxel = voxels[index]!;
    actual.minX = Math.min(actual.minX, voxel.x); actual.maxX = Math.max(actual.maxX, voxel.x);
    actual.minY = Math.min(actual.minY, voxel.y); actual.maxY = Math.max(actual.maxY, voxel.y);
    actual.minZ = Math.min(actual.minZ, voxel.z); actual.maxZ = Math.max(actual.maxZ, voxel.z);
  }
  for (const key of Object.keys(bounds) as Array<keyof typeof bounds>) {
    if (bounds[key] !== actual[key]) invalid(path + `.bounds.${key}`, "must exactly bound all voxels");
  }
  return {
    schemaVersion: 1,
    id: nonBlankString(x.id, path + ".id"),
    title: nonBlankString(x.title, path + ".title"),
    bounds,
    voxels,
  };
}

function parseSourceBlockState(raw: unknown, path: string): Record<string, string> | undefined {
  const value = record(raw, path);
  const keys = Reflect.ownKeys(value);
  if (keys.length > MAX_SOURCE_BLOCK_STATE_PROPERTIES) invalid(path, `must contain at most ${MAX_SOURCE_BLOCK_STATE_PROPERTIES} properties`);
  const entries: Array<[string, string]> = [];
  for (const rawKey of keys) {
    if (typeof rawKey !== "string") invalid(path, "must not contain symbol properties");
    const key = rawKey;
    if (key.length === 0 || key.length > MAX_SOURCE_BLOCK_STATE_KEY_LENGTH || !SOURCE_BLOCK_STATE_KEY.test(key)
      || PROTOTYPE_POLLUTION_KEYS.has(key)) {
      invalid(path + `.${key}`, "must be a safe lowercase block-state key of at most 64 characters");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || descriptor.get !== undefined || descriptor.set !== undefined
      || typeof descriptor.value !== "string") invalid(path + `.${key}`, "must be an enumerable string data property");
    if (descriptor.value.length === 0 || descriptor.value.length > MAX_SOURCE_BLOCK_STATE_VALUE_LENGTH) {
      invalid(path + `.${key}`, "must contain from 1 through 128 characters");
    }
    entries.push([key, descriptor.value]);
  }
  if (entries.length === 0) return undefined;
  entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return Object.fromEntries(entries);
}

export function parseDecorationBlueprint(raw: unknown, path = "$"): ImportedBlueprintV1 {
  const blueprint = parseImportedBlueprint(raw, path);
  const width = blueprint.bounds.maxX - blueprint.bounds.minX + 1;
  const height = blueprint.bounds.maxY - blueprint.bounds.minY + 1;
  const depth = blueprint.bounds.maxZ - blueprint.bounds.minZ + 1;
  if (width > 12 || depth > 12 || height > 16) invalid(path + ".bounds", "decoration must fit within 12 x 12 x 16 blocks");
  if (blueprint.voxels.length > 2_000) invalid(path + ".voxels", "decoration must contain at most 2000 voxels");
  return blueprint;
}

function parseDecorationResource(raw: unknown, path: string): DecorationBlueprintResource {
  const x = object(raw, path, ["id", "blueprint", "importedAt"]);
  const blueprint = parseDecorationBlueprint(x.blueprint, path + ".blueprint");
  const id = nonBlankString(x.id, path + ".id");
  if (blueprint.id !== id) invalid(path + ".id", "must match blueprint.id");
  return { id, blueprint, importedAt: instant(x.importedAt, path + ".importedAt") };
}

function parseBuildingResource(raw: unknown, path: string): BuildingBlueprintResource {
  const x = object(raw, path, ["id", "blueprint", "importedAt"]);
  const blueprint = parseImportedBlueprint(x.blueprint, path + ".blueprint");
  const id = nonBlankString(x.id, path + ".id");
  if (blueprint.id !== id) invalid(path + ".id", "must match blueprint.id");
  return { id, blueprint, importedAt: instant(x.importedAt, path + ".importedAt") };
}

function parseDecorationReward(raw: unknown, path: string): DecorationReward {
  const x = object(raw, path, ["date", "projectId", "resourceId", "awardedAt", "position", "rotationQuarterTurns"]);
  const position = object(x.position, path + ".position", ["x", "z"]);
  return {
    date: isoDate(x.date, path + ".date"),
    projectId: nonBlankString(x.projectId, path + ".projectId"),
    resourceId: nonBlankString(x.resourceId, path + ".resourceId"),
    awardedAt: instant(x.awardedAt, path + ".awardedAt"),
    position: {
      x: safeInteger(position.x, path + ".position.x"),
      z: safeInteger(position.z, path + ".position.z"),
    },
    rotationQuarterTurns: integer(x.rotationQuarterTurns, path + ".rotationQuarterTurns", 0, 3) as 0 | 1 | 2 | 3,
  };
}

function parseSubtask(raw: unknown, path: string): Subtask {
  const x = object(raw, path, ["id", "title", "order", "progressBasisPoints"]);
  return {
    id: nonBlankString(x.id, path + ".id"),
    title: nonBlankString(x.title, path + ".title"),
    order: integer(x.order, path + ".order", 0),
    progressBasisPoints: integer(x.progressBasisPoints, path + ".progressBasisPoints", 0, 10_000),
  };
}

function parseActiveSession(raw: unknown, path: string): ActiveFocusSession {
  const x = object(raw, path, ["id", "projectId", "subtaskId", "startedAt", "endsAt", "plannedDurationMs", "timeZoneAtStart", "integrity"]);
  const session: ActiveFocusSession = {
    id: nonBlankString(x.id, path + ".id"),
    projectId: nonBlankString(x.projectId, path + ".projectId"),
    subtaskId: x.subtaskId === null ? null : nonBlankString(x.subtaskId, path + ".subtaskId"),
    startedAt: instant(x.startedAt, path + ".startedAt"),
    endsAt: instant(x.endsAt, path + ".endsAt"),
    plannedDurationMs: integer(x.plannedDurationMs, path + ".plannedDurationMs", 1),
    timeZoneAtStart: timeZone(x.timeZoneAtStart, path + ".timeZoneAtStart"),
    integrity: parseActiveFocusIntegrity(x.integrity, path + ".integrity"),
  };
  validateScheduledTimes(session, path);
  const backgroundedAt = session.integrity.backgroundedAt;
  if (backgroundedAt !== null && (backgroundedAt < session.startedAt || backgroundedAt >= session.endsAt)) {
    invalid(path + ".integrity.backgroundedAt", "must be within the scheduled focus interval before endsAt");
  }
  return session;
}

function parseFocusSession(raw: unknown, path: string): FocusSession {
  const base = record(raw, path);
  const status = enumeration(base.status, path + ".status", ["completed", "completed-early", "interrupted"] as const);
  const keys = status === "interrupted"
    ? ["id", "projectId", "subtaskId", "startedAt", "endsAt", "plannedDurationMs", "timeZoneAtStart", "status", "interruptedAt", "interruptionReason", "interruptionCategory", "actualDurationMs"]
    : ["id", "projectId", "subtaskId", "startedAt", "endsAt", "plannedDurationMs", "timeZoneAtStart", "status", "completedAt", "completedLocalDate", "actualDurationMs"];
  const x = object(raw, path, keys);
  const active = parseActiveSessionFields(x, path);
  if (status === "completed" || status === "completed-early") {
    const completedAt = instant(x.completedAt, path + ".completedAt");
    const completedLocalDate = isoDate(x.completedLocalDate, path + ".completedLocalDate");
    if (status === "completed" && completedAt !== active.endsAt) invalid(path + ".completedAt", "must equal endsAt");
    if (status === "completed-early" && (completedAt < active.startedAt || completedAt >= active.endsAt)) invalid(path + ".completedAt", "must be within the scheduled interval before endsAt");
    if (completedLocalDate !== localDateOf(completedAt, active.timeZoneAtStart)) invalid(path + ".completedLocalDate", "does not match completion instant and start timezone");
    const actualDurationMs = integer(x.actualDurationMs, path + ".actualDurationMs", 0, active.plannedDurationMs);
    const expectedActual = status === "completed" ? active.plannedDurationMs : Date.parse(completedAt) - Date.parse(active.startedAt);
    if (actualDurationMs !== expectedActual) invalid(path + ".actualDurationMs", "does not match the actual focus interval");
    return { ...active, status, completedAt, completedLocalDate, actualDurationMs };
  }
  const interruptedAt = instant(x.interruptedAt, path + ".interruptedAt");
  if (interruptedAt < active.startedAt || interruptedAt >= active.endsAt) invalid(path + ".interruptedAt", "must be within the scheduled interval before endsAt");
  const interruptionReason = enumeration(x.interruptionReason, path + ".interruptionReason", ["user-cancelled", "app-switch-limit"] as const);
  const interruptionCategory = x.interruptionCategory === null ? null : enumeration(
    x.interruptionCategory, path + ".interruptionCategory",
    ["external-interruption", "task-blocked", "fatigue", "priority-changed", "device-or-app", "other"] as const,
  );
  if (interruptionReason === "app-switch-limit" && interruptionCategory !== null) invalid(path + ".interruptionCategory", "must be null for automatic integrity failures");
  const actualDurationMs = integer(x.actualDurationMs, path + ".actualDurationMs", 0, active.plannedDurationMs);
  if (actualDurationMs !== Date.parse(interruptedAt) - Date.parse(active.startedAt)) invalid(path + ".actualDurationMs", "does not match the actual focus interval");
  return { ...active, status, interruptedAt, interruptionReason, interruptionCategory, actualDurationMs };
}

function parseActiveSessionFields(x: Record<string, unknown>, path: string): FocusSessionBase {
  const session: FocusSessionBase = {
    id: nonBlankString(x.id, path + ".id"), projectId: nonBlankString(x.projectId, path + ".projectId"),
    subtaskId: x.subtaskId === null ? null : nonBlankString(x.subtaskId, path + ".subtaskId"), startedAt: instant(x.startedAt, path + ".startedAt"),
    endsAt: instant(x.endsAt, path + ".endsAt"), plannedDurationMs: integer(x.plannedDurationMs, path + ".plannedDurationMs", 1),
    timeZoneAtStart: timeZone(x.timeZoneAtStart, path + ".timeZoneAtStart"),
  };
  validateScheduledTimes(session, path);
  return session;
}

function parseProgressReport(raw: unknown, path: string): ProgressReport {
  const x = object(raw, path, ["id", "projectId", "subtaskId", "focusSessionIds", "progressBasisPoints", "reportedAt"]);
  return {
    id: nonBlankString(x.id, path + ".id"), projectId: nonBlankString(x.projectId, path + ".projectId"),
    subtaskId: nonBlankString(x.subtaskId, path + ".subtaskId"),
    focusSessionIds: array(x.focusSessionIds, path + ".focusSessionIds", nonBlankString),
    progressBasisPoints: integer(x.progressBasisPoints, path + ".progressBasisPoints", 0, 10_000),
    reportedAt: instant(x.reportedAt, path + ".reportedAt"),
  };
}

function parseDailyGoal(raw: unknown, path: string): DailyGoal {
  const x = object(raw, path, ["date", "targetPomodoros", "reachedAt", "enabled"]);
  return { date: isoDate(x.date, path + ".date"), targetPomodoros: integer(x.targetPomodoros, path + ".targetPomodoros", 1), reachedAt: x.reachedAt === null ? null : instant(x.reachedAt, path + ".reachedAt"), enabled: boolean(x.enabled, path + ".enabled") };
}

function parseCalendar(raw: unknown, path: string): FocusCalendar {
  const x = object(raw, path, ["timeZone", "restWeekdays"]);
  const restWeekdays = array(x.restWeekdays, path + ".restWeekdays", (value, at) => integer(value, at, 0, 6));
  unique(restWeekdays, path + ".restWeekdays");
  if (restWeekdays.some((value, index) => index > 0 && restWeekdays[index - 1]! >= value)) invalid(path + ".restWeekdays", "must be sorted ascending");
  return { timeZone: timeZone(x.timeZone, path + ".timeZone"), restWeekdays };
}

function parseDecayPolicy(raw: unknown, path: string): DecayPolicy {
  const x = object(raw, path, ["enabled", "gracePlannedDays", "repairMultiplierBasisPoints", "damagePerMissedPlannedDayBasisPoints"]);
  const enabled = boolean(x.enabled, path + ".enabled");
  const damage = x.damagePerMissedPlannedDayBasisPoints === null ? null : integer(x.damagePerMissedPlannedDayBasisPoints, path + ".damagePerMissedPlannedDayBasisPoints", 1, 10_000);
  if (enabled !== (damage !== null)) invalid(path + ".damagePerMissedPlannedDayBasisPoints", "must be present exactly when decay is enabled");
  const repair = integer(x.repairMultiplierBasisPoints, path + ".repairMultiplierBasisPoints", 1);
  if (repair !== 20_000) invalid(path + ".repairMultiplierBasisPoints", "v1 requires 20000");
  return { enabled, gracePlannedDays: integer(x.gracePlannedDays, path + ".gracePlannedDays", 0), repairMultiplierBasisPoints: repair, damagePerMissedPlannedDayBasisPoints: damage };
}

function parseProjectCondition(raw: unknown, path: string): ProjectCondition {
  const x = object(raw, path, ["projectId", "conditionBasisPoints", "inactivityAnchorAt", "assessedMissedPlannedDays"]);
  return { projectId: nonBlankString(x.projectId, path + ".projectId"), conditionBasisPoints: integer(x.conditionBasisPoints, path + ".conditionBasisPoints", 0, 10_000), inactivityAnchorAt: x.inactivityAnchorAt === null ? null : instant(x.inactivityAnchorAt, path + ".inactivityAnchorAt"), assessedMissedPlannedDays: integer(x.assessedMissedPlannedDays, path + ".assessedMissedPlannedDays", 0) };
}

function parseFocusIntegrityPolicy(raw: unknown, path: string): DomainState["focusIntegrityPolicy"] {
  const x = object(raw, path, ["enabled", "maxEffectiveExcursions"]);
  return {
    enabled: boolean(x.enabled, path + ".enabled"),
    maxEffectiveExcursions: integer(x.maxEffectiveExcursions, path + ".maxEffectiveExcursions", 1, 5),
  };
}

function parseWorldSettings(raw: unknown, path: string): DomainState["worldSettings"] {
  const x = object(raw, path, ["worldSeed", "terrainGenerationVersion", "environmentStyle"]);
  return {
    worldSeed: nonBlankString(x.worldSeed, path + ".worldSeed"),
    terrainGenerationVersion: integer(x.terrainGenerationVersion, path + ".terrainGenerationVersion", 1, 1) as 1,
    environmentStyle: enumeration(x.environmentStyle, path + ".environmentStyle", ["natural-valley", "classic-island"] as const),
  };
}

function parseActiveFocusIntegrity(raw: unknown, path: string): ActiveFocusSession["integrity"] {
  const x = object(raw, path, ["effectiveExcursions", "backgroundedAt", "backgroundReason", "exemptionPending"]);
  const backgroundedAt = x.backgroundedAt === null ? null : instant(x.backgroundedAt, path + ".backgroundedAt");
  const backgroundReason = x.backgroundReason === null ? null : enumeration(
    x.backgroundReason, path + ".backgroundReason", ["app-switch", "screen-lock", "system-exempt", "web-visibility"] as const,
  );
  if ((backgroundedAt === null) !== (backgroundReason === null)) invalid(path, "backgroundedAt and backgroundReason must both be null or both be present");
  return {
    effectiveExcursions: integer(x.effectiveExcursions, path + ".effectiveExcursions", 0, 5),
    backgroundedAt,
    backgroundReason,
    exemptionPending: boolean(x.exemptionPending, path + ".exemptionPending"),
  };
}

function validateReferences(state: DomainState): void {
  unique(state.projects.map((item) => item.id), "$.projects[].id");
  const projects = new Map(state.projects.map((item) => [item.id, item]));
  const activeProjects = state.projects.filter((item) => item.status === "active");
  if (state.activeProjectId === null) {
    if (activeProjects.length !== 0) invalid("$.activeProjectId", "must reference the sole active project");
  } else if (activeProjects.length !== 1 || activeProjects[0]!.id !== state.activeProjectId) invalid("$.activeProjectId", "must reference the sole active project");

  const subtasks = new Map<string, { projectId: string; subtask: Subtask }>();
  for (const project of state.projects) for (const subtask of project.subtasks) {
    if (subtasks.has(subtask.id)) invalid("$.projects[].subtasks[].id", `duplicate ${subtask.id}`);
    subtasks.set(subtask.id, { projectId: project.id, subtask });
  }
  unique(state.retiredSubtaskIds, "$.retiredSubtaskIds");
  for (const id of state.retiredSubtaskIds) if (subtasks.has(id)) invalid("$.retiredSubtaskIds", `contains current subtask ${id}`);

  unique(state.projectConditions.map((item) => item.projectId), "$.projectConditions[].projectId");
  if (state.projectConditions.length !== state.projects.length) invalid("$.projectConditions", "must contain exactly one runtime per project");
  for (const runtime of state.projectConditions) {
    const project = projects.get(runtime.projectId);
    if (!project) invalid("$.projectConditions[].projectId", `unknown project ${runtime.projectId}`);
    if (runtime.inactivityAnchorAt !== null && runtime.inactivityAnchorAt < project.createdAt) invalid("$.projectConditions[].inactivityAnchorAt", "precedes project creation");
    if (runtime.inactivityAnchorAt === null && runtime.assessedMissedPlannedDays !== 0) invalid("$.projectConditions[].assessedMissedPlannedDays", "must be zero without an inactivity anchor");
    const awaitingHabitBuilding = project.kind === "habit" && project.habit?.awaitingNextBuilding === true;
    if ((project.status === "active" || project.status === "paused") && state.decayPolicy.enabled && !awaitingHabitBuilding && runtime.inactivityAnchorAt === null) invalid("$.projectConditions[].inactivityAnchorAt", "unfinished project needs an anchor while decay is enabled");
    if (awaitingHabitBuilding && (runtime.inactivityAnchorAt !== null || runtime.assessedMissedPlannedDays !== 0)) invalid("$.projectConditions[]", "habit project awaiting a building must not decay");
    if (project.status === "deleted" && (runtime.inactivityAnchorAt !== null || runtime.assessedMissedPlannedDays !== 0)) invalid("$.projectConditions[]", "deleted project decay runtime must be reset");
    if (!state.decayPolicy.enabled && (runtime.inactivityAnchorAt !== null || runtime.assessedMissedPlannedDays !== 0)) invalid("$.projectConditions[]", "all decay runtime must be reset while decay is disabled");
  }

  const historyIds = state.focusHistory.map((item) => item.id);
  unique(historyIds, "$.focusHistory[].id");
  const sessions = new Map(state.focusHistory.map((item) => [item.id, item]));
  for (const [index, session] of state.focusHistory.entries()) {
    const path = `$.focusHistory[${index}]`;
    validateOwnership(session.projectId, session.subtaskId, projects, subtasks, path);
    if (session.startedAt < projects.get(session.projectId)!.createdAt) invalid(path + ".startedAt", "precedes project creation");
  }
  if (state.activeFocusSession) {
    if (sessions.has(state.activeFocusSession.id)) invalid("$.activeFocusSession.id", "duplicates a history session");
    validateOwnership(state.activeFocusSession.projectId, state.activeFocusSession.subtaskId, projects, subtasks, "$.activeFocusSession");
    if (state.activeFocusSession.projectId !== state.activeProjectId) invalid("$.activeFocusSession.projectId", "must belong to the active project");
    if (state.activeFocusSession.startedAt < projects.get(state.activeFocusSession.projectId)!.createdAt) invalid("$.activeFocusSession.startedAt", "precedes project creation");
  }
  validateFocusTimeline(state);

  unique(state.progressReports.map((item) => item.id), "$.progressReports[].id");
  const usedSessions = new Set<string>();
  const reportsBySubtask = new Map<string, ProgressReport[]>();
  for (const [index, report] of state.progressReports.entries()) {
    const path = `$.progressReports[${index}]`;
    validateOwnership(report.projectId, report.subtaskId, projects, subtasks, path);
    if (report.focusSessionIds.length === 0) invalid(path + ".focusSessionIds", "must not be empty");
    unique(report.focusSessionIds, path + ".focusSessionIds");
    for (const id of report.focusSessionIds) {
      const session = sessions.get(id);
      if (!session || (session.status !== "completed" && session.status !== "completed-early")) invalid(path + ".focusSessionIds", `unknown or incomplete session ${id}`);
      if (session.projectId !== report.projectId || session.subtaskId !== report.subtaskId) invalid(path + ".focusSessionIds", `session ${id} has inconsistent ownership`);
      if (session.completedAt > report.reportedAt) invalid(path + ".reportedAt", `precedes session ${id} completion`);
      if (usedSessions.has(id)) invalid(path + ".focusSessionIds", `session ${id} is reused`);
      usedSessions.add(id);
    }
    const list = reportsBySubtask.get(report.subtaskId) ?? [];
    list.push(report); reportsBySubtask.set(report.subtaskId, list);
  }
  for (const [subtaskId, owner] of subtasks) {
    const reports = reportsBySubtask.get(subtaskId) ?? [];
    let previous = 0;
    let previousReportedAt: string | null = null;
    for (const report of reports) {
      if (previousReportedAt !== null && report.reportedAt < previousReportedAt) invalid("$.progressReports", `reports are not chronological for subtask ${subtaskId}`);
      if (report.progressBasisPoints < previous) invalid("$.progressReports", `progress decreases for subtask ${subtaskId}`);
      previous = report.progressBasisPoints;
      previousReportedAt = report.reportedAt;
    }
    if (owner.subtask.progressBasisPoints !== previous) invalid("$.projects[].subtasks[].progressBasisPoints", `does not match latest report for ${subtaskId}`);
  }
  unique(state.habitBuildings.map((building) => building.id), "$.habitBuildings[].id");
  unique([
    ...state.projects.map((project) => project.settlementIndex),
    ...state.habitBuildings.map((building) => building.settlementIndex),
  ], "$.projects[].settlementIndex");
  const habitSessionIds = new Set<string>();
  for (const [index, building] of state.habitBuildings.entries()) {
    const path = `$.habitBuildings[${index}]`;
    const project = projects.get(building.habitProjectId);
    if (!project || project.kind !== "habit") invalid(path + ".habitProjectId", "must reference a habit project");
    if (building.cycleNumber >= project.habit!.cycleNumber) invalid(path + ".cycleNumber", "must precede the current habit cycle");
    let latestCompletion = "";
    for (const id of building.focusSessionIds) {
      const session = sessions.get(id);
      if (!session || (session.status !== "completed" && session.status !== "completed-early")) invalid(path + ".focusSessionIds", `unknown or incomplete session ${id}`);
      if (session.projectId !== building.habitProjectId || session.subtaskId !== null) invalid(path + ".focusSessionIds", `session ${id} has inconsistent habit ownership`);
      if (usedSessions.has(id) || habitSessionIds.has(id)) invalid(path + ".focusSessionIds", `session ${id} is reused`);
      habitSessionIds.add(id);
      if (session.completedAt > latestCompletion) latestCompletion = session.completedAt;
    }
    if (building.completedAt !== latestCompletion) invalid(path + ".completedAt", "must match the final supporting session completion");
  }
  for (const project of state.projects) {
    if (project.kind !== "habit") continue;
    for (const id of project.habit!.completedFocusSessionIds) {
      const session = sessions.get(id);
      if (!session || (session.status !== "completed" && session.status !== "completed-early")) invalid("$.projects[].habit.completedFocusSessionIds", `unknown or incomplete session ${id}`);
      if (session.projectId !== project.id || session.subtaskId !== null) invalid("$.projects[].habit.completedFocusSessionIds", `session ${id} has inconsistent habit ownership`);
      if (usedSessions.has(id) || habitSessionIds.has(id)) invalid("$.projects[].habit.completedFocusSessionIds", `session ${id} is reused`);
      habitSessionIds.add(id);
    }
  }
  for (const session of state.focusHistory) {
    const project = projects.get(session.projectId)!;
    if (project.kind === "habit" && (session.status === "completed" || session.status === "completed-early") && !habitSessionIds.has(session.id)) {
      invalid("$.focusHistory", `habit completion ${session.id} is not assigned to a building cycle`);
    }
  }
  unique(state.dailyGoals.map((item) => item.date), "$.dailyGoals[].date");
  for (const [index, goal] of state.dailyGoals.entries()) {
    const completions = state.focusHistory
      .filter((item): item is Extract<FocusSession, { status: "completed" }> => item.status === "completed" && item.completedLocalDate === goal.date)
      .sort((left, right) => left.completedAt.localeCompare(right.completedAt));
    if (goal.enabled && goal.reachedAt === null && completions.length >= goal.targetPomodoros) invalid(`$.dailyGoals[${index}].reachedAt`, "enabled goal at or above target must be reached");
    if (goal.reachedAt !== null) {
      if (completions.length === 0) invalid(`$.dailyGoals[${index}].reachedAt`, "reached goal needs at least one completion on its date");
      if (goal.reachedAt < completions[0]!.completedAt) invalid(`$.dailyGoals[${index}].reachedAt`, "precedes the first completion on its date");
    }
  }
  unique(state.decorationBlueprintResources.map((item) => item.id), "$.decorationBlueprintResources[].id");
  if (state.buildingBlueprintResources.length > 12) invalid("$.buildingBlueprintResources", "must contain at most 12 entries");
  unique(state.buildingBlueprintResources.map((item) => item.id), "$.buildingBlueprintResources[].id");
  const decorationResources = new Set(state.decorationBlueprintResources.map((item) => item.id));
  unique(state.decorationRewards.map((item) => item.date), "$.decorationRewards[].date");
  for (const [index, reward] of state.decorationRewards.entries()) {
    const path = `$.decorationRewards[${index}]`;
    if (!projects.has(reward.projectId)) invalid(path + ".projectId", `unknown project ${reward.projectId}`);
    if (!decorationResources.has(reward.resourceId)) invalid(path + ".resourceId", `unknown resource ${reward.resourceId}`);
    const goal = state.dailyGoals.find((item) => item.date === reward.date);
    if (!goal?.reachedAt) invalid(path + ".date", "must reference a reached daily goal");
    if (reward.awardedAt < goal.reachedAt) invalid(path + ".awardedAt", "precedes daily goal completion");
  }
}

function validateFocusTimeline(state: DomainState): void {
  for (let index = 1; index < state.focusHistory.length; index += 1) {
    const previous = state.focusHistory[index - 1]!;
    const current = state.focusHistory[index]!;
    if (current.startedAt < previous.startedAt) invalid(`$.focusHistory[${index}].startedAt`, "history must be chronological");
  }
  const sessions: FocusSessionBase[] = [...state.focusHistory, ...(state.activeFocusSession ? [state.activeFocusSession] : [])];
  const chronological = [...sessions].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  for (let index = 1; index < chronological.length; index += 1) {
    if (chronological[index]!.startedAt < effectiveFocusEnd(chronological[index - 1]!)) invalid("$.focusHistory", `focus intervals overlap: ${chronological[index - 1]!.id} and ${chronological[index]!.id}`);
  }
  if (state.activeFocusSession && state.focusHistory.some((item) => state.activeFocusSession!.startedAt < effectiveFocusEnd(item))) invalid("$.activeFocusSession.startedAt", "active focus must follow all history");
}

function effectiveFocusEnd(session: FocusSessionBase | FocusSession): string {
  if (!("status" in session)) return session.endsAt;
  if (session.status === "interrupted") return session.interruptedAt;
  return session.completedAt;
}

function validateOwnership(projectId: string, subtaskId: string | null, projects: Map<string, Project>, subtasks: Map<string, { projectId: string }>, path: string): void {
  const project = projects.get(projectId);
  if (!project) invalid(path + ".projectId", `unknown project ${projectId}`);
  if (project.kind === "habit") {
    if (subtaskId !== null) invalid(path + ".subtaskId", "must be null for a habit project");
    return;
  }
  if (subtaskId === null || subtasks.get(subtaskId)?.projectId !== projectId) invalid(path + ".subtaskId", `does not belong to project ${projectId}`);
}

function validateScheduledTimes(session: FocusSessionBase, path: string): void {
  if (Date.parse(session.endsAt) - Date.parse(session.startedAt) !== session.plannedDurationMs) invalid(path + ".endsAt", "must equal startedAt plus plannedDurationMs");
}

function migrateV1State(raw: unknown): unknown {
  const candidate = record(raw, "$");
  if (candidate.schemaVersion !== 1) return raw;
  const v1 = objectWithOptional(raw, "$", [
    "schemaVersion", "projects", "activeProjectId", "retiredSubtaskIds", "activeFocusSession",
    "focusHistory", "progressReports", "dailyGoals", "calendar", "decayPolicy", "projectConditions",
    "buildingBlueprintResources",
  ], ["buildingBlueprintResources"]);
  const projects = array(v1.projects, "$.projects", (project, path) => {
    const value = objectWithOptional(project, path, [
      "id", "title", "blueprintId", "importedBlueprint", "createdAt", "status", "subtaskStructureLocked", "subtasks",
    ], ["importedBlueprint"]);
    return Object.hasOwn(value, "importedBlueprint") ? value : { ...value, importedBlueprint: null };
  });
  const activeFocusSession = v1.activeFocusSession === null ? null : migrateV1ActiveSession(v1.activeFocusSession, "$.activeFocusSession");
  const focusHistory = array(v1.focusHistory, "$.focusHistory", migrateV1FocusSession);
  return {
    ...v1,
    schemaVersion: 2,
    projects,
    activeFocusSession,
    focusHistory,
    focusIntegrityPolicy: { enabled: true, maxEffectiveExcursions: 3 },
  };
}

function withDecorationDefaults(raw: unknown): unknown {
  const candidate = record(raw, "$" );
  if (candidate.schemaVersion !== 2) return raw;
  return {
    ...candidate,
    decorationBlueprintResources: Object.hasOwn(candidate, "decorationBlueprintResources") ? candidate.decorationBlueprintResources : [],
    decorationRewards: Object.hasOwn(candidate, "decorationRewards") ? candidate.decorationRewards : [],
  };
}

function migrateV2State(raw: unknown): unknown {
  const candidate = record(raw, "$");
  if (candidate.schemaVersion !== 2) return raw;
  const focusHistory = array(candidate.focusHistory, "$.focusHistory", (session, path) => {
    const value = record(session, path);
    const status = enumeration(value.status, path + ".status", ["completed", "interrupted"] as const);
    if (status === "completed") return { ...value, actualDurationMs: value.plannedDurationMs };
    const startedAt = instant(value.startedAt, path + ".startedAt");
    const interruptedAt = instant(value.interruptedAt, path + ".interruptedAt");
    return {
      ...value,
      interruptionCategory: null,
      actualDurationMs: Date.parse(interruptedAt) - Date.parse(startedAt),
    };
  });
  return { ...candidate, schemaVersion: 3, focusHistory };
}

function withBuildingBlueprintDefaults(raw: unknown): unknown {
  const candidate = record(raw, "$");
  if (candidate.schemaVersion !== 3) return raw;
  return {
    ...candidate,
    schemaVersion: 4,
    buildingBlueprintResources: Object.hasOwn(candidate, "buildingBlueprintResources") ? candidate.buildingBlueprintResources : [],
  };
}

function migrateV4State(raw: unknown): unknown {
  const candidate = record(raw, "$" );
  if (candidate.schemaVersion !== 4) return raw;
  const legacyProjects = array(candidate.projects, "$.projects", record);
  const projects = legacyProjects.map((value, settlementIndex) => ({ ...value, kind: "finite", habit: null, settlementIndex }));
  return {
    ...candidate,
    schemaVersion: 5,
    projects,
    habitBuildings: [],
  };
}

function migrateV5State(raw: unknown): unknown {
  const candidate = record(raw, "$");
  if (candidate.schemaVersion !== 5) return raw;
  const projects = Array.isArray(candidate.projects) ? candidate.projects : [];
  const firstProject = projects.find((value) =>
    typeof value === "object"
      && value !== null
      && !Array.isArray(value)
      && typeof (value as Record<string, unknown>).id === "string"
  ) as Record<string, unknown> | undefined;
  const firstProjectId = typeof firstProject?.id === "string" ? firstProject.id : undefined;
  return {
    ...candidate,
    schemaVersion: 6,
    worldSettings: {
      worldSeed: firstProjectId && firstProjectId.trim() !== "" ? `legacy-${firstProjectId}` : "world-default",
      terrainGenerationVersion: 1,
      environmentStyle: "natural-valley",
    },
  };
}

function migrateV1ActiveSession(raw: unknown, path: string): Record<string, unknown> {
  const session = object(raw, path, ["id", "projectId", "subtaskId", "startedAt", "endsAt", "plannedDurationMs", "timeZoneAtStart"]);
  return {
    ...session,
    integrity: { effectiveExcursions: 0, backgroundedAt: null, backgroundReason: null, exemptionPending: false },
  };
}

function migrateV1FocusSession(raw: unknown, path: string): Record<string, unknown> {
  const value = record(raw, path);
  const status = enumeration(value.status, path + ".status", ["completed", "interrupted"] as const);
  const keys = status === "completed"
    ? ["id", "projectId", "subtaskId", "startedAt", "endsAt", "plannedDurationMs", "timeZoneAtStart", "status", "completedAt", "completedLocalDate"]
    : ["id", "projectId", "subtaskId", "startedAt", "endsAt", "plannedDurationMs", "timeZoneAtStart", "status", "interruptedAt"];
  const session = object(raw, path, keys);
  return status === "interrupted" ? { ...session, interruptionReason: "user-cancelled" } : session;
}

function object(raw: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  const value = record(raw, path);
  const actual = Object.keys(value);
  for (const key of actual) if (!keys.includes(key)) invalid(path + "." + key, "unknown field");
  for (const key of keys) if (!Object.hasOwn(value, key)) invalid(path + "." + key, "missing field");
  return value;
}

function objectWithOptional(raw: unknown, path: string, keys: readonly string[], optionalKeys: readonly string[]): Record<string, unknown> {
  const value = record(raw, path);
  const actual = Object.keys(value);
  for (const key of actual) if (!keys.includes(key)) invalid(path + "." + key, "unknown field");
  for (const key of keys) if (!optionalKeys.includes(key) && !Object.hasOwn(value, key)) invalid(path + "." + key, "missing field");
  return value;
}

function record(raw: unknown, path: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) invalid(path, "must be a plain object");
  return raw as Record<string, unknown>;
}

function array<T>(raw: unknown, path: string, parser: (value: unknown, path: string) => T): T[] {
  if (!Array.isArray(raw)) invalid(path, "must be an array");
  return raw.map((value, index) => parser(value, `${path}[${index}]`));
}

function nonBlankString(raw: unknown, path: string): string {
  if (typeof raw !== "string" || raw.trim().length === 0) invalid(path, "must be a non-blank string");
  return raw;
}

function nullableString(raw: unknown, path: string): string | null { return raw === null ? null : nonBlankString(raw, path); }
function boolean(raw: unknown, path: string): boolean { if (typeof raw !== "boolean") invalid(path, "must be boolean"); return raw; }
function integer(raw: unknown, path: string, min: number, max = Number.MAX_SAFE_INTEGER): number { if (!Number.isSafeInteger(raw) || (raw as number) < min || (raw as number) > max) invalid(path, `must be an integer from ${min} through ${max}`); return raw as number; }
function safeInteger(raw: unknown, path: string): number { if (!Number.isSafeInteger(raw)) invalid(path, "must be a safe integer"); return raw as number; }
function enumeration<const T extends readonly string[]>(raw: unknown, path: string, values: T): T[number] { if (typeof raw !== "string" || !values.includes(raw)) invalid(path, `must be one of ${values.join(", ")}`); return raw as T[number]; }
function instant(raw: unknown, path: string): string { if (typeof raw !== "string" || !Number.isFinite(Date.parse(raw)) || new Date(raw).toISOString() !== raw) invalid(path, "must be a canonical ISO instant"); return raw; }
function isoDate(raw: unknown, path: string): string { if (typeof raw !== "string") invalid(path, "must be an ISO date"); try { assertISODate(raw); } catch { invalid(path, "must be a valid YYYY-MM-DD date"); } return raw; }
function timeZone(raw: unknown, path: string): string { if (typeof raw !== "string") invalid(path, "must be an IANA time zone"); try { assertValidTimeZone(raw); } catch { invalid(path, "must be an IANA time zone"); } return raw; }
function unique(values: readonly (string | number)[], path: string): void { if (new Set(values).size !== values.length) invalid(path, "must contain unique values"); }
function invalid(path: string, message: string): never { throw new DomainStateValidationError(path, message); }
