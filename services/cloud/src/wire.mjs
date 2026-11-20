import { createHash } from 'node:crypto';
import { parseDomainState } from '../build/domain.mjs';

export class ApiError extends Error {
  constructor(status,code,details=undefined){super(code);this.status=status;this.code=code;this.details=details;}
}
export const fail=(ok,code='INVALID_INPUT',status=400)=>{if(!ok)throw new ApiError(status,code);};
export const sha=value=>createHash('sha256').update(value).digest('hex');
export const hashPattern=/^[a-f0-9]{64}$/;
export const canonical=value=>{
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
};
export const arrays=new Set('projects habitBuildings retiredSubtaskIds focusHistory progressReports dailyGoals projectConditions decorationBlueprintResources decorationRewards holidayRewards buildingBlueprintResources quickNotes birthdayRewards'.split(' '));
export const singletons=new Set('schemaVersion activeProjectId activeFocusSession calendar decayPolicy focusIntegrityPolicy worldSettings birthday'.split(' '));
export const assetSlot=section=>({projects:'importedBlueprint',habitBuildings:'importedBlueprint',buildingBlueprintResources:'blueprint',decorationBlueprintResources:'blueprint'})[section];
export function validateKey(key){
  fail(typeof key==='string'&&key.length<=600);
  if(key==='@preferences'||key==='@plan')return;
  if(key.startsWith('$/')){fail(singletons.has(key.slice(2)));return;}
  const at=key.indexOf('/');fail(at>0&&arrays.has(key.slice(0,at))&&key.slice(at+1).length>0&&key.slice(at+1).length<=512);
}
export function identity(section,value){
  if(typeof value==='string')return value;
  return section==='dailyGoals'||section==='decorationRewards'?value.date:section==='projectConditions'?value.projectId:
    section==='birthdayRewards'?String(value.year):section==='holidayRewards'?value.holidayId+':'+value.year:value.id;
}
export function splitDomain(domain){
  const source=JSON.parse(canonical(domain)),entries={},assets={};
  for(const section of singletons)entries['$/'+section]=canonical(source[section]);
  for(const section of arrays)source[section].forEach((value,ordinal)=>{
    const slot=assetSlot(section);
    if(slot&&value[slot]!=null){const wire=canonical(value[slot]),key=sha(wire);assets[key]=wire;value[slot]={$asset:key};}
    entries[section+'/'+identity(section,value)]=canonical({ordinal,value});
  });
  return {entries,assets};
}
export function assembleDomain(entries,asset){
  const root={},rows={};let expanded=0;
  for(const [key,wire] of Object.entries(entries)){
    validateKey(key);
    if(key==='@preferences'||key==='@plan')continue;
    fail(typeof wire==='string'&&wire.length<=4*1024*1024);
    expanded+=Buffer.byteLength(wire);fail(expanded<=100*1024*1024,'WORKSPACE_TOO_LARGE',413);
    if(key.startsWith('$/')){const name=key.slice(2);fail(singletons.has(name));root[name]=JSON.parse(wire);continue;}
    const index=key.indexOf('/'),section=key.slice(0,index),id=key.slice(index+1);
    fail(index>0&&arrays.has(section)&&id.length>0&&id.length<=512);
    const row=JSON.parse(wire);fail(Number.isSafeInteger(row.ordinal)&&row.ordinal>=0&&row.ordinal<=100000);
    const value=row.value;fail(identity(section,value)===id,'ENTITY_ID_MISMATCH');
    const slot=assetSlot(section);
    if(slot&&value[slot]!=null){
      const reference=value[slot];fail(reference&&Object.keys(reference).join()==='$asset'&&hashPattern.test(reference.$asset));
      const body=asset(reference.$asset);expanded+=Buffer.byteLength(body);fail(expanded<=512*1024*1024,'WORKSPACE_TOO_LARGE',413);
      value[slot]=JSON.parse(body);
    }
    (rows[section]??=[]).push({ordinal:row.ordinal,id,value});
  }
  for(const name of singletons)fail(Object.hasOwn(root,name),'INCOMPLETE_WORKSPACE');
  for(const name of arrays)root[name]=(rows[name]??=[]).sort((a,b)=>a.ordinal-b.ordinal||a.id.localeCompare(b.id)).map(row=>row.value);
  try{return parseDomainState(root);}catch{throw new ApiError(409,'DOMAIN_CONFLICT');}
}
export function assetKeys(entries){
  const keys=new Set();
  for(const [key,wire] of Object.entries(entries)){
    const section=key.slice(0,key.indexOf('/')),slot=assetSlot(section);
    if(slot){const ref=JSON.parse(wire).value?.[slot];if(ref!=null){fail(hashPattern.test(ref.$asset));keys.add(ref.$asset);}}
  }
  return keys;
}
export function validateExtra(key,wire){
  fail(wire.length<=65536);const object=JSON.parse(wire);fail(object&&typeof object==='object'&&!Array.isArray(object));
  if(key==='@preferences'){
    const allowed=new Set('focusMinutes habitFocusMinutes habitTargetRounds breakMinutes lightingQuality constructionOutlineVisibility worldColorAdjustment showWorldCoordinates focusGlassTransparency themeMode fontStyle returnToFocusReminders autoContinueFocus autoCheckUpdates realWeatherEnabled minimalMode ambience language quickNotesEnabled resourceSelection autoExtendFocus'.split(' '));
    fail(Object.keys(object).every(name=>allowed.has(name)));
    const ranges={focusMinutes:[1,180],habitFocusMinutes:[1,180],habitTargetRounds:[10,30],breakMinutes:[0,60],focusGlassTransparency:[0,100]};
    for(const [name,[low,high]]of Object.entries(ranges))fail(Number.isInteger(object[name])&&object[name]>=low&&object[name]<=high);
    for(const name of 'showWorldCoordinates returnToFocusReminders autoContinueFocus autoCheckUpdates realWeatherEnabled minimalMode quickNotesEnabled'.split(' '))fail(typeof object[name]==='boolean');
    if(Object.hasOwn(object,'autoExtendFocus'))fail(typeof object.autoExtendFocus==='boolean');
    const choices={lightingQuality:['auto','performance','balanced','cinematic'],constructionOutlineVisibility:['off','current','all'],themeMode:['system','light','dark'],fontStyle:['pixel','system','mixed'],language:['zh-CN','en']};
    for(const [name,values]of Object.entries(choices))fail(values.includes(object[name]));
    const sound=object.ambience;fail(sound&&typeof sound.enabled==='boolean'&&typeof sound.rainEnabled==='boolean'&&Number.isInteger(sound.volume)&&sound.volume>=0&&sound.volume<=100);
    fail(Object.keys(sound).sort().join()==='enabled,primary,rainEnabled,volume');
    fail(['forest-birds','shore-waves'].includes(sound.primary)||hashPattern.test(sound.primary));
    if(object.resourceSelection!=null){const resource=object.resourceSelection;
      fail(typeof resource==='object'&&!Array.isArray(resource)&&Object.keys(resource).sort().join()==='activeId,baseId');
      for(const value of Object.values(resource))fail(value===null||typeof value==='string'&&hashPattern.test(value));
    }
    const color=object.worldColorAdjustment;fail(color&&Object.keys(color).sort().join()==='brightness,contrast,saturation');
    for(const [name,[low,high]]of Object.entries({saturation:[50,150],brightness:[80,120],contrast:[80,120]}))fail(Number.isInteger(color[name])&&color[name]>=low&&color[name]<=high);
  }else if(key==='@plan'){
    fail(Object.keys(object).every(name=>['plan','automaticEnabled'].includes(name)));
    fail(object.plan===null||typeof object.plan==='object'&&!Array.isArray(object.plan));fail(typeof object.automaticEnabled==='boolean');
    const p=object.plan;if(p==null){fail(!object.automaticEnabled);return;}
    const required='id projectId subtaskId mode totalRounds completedSessionIds phase focusDurationMs restDurationMs currentSessionId phaseEndsAt exactEndAt terminalRest cancelled cancellationCategory cancellationNote hasStarted'.split(' ');
    const optional=['restStartedAt','extendAfterPlan','extensionStartedAt','extensionRounds'];
    fail(required.every(k=>Object.hasOwn(p,k))&&Object.keys(p).every(k=>required.includes(k)||optional.includes(k)));
    fail(typeof p.id==='string'&&p.id.length>0&&p.id.length<=512&&typeof p.projectId==='string');
    fail(['ROUNDS','MINIMAL','MARATHON'].includes(p.mode)&&['READY','FOCUS','REST','REPORT'].includes(p.phase));
    fail(Number.isInteger(p.totalRounds)&&p.totalRounds>=1&&p.totalRounds<=24&&Array.isArray(p.completedSessionIds)&&p.completedSessionIds.length<=p.totalRounds&&new Set(p.completedSessionIds).size===p.completedSessionIds.length);
    fail(p.completedSessionIds.every(id=>typeof id==='string'&&id.length>0));
    fail(Number.isInteger(p.focusDurationMs)&&p.focusDurationMs>=1&&p.focusDurationMs<=10800000&&Number.isInteger(p.restDurationMs)&&p.restDurationMs>=0&&p.restDurationMs<=3600000);
    for(const name of ['terminalRest','cancelled','hasStarted'])fail(typeof p[name]==='boolean');
    if(Object.hasOwn(p,'extendAfterPlan'))fail(p.extendAfterPlan===true);
    const extending=Object.hasOwn(p,'extensionStartedAt');
    fail(extending===Object.hasOwn(p,'extensionRounds'));
    if(extending)fail(typeof p.extensionStartedAt==='string'&&p.extendAfterPlan===true&&p.completedSessionIds.length===p.totalRounds&&
      ['FOCUS','REPORT'].includes(p.phase)&&!object.automaticEnabled&&Number.isInteger(p.extensionRounds)&&p.extensionRounds>=0&&p.extensionRounds<2147483647);
    for(const name of ['phaseEndsAt','exactEndAt','restStartedAt','extensionStartedAt'])if(p[name]!=null)fail(typeof p[name]==='string'&&Number.isFinite(Date.parse(p[name])));
    if(p.phase==='FOCUS')fail(typeof p.currentSessionId==='string'&&p.phaseEndsAt!=null&&(extending||p.completedSessionIds.length<p.totalRounds));
    else fail(p.currentSessionId===null);
  }else fail(false);
}
/** The live plan is portable control state, but still refers to one validated
 * domain. Local alarms/grants are never transported with it. */
