import { useEffect, useLayoutEffect, useRef } from 'react';

export type NativeImeInputRef = { current: HTMLInputElement | null };

export function isImeCommitKey(event: KeyboardEvent): boolean {
  return event.key === 'Enter' && !event.isComposing && event.keyCode !== 229;
}

export function NativeImeTextEntry({
  targetRef,
  name,
  defaultValue,
  id,
  ariaLabel,
  placeholder,
  disabled = false,
  required = false,
  autoFocus = false,
  onValueChange,
  onNativeKeyDown,
}: {
  targetRef: NativeImeInputRef;
  name: string;
  defaultValue: string;
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  onValueChange?: (value: string) => void;
  onNativeKeyDown?: (event: KeyboardEvent) => void;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const initialValue = useRef(defaultValue);
  const valueChangeRef = useRef(onValueChange);
  const keyDownRef = useRef(onNativeKeyDown);
  valueChangeRef.current = onValueChange;
  keyDownRef.current = onNativeKeyDown;

  useLayoutEffect(() => {
    const element = document.createElement('input');
    element.value = initialValue.current;
    targetRef.current = element;
    host.current?.append(element);

    // Android WebView can update the native editing buffer before React emits
    // a synthetic change. Retain every native commit boundary, while the DOM
    // remains the source of truth read by submit handlers.
    const retain = () => valueChangeRef.current?.(element.value);
    const keydown = (event: KeyboardEvent) => keyDownRef.current?.(event);
    for (const type of ['input', 'compositionupdate', 'compositionend', 'change', 'blur']) {
      element.addEventListener(type, retain);
    }
    element.addEventListener('keydown', keydown);
    if (autoFocus) window.requestAnimationFrame(() => element.focus());

    return () => {
      retain();
      for (const type of ['input', 'compositionupdate', 'compositionend', 'change', 'blur']) {
        element.removeEventListener(type, retain);
      }
      element.removeEventListener('keydown', keydown);
      if (targetRef.current === element) targetRef.current = null;
      element.remove();
    };
  }, [autoFocus, targetRef]);

  useEffect(() => {
    const element = targetRef.current;
    if (!element) return;
    element.name = name;
    element.id = id ?? '';
    element.disabled = disabled;
    element.required = required;
    element.placeholder = placeholder ?? '';
    if (ariaLabel) element.setAttribute('aria-label', ariaLabel);
    else element.removeAttribute('aria-label');
  }, [ariaLabel, disabled, id, name, placeholder, required, targetRef]);

  return <span className="native-ime-entry" ref={host}/>;
}
