import type { ApplicationCommand, ApplicationService } from '@tomato-clock/application';
import { commandFeedback, type CommandFeedback } from './command-feedback';

interface CommandRunnerPorts {
  service: Pick<ApplicationService, 'dispatch'>;
  feedback: (feedback: CommandFeedback) => void;
  failure: (message: string) => void;
  refresh: () => void;
}

export interface CommandRunnerOptions {
  /** Let a focus transition batch its plan write with the application refresh. */
  deferRefresh?: boolean;
}

/** No second queue and no retry: the application owns persistence and serialization. */
export function createCommandRunner(ports: CommandRunnerPorts) {
  return async (command: ApplicationCommand, options?: CommandRunnerOptions) => {
    try {
      const result = await ports.service.dispatch(command);
      ports.feedback(commandFeedback(result));
      // A successful focus start can publish its persisted round-plan and the
      // application snapshot in one React task. Rejections still refresh
      // immediately so the error feedback is not held by the caller.
      if (!options?.deferRefresh || !result.ok) ports.refresh();
      return result;
    } catch (error) {
      ports.failure(error instanceof Error ? error.message : '操作失败，请重试。');
      throw error;
    }
  };
}
