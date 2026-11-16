import type {
  DomainCommand,
  DomainErrorCode,
  DomainEvent,
  DomainState,
  Project,
  ProjectCondition,
} from "@blockcolc/domain";
import { projectProgressBasisPoints, holidaysForYear } from "@blockcolc/domain";

type GeneratedCommandType = "CreateProject" | "CreateHabitProject" | "AddSubtask" | "StartFocus" | "ReportSubtaskProgress" | "CompleteFocusEarly" | 'AddQuickNote';

export type ApplicationCommand =
  | { type: 'AddQuickNote'; text: string }
  | { type: "CreateProject"; title: string; blueprintId: string; importedBlueprint?: Project["importedBlueprint"]; subtasks: Array<{ title: string }> }
  | { type: "CreateHabitProject"; title: string; blueprintId: string; importedBlueprint?: Project["importedBlueprint"]; targetRounds: number }
  | { type: "SelectNextHabitBuilding"; blueprintId: string; importedBlueprint?: Project["importedBlueprint"]; targetRounds: number }
  | { type: "AddSubtask"; title: string }
  | Omit<Extract<DomainCommand,{type:'StartFocus'}>,'sessionId'>
  | { type: "ReportSubtaskProgress"; subtaskId: string; focusSessionIds: string[]; progressBasisPoints: number }
  | { type: "ReportMarathonFocus"; entries: Array<{ projectId: string; subtaskId: string; progressBasisPoints: number; rounds?: number }>; habitAllocations: Array<{ projectId: string; rounds: number }>; focusSessionIds: string[] }
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
    .flatMap((session) => session.status === "completed" && session.projectId === project.id
      && session.marathon !== true && !reported.has(session.id)
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

export function projectWorldState(state: DomainState, holidayBlueprint?: (id:string,title:string)=>NonNullable<Project['importedBlueprint']>): WorldProjection {
  const plots = [...state.projects.filter(project=>project.status!=='deleted'&&!(project.kind==='habit'&&project.habit?.awaitingNextBuilding)).map(project=>project.settlementIndex),...state.habitBuildings.map(building=>building.settlementIndex)].sort((a,b)=>a-b);
  const birthdayKeepsakes=(settlementIndex:number):ProjectWorldProjection['importedDecorations']=>holidayBlueprint?state.birthdayRewards.flatMap((reward,index)=>{
    const anchor=reward.settlementIndex!==null&&plots.includes(reward.settlementIndex)?reward.settlementIndex:plots[0];
    if(anchor!==settlementIndex)return [];
    return [{rewardId:`birthday:${reward.year}`,resourceId:'builtin-birthday-cake-v1',date:reward.date,
      blueprint:holidayBlueprint('birthday',`${reward.year} · 生日小蛋糕`),localPosition:{x:54+index*12,z:-54},rotationQuarterTurns:0}];
  }):[];
  const seasonal=(settlementIndex:number):ProjectWorldProjection['importedDecorations']=>holidayBlueprint?state.holidayRewards.filter(r=>r.settlementIndex===settlementIndex).map(r=>{
    const holiday=holidaysForYear(r.year).find(h=>h.id===r.holidayId)!;
    return{rewardId:`holiday:${r.holidayId}:${r.year}`,resourceId:`builtin-holiday-${r.holidayId}-v1`,date:r.date,
      blueprint:holidayBlueprint(r.holidayId,`${r.year} · ${holiday.buildingName}`),localPosition:structuredClone(r.position),rotationQuarterTurns:r.rotationQuarterTurns};
  }):[];
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
      importedDecorations: [...birthdayKeepsakes(project.settlementIndex),...seasonal(project.settlementIndex),...state.decorationRewards.flatMap((reward) => {
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
      })],
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
      importedDecorations: [...birthdayKeepsakes(building.settlementIndex),...seasonal(building.settlementIndex)],
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
