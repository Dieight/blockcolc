import { useRef, useState, type ReactNode } from 'react';

export interface TextToggleOption<T extends string> {
  value: T;
  label: string;
}

/**
 * iOS-style segmented control (V27). Visual skin lives in `settings.css`
 * (`.text-toggle`); every consumer must keep the 44px touch height contract
 * that the shared skin enforces.
 */
export function TextToggle<T extends string>({ ariaLabel, value, options, disabled = false, onChange }: {
  ariaLabel: string;
  value: T;
  options: ReadonlyArray<TextToggleOption<T>>;
  disabled?: boolean;
  onChange: (value: T) => void | Promise<unknown>;
}): ReactNode {
  const [pending, setPending] = useState<T | null>(null);
  const busy = useRef(false);
  const select = async (next: T) => {
    if (disabled || busy.current || next === value) return;
    busy.current = true; setPending(next);
    try { await onChange(next); }
    catch { /* The owning command/preference handler reports its failure. */ }
    finally { busy.current = false; setPending(null); }
  };
  return <div className="text-toggle" role="group" aria-label={ariaLabel}>
    {options.map((option) => <button key={option.value} type="button" aria-pressed={option.value === value} aria-busy={pending === option.value} disabled={disabled || pending !== null} onClick={() => void select(option.value)}>{option.label}</button>)}
  </div>;
}
