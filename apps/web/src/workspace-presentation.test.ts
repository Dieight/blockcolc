import { describe, expect, it } from 'vitest';
import { createInitialState, execute, type DomainState } from '@blockcolc/domain';
import { projectActiveState, projectWorldState } from '@blockcolc/application';
import { requiresFirstProjectSetup, workspacePresentation } from './workspace-presentation';

function completedWorkspace(): DomainState {
  let state = createInitialState();
  const commands = [
    { type: 'CreateProject' as const, projectId: 'work', title: '已完成', blueprintId: 'builtin-small-workshop', subtasks: [{ id: 'last', title: '收尾' }] },
    { type: 'StartFocus' as const, sessionId: 'round', subtaskId: 'last', plannedDurationMs: 60000 },
    { type: 'CompleteFocusEarly' as const, reportId: 'report' },
  ];
  for (const command of commands) {
    const result = execute(state, command, { now: () => new Date('2026-10-03T08:00:00Z') });
    if (!result.ok) throw new Error(result.message);
    state = result.state;
  }
  return state;
}

describe('returning-user workspace', () => {
  it('retains the completed building view without inventing an active task', () => {
    const state = completedWorkspace();
    const before = structuredClone(state);
    expect(projectActiveState(state)).toBeNull();
    expect(workspacePresentation(state, null, projectWorldState(state))).toMatchObject({
      project: { id: 'work', status: 'monument' }, unreportedCompletedSessions: [],
    });
    expect(state).toEqual(before);
    expect(requiresFirstProjectSetup(state, false, false)).toBe(false);
  });
  it('requires the choice only for a genuinely new workspace', () => {
    const state = createInitialState();
    expect(requiresFirstProjectSetup(state, false, false)).toBe(true);
    expect(requiresFirstProjectSetup(state, true, false)).toBe(false);
    expect(requiresFirstProjectSetup(state, false, true)).toBe(false);
    expect(workspacePresentation(state, null, projectWorldState(state))).toBeNull();
    const deleted = completedWorkspace(); deleted.projects[0]!.status = 'deleted';
    expect(requiresFirstProjectSetup(deleted, false, false)).toBe(false);
    expect(workspacePresentation(deleted, null, projectWorldState(deleted))).toBeNull();
  });
});
