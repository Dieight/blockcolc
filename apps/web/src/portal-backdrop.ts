// A short-lived, in-memory last frame, never a second world renderer or a file.
const captures = new WeakMap<HTMLCanvasElement, (target: HTMLCanvasElement) => boolean>();

export function registerPortalFrame(canvas: HTMLCanvasElement, capture: (target: HTMLCanvasElement) => boolean) {
  captures.set(canvas, capture);
  return () => { if (captures.get(canvas) === capture) captures.delete(canvas); };
}

/** Freeze the actual minimal view before changing the resident canvas layout. */
export function capturePortalBackdrop(root: HTMLElement) {
  const source = root.querySelector<HTMLCanvasElement>('canvas[aria-label="项目建筑世界"]');
  const capture = source && captures.get(source);
  if (!source || !capture) throw new Error('World presentation is unavailable');
  const bitmap = document.createElement('canvas');
  const rect = source.getBoundingClientRect();
  bitmap.width = Math.max(1, Math.ceil(rect.width)); bitmap.height = Math.max(1, Math.ceil(rect.height));
  if (!capture(bitmap)) throw new Error('World presentation could not be captured');
  const host = document.createElement('div'); host.className = 'mode-portal__backdrop';
  host.setAttribute('aria-hidden', 'true'); host.inert = true;
  host.style.background = getComputedStyle(document.body).background;
  const shadow = host.attachShadow({ mode: 'open' });
  const pseudoRules: string[] = [];
  let serial = 0;
  const frozenStyle = (style: CSSStyleDeclaration) => Array.from(style)
    .filter(name => !name.startsWith('animation') && !name.startsWith('transition'))
    .map(name => `${name}:${style.getPropertyValue(name)};`).join('') + 'animation:none!important;transition:none!important;';
  const copy = (node: Node): Node | null => {
    if (node.nodeType === Node.TEXT_NODE) return node.cloneNode();
    if (!(node instanceof Element)) return null;
    const style = getComputedStyle(node);
    if (style.display === 'none' || ['SCRIPT', 'STYLE', 'LINK'].includes(node.tagName)) return null;
    const cloned = node === source ? bitmap : node.cloneNode(false) as HTMLElement | SVGElement;
    // The inert snapshot has no live selectors, IDs, event attributes or roles.
    // Shadow CSS is copied from computed pixels, not from another mounted route.
    for (const attribute of [...cloned.attributes]) {
      if (/^(class|id|role|data-.+|aria-.+|on.+)$/.test(attribute.name)) cloned.removeAttribute(attribute.name);
    }
    cloned.setAttribute('style', frozenStyle(style));
    const id = String(++serial); cloned.setAttribute('data-portal-copy', id);
    for (const pseudo of ['::before', '::after']) {
      const computed = getComputedStyle(node, pseudo);
      if (computed.content !== 'none' && computed.content !== 'normal') pseudoRules.push(`[data-portal-copy="${id}"]${pseudo}{${frozenStyle(computed)}}`);
    }
    if (node !== source) for (const child of node.childNodes) { const next = copy(child); if (next) cloned.append(next); }
    return cloned;
  };
  const frozen = copy(root) as HTMLElement;
  const bounds = root.getBoundingClientRect();
  Object.assign(frozen.style, { position: 'fixed', left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px`, margin: '0' });
  const styles = document.createElement('style'); styles.textContent = pseudoRules.join('\n');
  shadow.append(styles, frozen);
  return { element: host, dispose() { host.remove(); bitmap.width = bitmap.height = 0; } };
}
