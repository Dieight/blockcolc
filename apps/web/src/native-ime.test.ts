import { describe, expect, it, vi } from 'vitest';
import { bindNativeIme } from './native-ime';

class EditingBuffer extends EventTarget {
  value = '今天读书';
  selectionStart = 2;
  selectionEnd = 2;
  setSelectionRange(start:number,end:number){this.selectionStart=start;this.selectionEnd=end;}
}
const key = (name: string) => Object.assign(new Event('keydown', { cancelable: true }), { key: name, isComposing: false, keyCode: 13 }) as KeyboardEvent;
const nextMicrotask = () => new Promise<void>(resolve => queueMicrotask(resolve));

describe('native IME editing buffer', () => {
  it('reads composition updates after native buffer mutation, without resetting selection', async () => {
    const input = new EditingBuffer(), changed = vi.fn();
    const stop = bindNativeIme(input as unknown as HTMLInputElement, changed, vi.fn());
    input.dispatchEvent(new Event('compositionstart'));
    input.dispatchEvent(new Event('compositionupdate'));
    expect(changed).not.toHaveBeenCalled();
    input.value = '今天认真读书'; input.selectionStart = input.selectionEnd = 4;
    await nextMicrotask();
    expect(changed.mock.calls).toEqual([['今天认真读书']]);
    expect([input.selectionStart, input.selectionEnd]).toEqual([4, 4]);
    input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('compositionend'));
    await nextMicrotask();
    expect(changed).toHaveBeenCalledTimes(1);
    stop();
  });
  it('does not rewrite a normal middle insertion, replacement, deletion or intentional end append',async()=>{
    for(const [start,end,result,text] of [[2,2,'今天认真读书','认真'],[2,4,'今天学习','学习'],[2,4,'今天',''],[4,4,'今天读书认真','认真']] as const){
      const input=new EditingBuffer();input.setSelectionRange(start,end);const stop=bindNativeIme(input as unknown as HTMLInputElement,vi.fn(),vi.fn(),true);
      input.dispatchEvent(new Event('compositionstart'));input.value=result;
      input.dispatchEvent(Object.assign(new Event('compositionend'),{data:text}));await nextMicrotask();expect(input.value).toBe(result);stop();
    }
  });
  it('leaves native undo and a later end append unchanged after a normal commit',async()=>{
    const input=new EditingBuffer(),stop=bindNativeIme(input as unknown as HTMLInputElement,vi.fn(),vi.fn(),true);
    input.dispatchEvent(new Event('compositionstart'));input.value='今天认真读书';input.dispatchEvent(Object.assign(new Event('compositionend'),{data:'认真'}));await nextMicrotask();
    input.value='今天读书';input.dispatchEvent(new Event('input'));
    input.value='今天读书认真';input.setSelectionRange(6,6);input.dispatchEvent(new Event('input'));
    expect(input.value).toBe('今天读书认真');expect(input.selectionStart).toBe(6);stop();
  });
  it('does not submit candidate Enter even when an Android IME omits composing flags', () => {
    const input = new EditingBuffer(), pressed = vi.fn();
    const stop = bindNativeIme(input as unknown as HTMLInputElement, vi.fn(), pressed);
    input.dispatchEvent(new Event('compositionstart'));
    const candidate = key('Enter'); input.dispatchEvent(candidate);
    expect(candidate.defaultPrevented).toBe(true); expect(pressed).not.toHaveBeenCalled();
    input.dispatchEvent(new Event('compositionend'));
    const confirm = key('Enter'); input.dispatchEvent(confirm);
    expect(pressed).toHaveBeenCalledWith(confirm);
    stop();
  });
  it('ignores queued notifications after unmount and never publishes a stale cleanup value', async () => {
    const input = new EditingBuffer(), changed = vi.fn();
    const stop = bindNativeIme(input as unknown as HTMLInputElement, changed, vi.fn());
    input.dispatchEvent(new Event('compositionupdate'));
    input.value = '未完成候选'; stop(); await nextMicrotask();
    input.dispatchEvent(new Event('input'));
    expect(changed).not.toHaveBeenCalled();
  });
  it('retains the final Android commit when input precedes or follows compositionend', async () => {
    for (const order of [['input', 'compositionend'], ['compositionend', 'input']]) {
      const input = new EditingBuffer(), changed = vi.fn();
      const stop = bindNativeIme(input as unknown as HTMLInputElement, changed, vi.fn());
      input.dispatchEvent(new Event('compositionstart'));
      input.value = '今天认真地读书';
      for (const type of order) input.dispatchEvent(new Event(type));
      await nextMicrotask();
      expect(changed.mock.calls).toEqual([['今天认真地读书']]); stop();
    }
  });
});

