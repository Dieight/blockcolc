import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { execute } from '@blockcolc/domain';
import { IndexedDbStateRepository, StorageConflictError } from '../src/index.js';
import { projectState } from './fixture.js';
const repositories: IndexedDbStateRepository[] = [];
const fixture = () => { const repo = new IndexedDbStateRepository({ databaseName: `notes-${crypto.randomUUID()}` }); repositories.push(repo); return repo; };
afterEach(() => repositories.splice(0).forEach(repo => repo.close()));
describe('bounded quick-note updates', () => {
  it('migrates the still-raw schema-14 record on the first bounded write after upgrade',async()=>{
    const name=`notes-upgrade-${crypto.randomUUID()}`,repo=new IndexedDbStateRepository({databaseName:name});repositories.push(repo);
    const state=projectState(),revision=await repo.save(state,0);
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const open=indexedDB.open(name);open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);});
    await new Promise<void>((resolve,reject)=>{const tx=db.transaction('appState','readwrite'),store=tx.objectStore('appState'),get=store.get('current');get.onsuccess=()=>{const {birthday:_birthday,birthdayRewards:_rewards,...legacy}=get.result.state;store.put({...get.result,state:{...legacy,schemaVersion:14}});};tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});db.close();
    expect((await repo.load()).state?.schemaVersion).toBe(15);
    await repo.saveQuickNotes([{id:'n',text:'升级后便签',completed:false,createdAt:'2026-10-18T00:00:00.000Z'}],revision);
    const saved=(await repo.load()).state!;expect(saved.schemaVersion).toBe(15);expect(saved.projects).toEqual(state.projects);expect(saved.birthdayRewards).toEqual([]);expect(saved.quickNotes[0]!.text).toBe('升级后便签');
  });
  it('preserves world and active focus facts, and exports the same durable notes', async () => {
    const repo = fixture();
    const result = execute(projectState(), { type: 'StartFocus', sessionId: 'active', subtaskId: 'subtask-1', plannedDurationMs: 60000 }, { now: () => new Date('2026-10-14T00:00:00Z') });
    if (!result.ok) throw Error(result.message);
    let revision = await repo.save(result.state, 0);
    const notes = [{ id: 'n', text: '先写中文再修改', completed: false, createdAt: '2026-10-14T00:00:00.000Z' }];
    revision = await repo.saveQuickNotes(notes, revision);
    notes[0]!.text = 'caller changed';
    const stored = await repo.load();
    expect(stored).toEqual({ revision, state: { ...result.state, quickNotes: [{ ...notes[0], text: '先写中文再修改' }] } });
    const destination = fixture(); await destination.replaceFromImport(await repo.exportBackup(), 0);
    expect((await destination.load()).state).toEqual(stored.state);
    await repo.saveQuickNotes([], revision); expect((await repo.load()).state).toEqual(result.state);
  });
  it('rejects stale writers and invalid notes without losing another writer changes', async () => {
    const repo = fixture(); let revision = await repo.save(projectState(), 0);
    const notes = [{ id: 'n', text: 'saved', completed: true, createdAt: '2026-10-14T00:00:00.000Z' }];
    revision = await repo.saveQuickNotes(notes, revision);
    await expect(repo.saveQuickNotes([], revision - 1)).rejects.toBeInstanceOf(StorageConflictError);
    for (const invalid of [[...notes, ...notes], [{ ...notes[0]!, text: 'x'.repeat(201) }]]) await expect(repo.saveQuickNotes(invalid, revision)).rejects.toThrow();
    expect((await repo.load()).state?.quickNotes).toEqual(notes);
    expect((await repo.load()).revision).toBe(revision);
  });
});
