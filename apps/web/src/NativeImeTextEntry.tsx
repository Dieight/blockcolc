import { useLayoutEffect, useRef } from 'react';
import { bindNativeIme } from './native-ime';

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
  maxLength,
  onValueChange,
  onNativeKeyDown,
  deferCompositionUpdates=false,
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
  maxLength?: number;
  onValueChange?: (value: string) => void;
  onNativeKeyDown?: (event: KeyboardEvent) => void;
  deferCompositionUpdates?:boolean;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const initialValue = useRef(defaultValue);
  const valueChangeRef = useRef(onValueChange);
  const keyDownRef = useRef(onNativeKeyDown);
  valueChangeRef.current = onValueChange;
  keyDownRef.current = onNativeKeyDown;

  useLayoutEffect(() => {
    const element = document.createElement('input');
    element.value = initialValue.current;
    input.current = element;
    host.current?.append(element);
    const unbind = bindNativeIme(element,
      value => valueChangeRef.current?.(value), event => keyDownRef.current?.(event),deferCompositionUpdates,
      typeof window!=='undefined'&&'BlockcolcNativeInput' in window);
    return () => {
      unbind();
      input.current = null;
      element.remove();
    };
  }, []);

  // Updating a ref or autofocus must not recreate an active IME connection.
  useLayoutEffect(() => {
    const element = input.current;
    targetRef.current = element;
    return () => { if (targetRef.current === element) targetRef.current = null; };
  }, [targetRef]);

  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    // Configure editing attributes before autofocus. Leave unchanged attributes
    // untouched so rerenders do not mutate the focused editing element.
    if (element.name !== name) element.name = name;
    if (element.id !== (id ?? '')) element.id = id ?? '';
    if (element.disabled !== disabled) element.disabled = disabled;
    if (element.required !== required) element.required = required;
    if (element.placeholder !== (placeholder ?? '')) element.placeholder = placeholder ?? '';
    if (maxLength !== undefined && element.maxLength !== maxLength) element.maxLength = maxLength;
    else if (maxLength === undefined && element.hasAttribute('maxlength')) element.removeAttribute('maxlength');
    if (ariaLabel && element.getAttribute('aria-label') !== ariaLabel) element.setAttribute('aria-label', ariaLabel);
    else if (!ariaLabel && element.hasAttribute('aria-label')) element.removeAttribute('aria-label');
  }, [ariaLabel, disabled, id, name, placeholder, required, maxLength]);

  useLayoutEffect(() => {
    const element = input.current;
    if (autoFocus && element && document.activeElement !== element) element.focus();
  }, [autoFocus]);

  return <span className="native-ime-entry" ref={host}/>;
}
