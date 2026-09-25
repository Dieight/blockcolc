import { useCallback, useEffect, useState } from 'react';
import type { FocusPreferences } from './app-types';
import { focusGlassMaterialFor } from './focus-glass';
import { defaultFocusPreferences, loadFocusPreferences, saveFocusPreferences } from './focus-preferences';

/** Owns the local preference lifetime, persistence and document presentation effects. */
export function useFocusPreferences() {
  const [preferences, setPreferences] = useState(() => {
    // Accessing localStorage itself can throw, before getItem is reached.
    try { return loadFocusPreferences(window.localStorage); }
    catch { return defaultFocusPreferences(); }
  });
  const updatePreferences = useCallback((value: FocusPreferences) => {
    saveFocusPreferences(window.localStorage, value);
    setPreferences(value);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = preferences.themeMode === 'dark' || (preferences.themeMode === 'system' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    };
    apply();
    if (preferences.themeMode !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [preferences.themeMode]);

  useEffect(() => {
    const material = focusGlassMaterialFor(preferences.focusGlassTransparency);
    const root = document.documentElement;
    root.style.setProperty('--focus-glass-light-alpha', material.lightAlpha);
    root.style.setProperty('--focus-glass-dark-alpha', material.darkAlpha);
    root.style.setProperty('--focus-glass-blur', material.blur);
    root.style.setProperty('--focus-glass-saturation', material.saturation);
    root.style.setProperty('--focus-glass-brightness', material.brightness);
    root.style.setProperty('--focus-glass-highlight-alpha', material.highlightAlpha);
    root.style.setProperty('--focus-glass-accent-alpha', material.accentAlpha);
    root.style.setProperty('--focus-glass-shadow-alpha', material.shadowAlpha);
  }, [preferences.focusGlassTransparency]);

  return { preferences, updatePreferences };
}
