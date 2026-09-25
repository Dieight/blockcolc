import type { ReactNode } from 'react';

/** One symmetric face for every immersive state; empty slots retain the same geometry. */
export function FocusFace({ enabled = true, context, timer, controls }: {
  enabled?: boolean; context?: ReactNode; timer: ReactNode; controls?: ReactNode;
}) {
  if (!enabled) return <>{context}{timer}{controls}</>;
  return <div className="focus-face">
    <div className="focus-face-context">{context}</div>
    <div className="focus-face-time">{timer}</div>
    <div className="focus-face-controls">{controls}</div>
  </div>;
}
