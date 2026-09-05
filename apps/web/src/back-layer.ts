import { useEffect, useRef } from 'react';

/**
 * Layered back-gesture routing for the Android hardware back button.
 *
 * Every dismissible overlay registers one layer while it is visible; the
 * gesture is offered from the topmost overlay downward. When no layer consumes
 * it, the root handler decides between navigating back to the world tab and
 * letting the app exit (see App).
 *
 * The stack lives at module scope on purpose: it must survive the mounted-
 * but-hidden route panes and never depends on React render timing.
 */
interface BackLayer {
  id: number;
  handle: () => boolean;
}

const layers: BackLayer[] = [];
let sequence = 0;

/** Registers one overlay layer; returns the unregister function. */
export function pushBackLayer(handle: () => boolean): () => void {
  const layer = { id: ++sequence, handle };
  layers.push(layer);
  return () => {
    const index = layers.indexOf(layer);
    if (index >= 0) layers.splice(index, 1);
  };
}

/** Offers the gesture to the topmost layer first; true when one consumed it. */
export function handleBack(): boolean {
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    if (layers[index]!.handle()) return true;
  }
  return false;
}

/** Test/diagnostic helper: how many layers are currently registered. */
export function backLayerCount(): number {
  return layers.length;
}

/**
 * Registers a layer only while its overlay is open. The handler is kept in a
 * ref so a changing closure never re-registers the layer mid-gesture.
 */
export function useBackLayer(active: boolean | undefined, handle: () => boolean): void {
  const handleRef = useRef(handle);
  handleRef.current = handle;
  useEffect(() => {
    if (!active) return undefined;
    return pushBackLayer(() => handleRef.current());
  }, [active]);
}
