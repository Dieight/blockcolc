import type { ReactNode } from 'react';

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
  onChange: (value: T) => void;
}): ReactNode {
  return <div className="text-toggle" role="group" aria-label={ariaLabel}>
    {options.map((option) => <button key={option.value} type="button" aria-pressed={option.value === value} disabled={disabled} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}
