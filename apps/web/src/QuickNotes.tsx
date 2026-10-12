import { useEffect, useRef, useState } from 'react';
import type { ApplicationCommand, ApplicationResult } from '@blockcolc/application';
import type { DomainState } from '@blockcolc/domain';
import { t, useI18n } from './i18n';
import { PixelPlus, PixelClose, PixelChevron, PixelTasks } from './ui/PixelIcon';
import { isImeCommitKey, NativeImeTextEntry } from './NativeImeTextEntry';

export function QuickNotes({ state, run, compact = false }: { state: DomainState; run: (command: ApplicationCommand) => Promise<ApplicationResult>; compact?: boolean }) {
  useI18n();
  const [draft, setDraft] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [pendingCheck, setPendingCheck] = useState<{ id: string; completed: boolean } | null>(null);
  useEffect(() => {
    if (pendingCheck && state.quickNotes.find(note => note.id === pendingCheck.id)?.completed === pendingCheck.completed) setPendingCheck(null);
  }, [state.quickNotes, pendingCheck]);
  const lane = useRef(false);
  const entry = useRef<HTMLInputElement>(null);
  const save = async (command: ApplicationCommand) => {
    if (lane.current) return;
    lane.current = true; setBusy(true); setError('');
    if (command.type === 'SetQuickNoteCompleted') setPendingCheck({ id: command.noteId, completed: command.completed });
    try { const result = await run(command); if (!result.ok) { setPendingCheck(null); setError(t('便签未保存，请重试。')); return; } if (command.type === 'AddQuickNote') { if (entry.current) entry.current.value=''; setDraft(''); } }
    catch { setPendingCheck(null); setError(t('便签未保存，请重试。')); }
    finally { lane.current = false; setBusy(false); }
  };
  const notes = state.quickNotes.map(note=>({...note,completed:pendingCheck?.id===note.id ? pendingCheck.completed : note.completed}));
  const active = notes.filter(note=>!note.completed), completed = notes.filter(note=>note.completed);
  const rows = (items:typeof notes) => <ul>{items.map(note => <li key={note.id} data-completed={note.completed}>
      <label><input type="checkbox" checked={note.completed} disabled={busy} aria-label={t('完成便签：{0}',note.text)} onChange={()=>void save({type:'SetQuickNoteCompleted',noteId:note.id,completed:!note.completed})}/><span>{note.text}</span></label>
      <button type="button" aria-label={t('删除便签：{0}',note.text)} disabled={busy} onClick={()=>void save({type:'DeleteQuickNote',noteId:note.id})}><PixelClose size={16}/></button>
    </li>)}</ul>;
  return <section className={`quick-notes${compact?' quick-notes--compact':' task-surface'}`} aria-label={t('简易便签')}>
    <header className="quick-notes-heading"><h2><PixelTasks size={20}/>{t('简易便签')}</h2><span>{active.length}</span></header>
    <div className="quick-notes-scroll">
      {active.length>0 && rows(active)}
      {completed.length>0 && <details className="quick-notes-completed"><summary>{t('已完成便签')}<span>{completed.length}</span><PixelChevron size={16}/></summary>{rows(completed)}</details>}
    </div>
    <form onSubmit={event=>{event.preventDefault();const text=(entry.current?.value??draft).trim();if(text)void save({type:'AddQuickNote',text});}}>
      <NativeImeTextEntry targetRef={entry} name="quick-note" defaultValue="" ariaLabel={t('写一条便签')} placeholder={t('写一条便签')} maxLength={200} disabled={busy||state.quickNotes.length>=100} onValueChange={setDraft} onNativeKeyDown={event=>{if(event.key==='Enter'&&!isImeCommitKey(event))event.preventDefault();}}/>
      <button type="submit" aria-label={t('添加便签')} disabled={busy||!draft.trim()||state.quickNotes.length>=100} aria-busy={busy}><PixelPlus size={18}/></button>
    </form>
    {error&&<p role="alert">{error}</p>}
  </section>;
}
