import type { ApplicationResult } from '@tomato-clock/application';

export interface CommandMessage {
  text: string;
  action?: { label: string; target: 'settings' };
}
export interface CommandFeedback {
  message: CommandMessage | null;
  ceremony: { projectId: string; title: string } | null;
}

/** Interpret committed events only; ordering is part of the existing UI contract. */
export function commandFeedback(result: ApplicationResult): CommandFeedback {
  if (!result.ok) return { message: { text: result.message }, ceremony: null };
  const { events, state, warnings } = result;
  const earlyEvent = events.find(event => event.type === 'FocusCompletedEarly');
  const earlySession = earlyEvent ? state.focusHistory.find(session => session.id === earlyEvent.sessionId) : undefined;
  let message: CommandMessage | null = null;
  if (events.some(event => event.type === 'FocusInterrupted' && event.reason === 'app-switch-limit')) message = null;
  else if (events.some(event => event.type === 'FocusInterrupted')) message = { text: '本轮已记录，有效专注时间已计入统计。' };
  else if (events.some(event => event.type === 'HabitBuildingCompleted')) message = { text: '这座习惯建筑已完成，请选择下一座建筑。' };
  else if (earlyEvent) {
    message = { text: events.some(event => event.type === 'HabitBuildingProgressed')
      ? '习惯专注已推进一轮，实际专注时间已记录。'
      : earlySession?.marathon === true ? '本轮已提前完成，实际专注时间已记录。'
        : '小任务已提前完成，实际专注时间已记录。' };
  } else if (warnings.some(warning => warning.code === 'NOTIFICATION_INEXACT')) message = {
    text: '系统提醒已开启，但未获精准闹钟权限，锁屏时可能略有延迟。', action: { label: '去设置', target: 'settings' },
  };
  else if (warnings.length) message = {
    text: '计时已开始；系统通知当前不可用，回到应用时仍会正确恢复。', action: { label: '去设置', target: 'settings' },
  };
  else if (events.some(event => event.type === 'ProjectDeleted')) message = { text: '任务已删除，已完成的习惯建筑仍保留在聚落中。' };
  const sealed = events.find(event => event.type === 'ProjectSealedAsMonument');
  const project = sealed ? state.projects.find(item => item.id === sealed.projectId) : undefined;
  return { message, ceremony: project ? { projectId: project.id, title: project.title } : null };
}
