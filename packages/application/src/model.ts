import type {
  DomainCommand,
  DomainErrorCode,
  DomainEvent,
  DomainState,
  Project,
  ProjectCondition,
} from "@tomato-clock/domain";
import { projectProgressBasisPoints } from "@tomato-clock/domain";

type GeneratedCommandType = "CreateProject" | "CreateHabitProject" | "AddSubtask" | "StartFocus" | "ReportSubtaskProgress" | "CompleteFocusEarly";

export type ApplicationCommand =
  | { type: "CreateProject"; title: string; blueprintId: string; importedBlueprint?: Project["importedBlueprint"]; subtasks: Array<{ title: string }> }
  | { type: "CreateHabitProject"; title: string; blueprintId: string; importedBlueprint?: Project["importedBlueprint"]; targetRounds: number }
  | { type: "SelectNextHabitBuilding"; blueprintId: string; importedBlueprint?: Project["importedBlueprint"]; targetRounds: number }
  | { type: "AddSubtask"; title: string }
  | { type: "StartFocus"; subtaskId: string | null; plannedDurationMs: number }
  | { type: "ReportSubtaskProgress"; subtaskId: string; focusSessionIds: string[]; progressBasisPoints: number }
  | { type: "CompleteFocusEarly" }
  | Exclude<DomainCommand, { type: GeneratedCommandType }>;

export type ApplicationWarningCode =
  | "NOTIFICATION_PERMISSION_REQUEST_FAILED"
  | "NOTIFICATION_PERMISSION_DENIED"
  | "NOTIFICATION_INEXACT"
  | "NOTIFICATION_CAPABILITY_REFRESH_FAILED"
  | "NOTIFICATION_SCHEDULE_FAILED"
  | "NOTIFICATION_CANCEL_FAILED";

export interface ApplicationWarning {
  code: ApplicationWarningCode;
  message: string;
  cause?: unknown;
}

export type ApplicationResult =
  | { ok: true; state: DomainState; events: DomainEvent[]; warnings: ApplicationWarning[] }
  | { ok: false; state: DomainState; code: DomainErrorCode; message: string; warnings: [] };

export interface ActiveProjectProjection {
  project: Project;
  building: {
    projectId: string;
    blueprintId: string;
    importedBlueprint: Project["importedBlueprint"];
    completionBasisPoints: number;
    conditionBasisPoints: number;
  };
  unreportedCompletedSessions: Array<{
    id: string;
    subtaskId: string | null;
    completedAt: string;
  }>;
}

export interface ProjectWorldProjection {
  project: Pick<Project, "id" | "title" | "status" | "kind" | "blueprintId">;
  isActive: boolean;
  /** Stable derived plot slot based on the project's position in retained history. */
  settlementIndex: number;
  building: {
    projectId: string;
    blueprintId: string;
    importedBlueprint: Project["importedBlueprint"];
    completionBasisPoints: number;
    conditionBasisPoints: number;
  };
  importedDecorations: Array<{
    rewardId: string;
    resourceId: string;
    date: string;
    blueprint: NonNullable<Project["importedBlueprint"]>;
    localPosition: { x: number; z: number };
    rotationQuarterTurns: 0 | 1 | 2 | 3;
  }>;
}

export interface WorldProjection {
  activeProjectId: string | null;
  projects: ProjectWorldProjection[];
}

export function projectActiveState(state: DomainState): ActiveProjectProjection | null {
  if (state.activeProjectId === null) return null;
  const project = state.projects.find((candidate) => candidate.id === state.activeProjectId);
  if (!project || project.status !== "active") return null;
  const condition = conditionFor(state, project.id);
  const reported = new Set(state.progressReports.flatMap((report) => report.focusSessionIds));
  const unreportedCompletedSessions = project.kind === "habit" ? [] : state.focusHistory
    .flatMap((session) => session.status === "completed" && session.projectId === project.id && !reported.has(session.id)
      ? [{ id: session.id, subtaskId: session.subtaskId, completedAt: session.completedAt }]
      : []);

  const completionBasisPoints = projectProgressBasisPoints(project);

  return {
    project: structuredClone(project),
    building: {
      projectId: project.id,
      blueprintId: project.blueprintId,
      importedBlueprint: structuredClone(project.importedBlueprint),
      completionBasisPoints,
      conditionBasisPoints: condition.conditionBasisPoints,
    },
    unreportedCompletedSessions,
  };
}

export function projectWorldState(state: DomainState): WorldProjection {
  const projects: ProjectWorldProjection[] = state.projects.flatMap((project) => {
    if (project.status === "deleted" || (project.kind === "habit" && project.habit?.awaitingNextBuilding)) return [];
    return [{
      project: { id: project.id, title: project.title, status: project.status, kind: project.kind, blueprintId: project.blueprintId },
      isActive: project.id === state.activeProjectId,
      settlementIndex: project.settlementIndex,
      building: {
        projectId: project.id,
        blueprintId: project.blueprintId,
        importedBlueprint: structuredClone(project.importedBlueprint),
        completionBasisPoints: projectProgressBasisPoints(project),
        conditionBasisPoints: conditionFor(state, project.id).conditionBasisPoints,
      },
      importedDecorations: state.decorationRewards.flatMap((reward) => {
        if (reward.projectId !== project.id) return [];
        const resource = state.decorationBlueprintResources.find((candidate) => candidate.id === reward.resourceId);
        return resource ? [{
          rewardId: `${reward.date}:${reward.resourceId}`,
          resourceId: reward.resourceId,
          date: reward.date,
          blueprint: structuredClone(resource.blueprint),
          localPosition: structuredClone(reward.position),
          rotationQuarterTurns: reward.rotationQuarterTurns,
        }] : [];
      }),
    }];
  });
  for (const building of state.habitBuildings) {
    projects.push({
      project: { id: building.id, title: `${building.habitTitle} · 第 ${building.cycleNumber} 座`, status: "monument", kind: "habit", blueprintId: building.blueprintId },
      isActive: false,
      settlementIndex: building.settlementIndex,
      building: {
        projectId: building.id,
        blueprintId: building.blueprintId,
        importedBlueprint: structuredClone(building.importedBlueprint),
        completionBasisPoints: 10_000,
        conditionBasisPoints: 10_000,
      },
      importedDecorations: [],
    });
  }
  return {
    activeProjectId: state.activeProjectId,
    projects,
  };
}

function conditionFor(state: DomainState, projectId: string): ProjectCondition {
  const condition = state.projectConditions.find((candidate) => candidate.projectId === projectId);
  if (!condition) throw new Error(`Project ${projectId} has no condition state`);
  return condition;
}
