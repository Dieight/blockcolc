import {describe,it,expect} from 'vitest';
import {ApplicationService,type StateRepository,type NotificationPort} from '../src/index.js';
import type {DomainState} from '@blockcolc/domain';
const unavailable=async()=>({permission:'unavailable' as const,precision:'unavailable' as const,canSchedule:false});
const notifications:NotificationPort={requestPermission:unavailable,refreshCapability:unavailable,scheduleFocusCompletion:async()=>{},cancelFocusCompletion:async()=>{},scheduleBreakCompletion:async()=>{},cancelBreakCompletion:async()=>{}};
describe('quick-note persistence',()=>{
  it('generates identities and keeps the last durable value on save failure',async()=>{
    let state:DomainState|null=null,revision=0,fail=false,id=0;
    const repository:StateRepository={load:async()=>({state,revision}),save:async(next,expected)=>{if(fail)throw Error('quota');expect(expected).toBe(revision);state=structuredClone(next);return ++revision;}};
    const service=await ApplicationService.initialize({repository,notifications,clock:{now:()=>new Date('2026-10-11T00:00:00Z')},ids:{next:kind=>`${kind}-${++id}`},initialTimeZone:'UTC'});
    const added=await service.dispatch({type:'AddQuickNote',text:'A'});expect(added.ok).toBe(true);
    const before=service.snapshot(),note=before.quickNotes[0]!;expect(note.id).toMatch(/^quick-note-/);
    fail=true;await expect(service.dispatch({type:'SetQuickNoteCompleted',noteId:note.id,completed:true})).rejects.toThrow();
    expect(service.snapshot()).toEqual(before);fail=false;
    await service.dispatch({type:'SetQuickNoteCompleted',noteId:note.id,completed:true});
    const restored=await ApplicationService.initialize({repository,notifications,clock:{now:()=>new Date('2026-10-11T00:00:00Z')},ids:{next:kind=>`${kind}-${++id}`},initialTimeZone:'UTC'});
    expect(restored.snapshot().quickNotes[0]).toMatchObject({id:note.id,completed:true});
  });
});
