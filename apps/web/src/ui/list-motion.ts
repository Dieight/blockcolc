/** Only arrows animate here. Native scrolling and disclosure layout keep their
 * own owner: moving arbitrary ancestors also moves fixed sheets and notices. */
export function installListMotion(host: Document): () => void {
  const motions = new Map<SVGElement, Animation>();
  const click = (event: Event) => {
    if (!(event.target instanceof Element) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const control = event.target.closest<HTMLElement>('button[aria-expanded],summary');
    if (!control || control.closest('[role="dialog"],[role="alertdialog"]')) return;
    const icon = control.querySelector<SVGElement>('[data-pixel-icon="chevron"]');
    if (!icon) return;
    const open = control.matches('summary') ? control.parentElement?.hasAttribute('open') : control.getAttribute('aria-expanded') === 'true';
    const from = Number(icon.dataset.disclosureTurns ?? (open ? 180 : 0)), to = from + 180;
    motions.get(icon)?.cancel();
    icon.dataset.disclosureTurns = String(to); icon.style.rotate = `${to}deg`;
    const animation = icon.animate([{ rotate: `${from}deg` }, { rotate: `${to}deg` }], { duration: 260, easing: 'cubic-bezier(.2,.75,.25,1)' });
    motions.set(icon, animation);
    void animation.finished.catch(() => {}).finally(() => { if (motions.get(icon) === animation) motions.delete(icon); });
  };
  const stop = () => { motions.forEach(animation => animation.cancel()); motions.clear(); };
  const hidden = () => { if (host.hidden) stop(); };
  host.addEventListener('click', click, true); host.addEventListener('visibilitychange', hidden);
  return () => { stop(); host.removeEventListener('click', click, true); host.removeEventListener('visibilitychange', hidden); };
}