export function validatePlanDomain(entries,domain){
  if(entries['@plan']==null)return;
  const extra=JSON.parse(entries['@plan']),p=extra.plan;if(p==null)return;
  const check=ok=>fail(ok,'PLAN_CONFLICT',409);
  const owner=domain.projects.find(project=>project.id===p.projectId);
  check(owner&&(['active','paused'].includes(owner.status)||p.phase==='REPORT'&&owner.status==='monument'));
  if(p.mode==='MINIMAL'||owner.kind==='habit')check(p.subtaskId===null);
  else check(owner.subtasks.some(task=>task.id===p.subtaskId));
  check(!p.terminalRest||p.phase==='REST'&&p.exactEndAt===p.phaseEndsAt);
  check(!p.cancelled||p.phase==='REPORT'&&!extra.automaticEnabled);
  check(p.cancellationCategory===null||['external-interruption','task-blocked','fatigue','priority-changed','device-or-app','other'].includes(p.cancellationCategory));
  check(p.cancellationNote===null||typeof p.cancellationNote==='string'&&p.cancellationNote.trim().length>0&&p.cancellationNote.length<=200);
  const history=new Map(domain.focusHistory.map(session=>[session.id,session]));
  check(p.hasStarted||![...history.keys()].some(id=>id.startsWith('session:'+p.id+':')));
  for(const id of p.completedSessionIds){const session=history.get(id);check(session&&session.status!=='interrupted'&&session.projectId===p.projectId);}
  if(p.extensionStartedAt!=null){
    check(p.extensionRounds<=history.size);
    const start=Date.parse(p.extensionStartedAt),prefix=`session:${p.id}:extension:${p.mode}:`;
    for(let round=1;round<=p.extensionRounds;round++){
      const session=history.get(prefix+round);
      check(session?.status==='completed'&&session.projectId===p.projectId&&Date.parse(session.startedAt)>=start);
    }
    if(p.phase==='FOCUS')check(p.currentSessionId===prefix+(p.extensionRounds+1));
  }
  check(p.hasStarted||p.phase==='READY'&&p.completedSessionIds.length===0);
  const active=domain.activeFocusSession;
  if(p.phase==='FOCUS')check(active&&active.id===p.currentSessionId&&active.projectId===p.projectId&&active.subtaskId===p.subtaskId&&active.endsAt===p.phaseEndsAt);
  else{
    check(active===null&&p.currentSessionId===null);
    if(p.phase==='REST')check(p.phaseEndsAt!==null&&p.completedSessionIds.length>0);
    else check(p.phaseEndsAt===null);
    if(p.phase==='READY')check(p.completedSessionIds.length<p.totalRounds);
    if(p.phase==='REPORT')check(p.completedSessionIds.length>0);
  }
  if(p.phase==='REST'&&p.restStartedAt!=null)check(Date.parse(p.restStartedAt)<Date.parse(p.phaseEndsAt));
}
export const defaultSharing=()=>({status:false,name:false,time:false,daily:false});
export function sharing(value){
  fail(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()==='daily,name,status,time');
  fail(Object.values(value).every(v=>typeof v==='boolean'));return {...value};
}
export function accountDate(now,zone){
  try{const f=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'});
    const v=Object.fromEntries(f.formatToParts(new Date(now)).map(p=>[p.type,p.value]));return `${v.year}-${v.month}-${v.day}`;
  }catch{throw new ApiError(400,'INVALID_TIME_ZONE');}
}
