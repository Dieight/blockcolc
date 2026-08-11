import { createInitialState, execute, type DomainState } from "@tomato-clock/domain";

export function projectState(title = "Build a portfolio"): DomainState {
  const result = execute(createInitialState("Asia/Shanghai", [0, 6]), {
    type: "CreateProject",
    projectId: "project-1",
    title,
    blueprintId: "workshop-small",
    subtasks: [
      { id: "subtask-1", title: "Research" },
      { id: "subtask-2", title: "Draft" },
    ],
  }, { now: () => new Date("2026-07-23T08:00:00.000Z") });
  if (!result.ok) throw new Error(result.message);
  return result.state;
}
