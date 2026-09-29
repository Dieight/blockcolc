import type { ApplicationCommand, ApplicationService } from '@blockcolc/application';
import { commandFeedback, type CommandFeedback } from './command-feedback';
import { failFocusSubmission, failFocusSubmissionProjection, markFocusSubmissionStage, requestFocusSubmissionProjection } from './submission-performance';

interface CommandRunnerPorts {
  service: Pick<ApplicationService, 'dispatch'>;
  feedback: (feedback: CommandFeedback) => void;
  failure: (message: string) => void;
  refresh: () => void;
}

export interface CommandRunnerOptions {
  /** Let a focus transition batch its plan write with the application refresh. */
  deferRefresh?: boolean;
  /** Test-mode correlation token for a user initiated progress report. */
  submissionToken?: number | null;
}

/** No second queue and no retry: the application owns persistence and serialization. */
export function createCommandRunner(ports: CommandRunnerPorts) {
  return async (command: ApplicationCommand, options?: CommandRunnerOptions) => {
    let dispatchSucceeded = false;
    try {
      markFocusSubmissionStage(options?.submissionToken, 'dispatch-started');
      let result: Awaited<ReturnType<CommandRunnerPorts['service']['dispatch']>>;
      try {
        result = await ports.service.dispatch(command);
      } catch (error) {
        failFocusSubmission(options?.submissionToken, 'dispatch-threw');
        throw error;
      }
      if (options?.submissionToken != null) {
        if (result.ok) {
          dispatchSucceeded = true;
          markFocusSubmissionStage(options.submissionToken, 'dispatch-completed', { persistenceCommitted: true });
        }
        else failFocusSubmission(options.submissionToken, 'dispatch-rejected');
      }
      ports.feedback(commandFeedback(result));
      // A successful focus start can publish its persisted round-plan and the
      // application snapshot in one React task. Rejections still refresh
      // immediately so the error feedback is not held by the caller.
      if (result.ok && options?.submissionToken != null) requestFocusSubmissionProjection(options.submissionToken);
      if (!options?.deferRefresh || !result.ok) ports.refresh();
      return result;
    } catch (error) {
      if (dispatchSucceeded) failFocusSubmissionProjection(options?.submissionToken);
      ports.failure(error instanceof Error ? error.message : '操作失败，请重试。');
      throw error;
    }
  };
}
