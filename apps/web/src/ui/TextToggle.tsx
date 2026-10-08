import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface TextToggleOption<T extends string> {
  value: T;
  label: ReactNode;
}

/** A single travelling selection surface; committed value stays authoritative. */
export function TextToggle<T extends string>({ ariaLabel, value, options, disabled = false, onChange, className = '' }: {
  ariaLabel: string;
  value: T;
  options: ReadonlyArray<TextToggleOption<T>>;
  disabled?: boolean;
  className?: string;
  onChange: (value: T) => void | Promise<unknown>;
}): ReactNode {
  const [pending, setPending] = useState<T | null>(null);
  const busy = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ x: number; width: number } | null>(null);
  const selected = pending ?? value;
  useLayoutEffect(() => {
    const group = root.current;
    if (!group) return;
    const measure = () => {
      const button = Array.from(group.querySelectorAll('button')).find(item => item.dataset.value === selected);
      if (!button) return;
      setIndicator(current => current?.x === button.offsetLeft && current.width === button.offsetWidth
        ? current : { x: button.offsetLeft, width: button.offsetWidth });
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(group);
    return () => observer.disconnect();
  }, [selected, options]);
  const select = async (next: T) => {
    if (disabled || busy.current || next === value) return;
    busy.current = true; setPending(next);
    try { await onChange(next); }
    catch { /* The owning command/preference handler reports its failure. */ }
    finally { busy.current = false; setPending(null); }
  };
  return <div ref={root} className={`text-toggle${className ? ` ${className}` : ''}`} data-indicator-ready={indicator!==null?'true':undefined} role="group" aria-label={ariaLabel}>
    {indicator&&<span className="text-toggle-selection" aria-hidden="true" style={{width:indicator.width,transform:`translateX(${indicator.x}px)`}}/>}
    {options.map((option) => <button key={option.value} data-value={option.value} type="button" aria-pressed={option.value === value} aria-busy={pending === option.value} disabled={disabled || pending !== null} onClick={() => void select(option.value)}>{option.label}</button>)}
  </div>;
}
