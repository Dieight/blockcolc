import {describe,it,expect} from 'vitest';
import {createInitialState,execute,parseDomainState,type DomainCommand} from '../src/index.js';
const clock={now:()=>new Date('2026-10-11T00:00:00Z')};
describe('durable quick notes',()=>{
  it('migrates a real schema-13 record without changing any old facts',()=>{
    const {quickNotes:_notes,...legacy}=createInitialState('UTC');
    const upgraded=parseDomainState({...legacy,schemaVersion:13});
    expect(upgraded).toEqual({...legacy,schemaVersion:14,quickNotes:[]});
  });
  it('adds, strikes and deletes without touching focus or project facts',()=>{
    let state=createInitialState('UTC');const before=structuredClone(state);
    const run=(command:DomainCommand)=>{const result=execute(state,command,clock);expect(result.ok).toBe(true);if(result.ok)state=result.state;};
    run({type:'AddQuickNote',noteId:'n',text:'  买牛奶  '});
    expect(state.quickNotes).toEqual([{id:'n',text:'买牛奶',completed:false,createdAt:clock.now().toISOString()}]);
    run({type:'SetQuickNoteCompleted',noteId:'n',completed:true});
    expect(parseDomainState(state)).toEqual(state);expect(state.quickNotes[0]!.completed).toBe(true);
    run({type:'SetQuickNoteCompleted',noteId:'n',completed:false});
    run({type:'DeleteQuickNote',noteId:'n'});expect(state).toEqual(before);
  });
  it('rejects empty, duplicate, oversized and unknown notes without mutation',()=>{
    const added=execute(createInitialState(),{type:'AddQuickNote',noteId:'n',text:'original'},clock);if(!added.ok)throw Error(added.message);
    const before=structuredClone(added.state);
    for(const command of [
      {type:'AddQuickNote',noteId:'n',text:'duplicate'}, {type:'AddQuickNote',noteId:'x',text:' '},
      {type:'AddQuickNote',noteId:'x',text:'a'.repeat(201)}, {type:'DeleteQuickNote',noteId:'missing'},
      {type:'SetQuickNoteCompleted',noteId:'missing',completed:true},
    ] satisfies DomainCommand[]){expect(execute(added.state,command,clock).ok).toBe(false);expect(added.state).toEqual(before);}
    expect(()=>parseDomainState({...before,quickNotes:[...before.quickNotes,...before.quickNotes]})).toThrow();
    expect(()=>parseDomainState({...before,quickNotes:[{...before.quickNotes[0],completed:'true'}]})).toThrow();
  });
});
