import { describe, expect, it } from 'vitest';
import { createInitialState, execute, parseDomainState, holidaysForYear, holidaysOnDate, holidayEmblemsOnDate, carnivalDate, type DomainCommand } from '../src/index.js';

function fixture(kind:'finite'|'habit'='habit',zone='UTC',targetRounds=10,initial='2026-11-01T08:00:00Z'){
 let now=Date.parse(initial),state=createInitialState(zone);
 const run=(command:DomainCommand)=>{const r=execute(state,command,{now:()=>new Date(now)});if(!r.ok)throw new Error(r.message);state=r.state;expect(parseDomainState(state)).toEqual(state);return r;};
 run(kind==='habit'?{type:'CreateHabitProject',projectId:'p',title:'习惯',blueprintId:'cottage',targetRounds}:{type:'CreateProject',projectId:'p',title:'建造',blueprintId:'cottage',subtasks:[{id:'s',title:'施工'}]});
 const start=(id:string,deferred=false)=>run({type:'StartFocus',sessionId:id,subtaskId:kind==='habit'||deferred?null:'s',plannedDurationMs:60_000,...(deferred?{marathon:true,deferredSettlement:true}:{})});
 return{run,start,state:()=>state,set:(iso:string)=>{now=Date.parse(iso);},advance:(ms:number)=>{now+=ms;}};
}
describe('approved offline festival calendar',()=>{
 it('uses twenty unique celebrations and explicit non-leap lunar months',()=>{
  for(const [year,dates] of [[2026,['2026-02-17','2026-03-03','2026-06-19','2026-09-25']],[2027,['2027-02-06','2027-02-20','2027-06-09','2027-09-15']]] as const){
   const h=holidaysForYear(year);expect(h).toHaveLength(20);expect(new Set(h.map(x=>x.id)).size).toBe(20);
   expect(h.find(x=>x.id==='china-national')!.date).toBe(`${year}-10-01`);
   expect(h.find(x=>x.id==='us-independence')!.date).toBe(`${year}-07-04`);
   expect(['spring-festival','lantern','dragon-boat','mid-autumn'].map(id=>h.find(x=>x.id===id)!.date)).toEqual(dates);
  }
  expect(holidaysForYear(2033).filter(x=>x.id==='spring-festival')).toHaveLength(1);
  expect(carnivalDate(2026)).toBe('2026-02-17');expect(carnivalDate(2027)).toBe('2027-02-09');
  expect(holidaysForYear(2028).find(x=>x.id==='oktoberfest')!.date).toBe('2028-09-16');
 });
 it('keeps a three-local-day window, stable overlapping priority and at most three emblems',()=>{
  for(const date of ['2026-12-25','2026-12-26','2026-12-27'])expect(holidaysOnDate(date).map(x=>x.id)).toContain('christmas');
  expect(holidaysOnDate('2026-12-28')).toEqual([]);
  expect(holidaysOnDate('2026-11-01').map(x=>x.id)).toEqual(['halloween','day-of-dead']);
  expect(holidayEmblemsOnDate('2026-11-01')).toHaveLength(3);
  expect(holidayEmblemsOnDate('2026-06-03').map(x=>x.emblem)).toEqual(['风车','积木','气球']);
  expect(holidayEmblemsOnDate('2026-06-04')).toEqual([]);
  expect(holidaysOnDate('2027-01-01').map(x=>x.id)).toContain('new-year');
 });
});
describe('annual keepsake is a saved effective-round fact',()=>{
 it.each(['finite','habit'] as const)('grants all overlapping holidays with daily goal off (%s)',kind=>{
  const f=fixture(kind);f.run({type:'DisableDailyGoal',date:'2026-11-01'});f.start('round');f.advance(60_000);
  const result=f.run({type:'CompleteFocus'});expect(f.state().holidayRewards.map(x=>x.holidayId)).toEqual(['halloween','day-of-dead']);
  expect(result.events.filter(x=>x.type==='HolidayRewardGranted')).toHaveLength(2);
  expect(f.state().holidayRewards.every(x=>x.sourceSessionId==='round'&&x.settlementIndex===0)).toBe(true);
 });
 it('never grants interrupted/invalid rounds or retroactively when adjusting a goal',()=>{
  const f=fixture();f.run({type:'SetDailyGoal',date:'2026-11-01',targetPomodoros:1});expect(f.state().holidayRewards).toEqual([]);
  f.start('cancelled');f.advance(1000);f.run({type:'CancelFocus'});expect(f.state().holidayRewards).toEqual([]);
  f.start('invalid');expect(execute(f.state(),{type:'CompleteFocus'},{now:()=>new Date('2026-11-01T08:00:01Z')})).toMatchObject({ok:false});expect(f.state().holidayRewards).toEqual([]);
 });
 it('deduplicates within the window and after reload, but allows the following year',()=>{
  const f=fixture();f.start('one');f.advance(60_000);f.run({type:'CompleteFocus'});
  f.set('2026-11-02T08:00:00Z');f.start('two');f.advance(60_000);expect(f.run({type:'CompleteFocus'}).events.filter(x=>x.type==='HolidayRewardGranted')).toEqual([]);
  f.set('2027-11-01T08:00:00Z');f.start('three');f.advance(60_000);f.run({type:'CompleteFocus'});
  expect(f.state().holidayRewards).toHaveLength(4);expect(new Set(f.state().holidayRewards.map(x=>`${x.holidayId}:${x.year}`)).size).toBe(4);
 });
 it('uses completion local date for a round crossing midnight and handles early/deferred focus',()=>{
  const f=fixture('finite','Asia/Shanghai');f.set('2026-12-24T15:59:40Z');f.start('deferred',true);f.advance(25_000);f.run({type:'CompleteFocusEarly',reportId:'unused'});
  expect(f.state().holidayRewards[0]).toMatchObject({holidayId:'christmas',date:'2026-12-25',sourceSessionId:'deferred'});
  expect(f.state().progressReports).toEqual([]);
  f.run({type:'ReportMarathonFocus',focusSessionIds:['deferred'],entries:[{projectId:'p',subtaskId:'s',reportId:'report',progressBasisPoints:5000}],habitAllocations:[]});
  expect(f.state().holidayRewards).toHaveLength(1);
 });
 it('pins a completed habit reward to that sealed plot instead of the next cycle',()=>{
  const f=fixture('habit','UTC',10,'2026-10-30T08:00:00Z');for(let i=0;i<9;i++){f.start(`before-${i}`);f.advance(60_000);f.run({type:'CompleteFocus'});}
  expect(f.state().holidayRewards).toEqual([]);f.set('2026-11-01T08:00:00Z');f.start('last');f.advance(60_000);f.run({type:'CompleteFocus'});
  expect(f.state().habitBuildings).toHaveLength(1);expect(f.state().holidayRewards[0]!.settlementIndex).toBe(f.state().habitBuildings[0]!.settlementIndex);
  f.run({type:'SelectNextHabitBuilding',blueprintId:'cottage',targetRounds:10});expect(f.state().projects[0]!.settlementIndex).not.toBe(f.state().holidayRewards[0]!.settlementIndex);
 });
 it('migrates old data without inventing rewards and rejects forged annual facts',()=>{
  const f=fixture();const {holidayRewards,...legacy}=f.state();expect(parseDomainState({...legacy,schemaVersion:12}).holidayRewards).toEqual([]);
  f.start('one');f.advance(60_000);f.run({type:'CompleteFocus'});const raw=structuredClone(f.state());
  for(const changes of [{date:'2026-11-15'},{sourceSessionId:'missing'},{settlementIndex:99},{awardedAt:'2026-11-01T00:00:00Z'}]){
   const bad=structuredClone(raw);Object.assign(bad.holidayRewards[0]!,changes);expect(()=>parseDomainState(bad)).toThrow();
  }
  expect(()=>parseDomainState({...raw,holidayRewards:[...raw.holidayRewards,raw.holidayRewards[0]]})).toThrow();
  expect(()=>parseDomainState({...raw,schemaVersion:12})).toThrow();
 });
});