class ScriptCommitBuffer extends EventTarget {
  private buffer='今天读书';
  selectionStart=2;selectionEnd=2;
  ownerDocument:{activeElement:ScriptCommitBuffer|null}={activeElement:this};
  get value(){return this.buffer;}
  set value(next:string){this.buffer=String(next);this.selectionStart=this.selectionEnd=this.buffer.length;}
  setSelectionRange(start:number,end:number){this.selectionStart=start;this.selectionEnd=end;}
}
describe('Android vendor script commits',()=>{
  it('inserts script-appended Chinese at the native caret without relying on missing input events',async()=>{
    const input=new ScriptCommitBuffer(),changed=vi.fn(),stop=bindNativeIme(input as unknown as HTMLInputElement,changed,vi.fn(),true,true);
    input.value+='认真';await nextMicrotask();
    expect(input.value).toBe('今天认真读书');expect(input.selectionStart).toBe(4);expect(changed).toHaveBeenLastCalledWith('今天认真读书');
    input.value+='地';await nextMicrotask();expect(input.value).toBe('今天认真地读书');expect(input.selectionStart).toBe(5);
    stop();expect(Object.hasOwn(input,'value')).toBe(false);
  });
  it('handles selected text and a vendor that resets selection after assigning',async()=>{
    const input=new ScriptCommitBuffer(),stop=bindNativeIme(input as unknown as HTMLInputElement,vi.fn(),vi.fn(),false,true);
    input.setSelectionRange(2,4);input.value+='学习';input.setSelectionRange(input.value.length,input.value.length);await nextMicrotask();
    expect(input.value).toBe('今天学习');expect(input.selectionStart).toBe(4);stop();
  });
  it('leaves intentional end typing, resets, non-appends and blurred writes unchanged',async()=>{
    const input=new ScriptCommitBuffer(),stop=bindNativeIme(input as unknown as HTMLInputElement,vi.fn(),vi.fn(),false,true);
    input.setSelectionRange(4,4);input.value+='认真';await nextMicrotask();expect(input.value).toBe('今天读书认真');
    input.value='明天读书';await nextMicrotask();expect(input.value).toBe('明天读书');
    input.setSelectionRange(2,2);input.ownerDocument.activeElement=null;input.value+='认真';await nextMicrotask();expect(input.value).toBe('明天读书认真');
    input.value='';await nextMicrotask();expect(input.value).toBe('');stop();
  });
  it('does not touch native composition buffers or non-Android/browser entries',async()=>{
    for(const enabled of [true,false]){
      const input=new ScriptCommitBuffer(),stop=bindNativeIme(input as unknown as HTMLInputElement,vi.fn(),vi.fn(),true,enabled);
      if(enabled)input.dispatchEvent(new Event('compositionstart'));
      input.value+='认真';await nextMicrotask();expect(input.value).toBe('今天读书认真');
      stop();
    }
  });
  it('does not overwrite existing framework setters or publish queued work after unmount',async()=>{
    const input=new ScriptCommitBuffer(),ownSet=vi.fn();Object.defineProperty(input,'value',{get:()=> '今天读书',set:ownSet,configurable:true});
    const stop=bindNativeIme(input as unknown as HTMLInputElement,vi.fn(),vi.fn(),true,true);input.value='外部控制';expect(ownSet).toHaveBeenCalledWith('外部控制');stop();expect(Object.getOwnPropertyDescriptor(input,'value')?.set).toBe(ownSet);
    const other=new ScriptCommitBuffer(),changed=vi.fn(),unbind=bindNativeIme(other as unknown as HTMLInputElement,changed,vi.fn(),true,true);
    other.value+='认真';unbind();await nextMicrotask();expect(changed).not.toHaveBeenCalled();
  });
});
