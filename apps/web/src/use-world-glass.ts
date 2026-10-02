import { useEffect, useMemo, useState } from 'react';
import type { GlassSurfacePreference } from '@blockcolc/voxel/glass-material';

/** Resolves presentation media at the DOM boundary; the renderer knows no app preferences/storage. */
export function useWorldGlass(enabled: boolean, clarity: number): GlassSurfacePreference {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const [reducedTransparency, setReducedTransparency] = useState(() => window.matchMedia('(prefers-reduced-transparency: reduce)').matches);
  useEffect(() => {
    const update = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    update();
    const media = window.matchMedia('(prefers-reduced-transparency: reduce)');
    const updateMedia = () => setReducedTransparency(media.matches);
    media.addEventListener('change', updateMedia); updateMedia();
    return () => { observer.disconnect(); media.removeEventListener('change', updateMedia); };
  }, []);
  return useMemo(() => ({ enabled, clarity, theme, reducedTransparency }), [enabled, clarity, theme, reducedTransparency]);
}
