import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PixelCheck as Check, PixelChevron as ChevronDown } from './ui/PixelIcon';
import { choiceMenuPosition } from './choice-menu-position';

export interface ChoiceOption { id: string; label: string; detail?: string }

export function ChoiceMenu({ label, value, options, disabled, floating = false, onChange }: {
  label: string;
  value: string;
  options: readonly ChoiceOption[];
  disabled?: boolean;
  /** Escape card backdrop stacking and flip above a low trigger when needed. */
  floating?: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<ReturnType<typeof choiceMenuPosition> | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find(option => option.id === value) ?? options[0];

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !list.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, []);

  useLayoutEffect(() => {
    if (!open || !floating) { setPosition(null); return; }
    const place = () => {
      if (!trigger.current || !list.current) return;
      const viewport = window.visualViewport;
      const top = (viewport?.offsetTop ?? 0) + 8;
      const viewportBottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - 8;
      const nav = document.querySelector('[aria-label="主导航"]')?.getBoundingClientRect();
      const bottom = nav && nav.height > 0 && nav.top > top ? Math.min(viewportBottom, nav.top - 8) : viewportBottom;
      setPosition(choiceMenuPosition(trigger.current.getBoundingClientRect(), {
        left: (viewport?.offsetLeft ?? 0) + 8,
        right: (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth) - 8,
        top, bottom,
      }, list.current.scrollHeight + 2));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    const resize = new ResizeObserver(place);
    if (trigger.current) resize.observe(trigger.current);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
      resize.disconnect();
    };
  }, [open, floating, options.length]);

  const menu = open && <div ref={list} id={listId}
    className={`choice-menu-options${floating ? ' is-floating' : ''}`}
    style={floating ? { ...position, visibility: position ? 'visible' : 'hidden' } : undefined}
    role="listbox" aria-label={label}
    onKeyDown={event => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const buttons = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (current + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }}>
    {options.map(option => <button key={option.id} type="button" role="option" aria-selected={option.id === value}
      onClick={() => { onChange(option.id); setOpen(false); trigger.current?.focus(); }}>
      <span><strong>{option.label}</strong>{option.detail && <small>{option.detail}</small>}</span>
      {option.id === value && <Check aria-hidden="true"/>}
    </button>)}
  </div>;

  return <div className="choice-menu" ref={root}>
    <span className="choice-menu-label">{label}</span>
    <button ref={trigger} type="button" className="choice-menu-trigger" aria-haspopup="listbox"
      aria-expanded={open} aria-controls={listId} disabled={disabled || options.length === 0}
      onClick={() => setOpen(value => !value)}
      onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }}>
      <span><strong>{selected?.label ?? '没有可选项'}</strong>{selected?.detail && <small>{selected.detail}</small>}</span>
      <ChevronDown aria-hidden="true"/>
    </button>
    {floating ? menu && createPortal(menu, document.body) : menu}
  </div>;
}
