import type {
  DomainCommand,
  DomainErrorCode,
  DomainEvent,
  DomainState,
  Project,
  ProjectCondition,
} from "@tomato-clock/domain";
import { projectProgressBasisPoints } from "@tomato-clock/domain";

type GeneratedCommandType = "CreateProject" | "AddSubtask" | "StartFocus" | "ReportSubtaskProgress" | "CompleteFocusEarly";

export type ApplicationCommand =
  | { type: "CreateProject"; title: string; blueprintId: string; importedBlueprint?: Project["importedBlueprint"]; subtasks: Array<{ title: string }> }
  | { type: "AddSubtask"; title: string }
  | { type: "StartFocus"; subtaskId: string; plannedDurationMs: number }
  | { type: "ReportSubtaskProgress"; subtaskId: string; focusSessionIds: string[]; progressBasisPoints: number }
  | { type: "CompleteFocusEarly" }
  | Exclude<DomainCommand, { type: GeneratedCommandType }>;

export type ApplicationWarningCode =
  | "NOTIFICATION_PERMISSION_REQUEST_FAILED"
  | "NOTIFICATION_PERMISSION_DENIED"
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
    subtaskId: string;
    completedAt: string;
  }>;
}

export interface ProjectWorldProjection {
  project: Project;
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
  const unreportedCompletedSessions = state.focusHistory
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
  return {
    activeProjectId: state.activeProjectId,
    projects: state.projects.flatMap((project, settlementIndex) => project.status === "deleted" ? [] : [{
      project: structuredClone(project),
      isActive: project.id === state.activeProjectId,
      settlementIndex,
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
    }]),
  };
}

function conditionFor(state: DomainState, projectId: string): ProjectCondition {
  const condition = state.projectConditions.find((candidate) => candidate.projectId === projectId);
  if (!condition) throw new Error(`Project ${projectId} has no condition state`);
  return condition;
}
