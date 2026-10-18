/** Native composition stays in the editing buffer; React only reads it. */
export function bindNativeIme(
  input: HTMLInputElement,
  onValue: (value: string) => void,
  onKeyDown: (event: KeyboardEvent) => void,
  deferCompositionUpdates = false,
  observeScriptCommits = false,
): () => void {
  let composing = false;
  let live = true;
  let queued = false;
  let published = input.value;
  let injectedCaret:{value:string;caret:number}|null=null;
  const publish = () => {
    if (!live || composing&&deferCompositionUpdates) return;
    if(published === input.value)return;
    published = input.value;
    onValue(published);
  };
  const afterNativeEdit = () => {
    if (queued) return;
    queued = true;
    // compositionupdate may precede the WebView's update of value/selection.
    queueMicrotask(() => {
      queued = false;
      // A vendor script may explicitly move to the end after assigning value.
      // Restore just this commit, before the next user event, not a stale range.
      const pending=injectedCaret;injectedCaret=null;
      if(live&&pending&&input.value===pending.value)input.setSelectionRange(pending.caret,pending.caret);
      publish();
    });
  };
  const start = () => { composing = true; };
  const end = () => { composing = false;afterNativeEdit(); };
  // OnePlus's bundled Baidu IME commits through `element.value += text`,
  // without composition/beforeinput/input events. This is not native IME
  // composition, and a compositionend repair can never see it. Observe only
  // our uncontrolled Android entry's own setter; other inputs/prototypes and
  // ordinary browser/native edits remain untouched.
  const original=Object.getOwnPropertyDescriptor(input,'value');
  let prototype=Object.getPrototypeOf(input),native:PropertyDescriptor|undefined;
  while(prototype&&!native){native=Object.getOwnPropertyDescriptor(prototype,'value');prototype=Object.getPrototypeOf(prototype);}
  const watch=observeScriptCommits&&!original&&native?.get&&native?.set;
  if(watch)Object.defineProperty(input,'value',{
    configurable:true,enumerable:native!.enumerable,
    get(){return native!.get!.call(input);},
    set(next:unknown){
      const previous=String(native!.get!.call(input)),value=String(next),start=input.selectionStart,end=input.selectionEnd;
      const focused=input.ownerDocument.activeElement===input;
      const appended=focused&&!composing&&start!==null&&end!==null&&start<previous.length&&value.length>previous.length&&value.startsWith(previous);
      if(appended){
        const text=value.slice(previous.length),corrected=previous.slice(0,start)+text+previous.slice(end);
        native!.set!.call(input,corrected);injectedCaret={value:corrected,caret:start+text.length};
      }else native!.set!.call(input,next);
      if(focused)afterNativeEdit();
    },
  });
  const key = (event: KeyboardEvent) => {
    // Some Android IMEs omit isComposing/keyCode=229 on candidate Enter.
    if (event.key === 'Enter' && composing) { event.preventDefault(); return; }
    onKeyDown(event);
  };
  input.addEventListener('compositionstart', start);
  input.addEventListener('compositionupdate', afterNativeEdit);
  input.addEventListener('compositionend', end);
  input.addEventListener('input', publish);
  input.addEventListener('change', publish);
  input.addEventListener('blur', publish);
  input.addEventListener('keydown', key);
  return () => {
    live = false;
    injectedCaret=null;
    if(watch)delete (input as Partial<HTMLInputElement>).value;
    input.removeEventListener('compositionstart', start);
    input.removeEventListener('compositionupdate', afterNativeEdit);
    input.removeEventListener('compositionend', end);
    input.removeEventListener('input', publish);
    input.removeEventListener('change', publish);
    input.removeEventListener('blur', publish);
    input.removeEventListener('keydown', key);
  };
}
