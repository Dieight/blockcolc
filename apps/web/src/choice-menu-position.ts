interface Rect { left: number; top: number; bottom: number; width: number }
interface Viewport { left: number; right: number; top: number; bottom: number }

/** Fixed coordinates are bounded by the visual viewport and persistent nav. */
export function choiceMenuPosition(trigger: Rect, viewport: Viewport, contentHeight: number) {
  const width = Math.min(trigger.width, Math.max(0, viewport.right - viewport.left));
  const left = Math.max(viewport.left, Math.min(trigger.left, viewport.right - width));
  const below = Math.max(0, viewport.bottom - trigger.bottom - 6);
  const above = Math.max(0, trigger.top - viewport.top - 6);
  const desired = Math.min(320, Math.max(44, contentHeight));
  const upwards = below < desired && above > below;
  const maxHeight = Math.max(0, Math.min(desired, upwards ? above : below));
  const top = upwards ? trigger.top - maxHeight - 6 : trigger.bottom + 6;
  return { left, width, top: Math.max(viewport.top, Math.min(top, viewport.bottom - maxHeight)), maxHeight };
}
