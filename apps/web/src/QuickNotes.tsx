import { useRef, useState } from 'react';
import type { ApplicationCommand, ApplicationResult } from '@blockcolc/application';
import type { DomainState, QuickNote } from '@blockcolc/domain';
import { t, useI18n } from './i18n';
import { PixelPlus, PixelClose, PixelChevron, PixelNote, PixelCheck } from './ui/PixelIcon';
import { isImeCommitKey, NativeImeTextEntry } from './NativeImeTextEntry';
import { useBackLayer } from './back-layer';
import { AnimatedDetails } from './ui/AnimatedDetails';

type PendingNote = { note: QuickNote; deleted?: boolean; adding?: boolean; completing?: boolean; striking?:boolean };
// Paint local feedback before the application serializes a large world.
const paintFeedback = () => new Promise<void>(resolve => { const timeout = setTimeout(resolve, 48); requestAnimationFrame(() => setTimeout(() => { clearTimeout(timeout); resolve(); }, 0)); });

export function QuickNotes({ state, run, compact = false }: { state: DomainState; run: (command: ApplicationCommand) => Promise<ApplicationResult>; compact?: boolean }) {
  useI18n();
  const [draft, setDraft] = useState(''), [error, setError] = useState('');
  const [pending, setPending] = useState<Record<string, PendingNote>>({});
  const pendingRef = useRef(pending);
  const [editing, setEditing] = useState<QuickNote | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [failedDrafts, setFailedDrafts] = useState<Record<string, QuickNote>>({});
  const entry = useRef<HTMLInputElement>(null), editEntry = useRef<HTMLInputElement>(null);
  const live = useRef(state); live.current = state;
  const patchPending = (id: string, value?: PendingNote) => {
    const next = { ...pendingRef.current };
    if (value) next[id] = value; else delete next[id];
    pendingRef.current = next; setPending(next);
  };
  useBackLayer(Boolean(editing), () => { setEditing(null); return true; });
  const save = async (command: ApplicationCommand, id: string, optimistic: PendingNote) => {
    if (pendingRef.current[id]) return;
    patchPending(id, optimistic); setError('');
    await paintFeedback();
    try {
      const result = await run(command);
      if (!result.ok) throw new Error('not saved');
      if(optimistic.completing&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
        // Start after the write so serialization cannot consume the visible
        // strike. Keep the original row until its short receipt is painted.
        patchPending(id,{...optimistic,striking:true});await paintFeedback();
        await new Promise<void>(resolve=>setTimeout(resolve,180));
      }
      patchPending(id);
      if (command.type !== 'SetQuickNoteCompleted') setFailedDrafts(previous => { const next = { ...previous }; delete next[id]; return next; });
    } catch {
      patchPending(id); setError(t('便签未保存，请重试。'));
      // Retain failed text separately; never overwrite a newer input draft.
      if (optimistic.adding || command.type === 'RenameQuickNote') {
        setFailedDrafts(previous => ({ ...previous, [id]: optimistic.note }));
      }
    }
  };
  const add = () => {
    const text = (entry.current?.value ?? draft).trim();
    if (text.length > 200) { setError(t('便签最多 200 字。')); return; }
    if (!text || live.current.quickNotes.length + Object.values(pendingRef.current).filter(item => item.adding).length >= 100) return;
    const id = `draft-${crypto.randomUUID()}`;
    const note = { id, text, completed: false, createdAt: new Date().toISOString() };
    if (entry.current) entry.current.value = '';
    setDraft(''); void save({ type: 'AddQuickNote', text }, id, { note, adding: true });
  };
  const beginEdit = (note: QuickNote) => {
    if (pendingRef.current[note.id]) return;
    const draft = failedDrafts[note.id] ?? note;
    setEditing(draft); setEditDraft(draft.text);
  };
  const finishEdit = () => {
    if (!editing) return;
    const text = (editEntry.current?.value ?? editDraft).trim();
    if (!text) return;
    if (text.length > 200) { setError(t('便签最多 200 字。')); return; }
    const note = { ...editing, text };
    setEditing(null);
    const existing = live.current.quickNotes.some(item => item.id === note.id);
    void save(existing ? { type: 'RenameQuickNote', noteId: note.id, text } : { type: 'AddQuickNote', text }, note.id, { note, adding: !existing });
  };
  const toggle = (note: QuickNote) => {
    if (pendingRef.current[note.id]) return;
    void save({ type: 'SetQuickNoteCompleted', noteId: note.id, completed: !note.completed }, note.id,
      note.completed?{note:{...note,completed:false}}:{note,completing:true});
  };
  const notes = state.quickNotes.flatMap(note => pending[note.id]?.deleted ? [] : [pending[note.id]?.note ?? note]);
  notes.push(...Object.values(pending).filter(item => item.adding).map(item => item.note));
  notes.push(...Object.values(failedDrafts).filter(note => !pending[note.id]?.deleted && !notes.some(item => item.id === note.id)));
  const active = notes.filter(note => !note.completed);
  const completed = notes.filter(note => note.completed);
  const editor = (note: QuickNote) => <div className="quick-note-editor">
    <NativeImeTextEntry key={note.id} deferCompositionUpdates targetRef={editEntry} name="edit-quick-note" defaultValue={note.text} autoFocus ariaLabel={t('修改便签')} onValueChange={setEditDraft} onNativeKeyDown={event => { if (isImeCommitKey(event)) { event.preventDefault(); finishEdit(); } if (event.key === 'Escape') setEditing(null); }}/>
    <button type="button" aria-label={t('保存便签')} disabled={!editDraft.trim()} onClick={finishEdit}><PixelCheck size={18}/></button>
    <button type="button" aria-label={t('取消修改')} onClick={() => setEditing(null)}><PixelClose size={18}/></button>
  </div>;
  const rows = (items: QuickNote[]) => <ul>{items.map(note => <li key={note.id} data-completed={note.completed} data-completing={pending[note.id]?.completing||undefined} data-striking={pending[note.id]?.striking||undefined} aria-busy={Boolean(pending[note.id])}>
    {editing?.id === note.id ? editor(editing) : <>
      <label><input type="checkbox" checked={note.completed||pending[note.id]?.completing===true} disabled={Boolean(pending[note.id]) || !state.quickNotes.some(item => item.id === note.id)} aria-label={t('完成便签：{0}', note.text)} onChange={() => toggle(note)}/>
      <span role="button" tabIndex={0} aria-label={t('修改便签：{0}', note.text)} onClick={event => { event.preventDefault(); if (event.detail === 0) beginEdit(note); }} onDoubleClick={event => { event.preventDefault(); beginEdit(note); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); beginEdit(note); } }}><span className="quick-note-text">{note.text}</span>{failedDrafts[note.id] && <small className="quick-note-unsaved">{t('未保存，双击重试')}</small>}</span></label>
      <button type="button" aria-label={t('删除便签：{0}', note.text)} disabled={Boolean(pending[note.id])} onClick={() => { if (state.quickNotes.some(item => item.id === note.id)) void save({ type: 'DeleteQuickNote', noteId: note.id }, note.id, { note, deleted: true }); else setFailedDrafts(previous => { const next = { ...previous }; delete next[note.id]; return next; }); }}><PixelClose size={16}/></button>
    </>}
  </li>)}</ul>;
  return <section className={`quick-notes${compact ? ' quick-notes--compact' : ' task-surface'}`} aria-label={t('简易便签')}>
    <header className="quick-notes-heading"><h2><PixelNote size={20}/>{t('简易便签')}</h2><span>{notes.filter(note => !note.completed).length}</span></header>
    <div className="quick-notes-scroll">
      {active.length > 0 && rows(active)}
      {completed.length > 0 && <AnimatedDetails className="quick-notes-completed" summary={<>{t('已完成便签')}<span>{completed.length}</span><PixelChevron size={16}/></>}>{rows(completed)}</AnimatedDetails>}
    </div>
    {editing && !notes.some(note => note.id === editing.id) && editor(editing)}
    <form onSubmit={event => { event.preventDefault(); add(); }}>
      <NativeImeTextEntry deferCompositionUpdates targetRef={entry} name="quick-note" defaultValue="" ariaLabel={t('写一条便签')} placeholder={t('写一条便签')} disabled={notes.length >= 100} onValueChange={setDraft} onNativeKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (isImeCommitKey(event)) add(); } }}/>
      <button type="submit" aria-label={t('添加便签')} disabled={!draft.trim() || notes.length >= 100}><PixelPlus size={18}/></button>
    </form>
    {error && <p role="alert">{error}</p>}
  </section>;
}
