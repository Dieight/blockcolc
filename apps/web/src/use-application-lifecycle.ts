import { useEffect, useRef, useState } from 'react';
import type { ApplicationService } from '@tomato-clock/application';
import { bindApplicationLifecycle, type RecordedIntegrityNotice } from './application-lifecycle';

export function useApplicationLifecycle(service: Pick<ApplicationService, 'resume'>, refresh: () => void) {
  const [notice, setNotice] = useState<RecordedIntegrityNotice | null>(null);
  const sequence = useRef(0);
  useEffect(() => bindApplicationLifecycle(window, {
    resume: () => service.resume(), refresh,
    record: value => setNotice({ ...value, sequence: ++sequence.current }),
  }), [service, refresh]);
  return notice;
}
