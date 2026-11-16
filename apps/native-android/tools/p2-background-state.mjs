/** Host-side evidence guards. They never read or mutate an Android database. */
export function previewCapabilities(policy){
  if(policy==='restricted')return {notify:false,exact:false};
  if(policy==='granted')return {notify:true,exact:true};
  if(policy==='exact-only')return {notify:false,exact:true};
  throw Error('Unknown explicit preview capability condition');
}
export function freshActivityCommit(seed,live,database){
  return Boolean(seed&&live&&live.database===database&&live.phase==='FOCUS'
    &&Number.isSafeInteger(seed.revision)&&Number.isSafeInteger(live.revision)
    &&live.revision>seed.revision);
}
export function previewStorage(xml){
  const entries=[...xml.matchAll(/<string name="(database|beforeTest)">([^<]*)<\/string>/g)];
  const names=new Map();
  for(const [,key,value]of entries){
    if(names.has(key)||!/^p2-[a-zA-Z0-9-]+\.db$/.test(value))throw Error('Invalid preview storage evidence');
    names.set(key,value);
  }
  return {database:names.get('database')??'p2-state.db',beforeTest:names.get('beforeTest')??null};
}
export function previewStorageRestored(before,after){
  const original=previewStorage(before),actual=previewStorage(after);
  return original.beforeTest===null&&actual.beforeTest===null&&actual.database===original.database;
}
/** Active records only. Historical notifications cannot prove a live countdown. */
export function previewNotificationIds(text){
  const lines=text.split(/\r?\n/),start=lines.findIndex(line=>line.trim()==='Notification List:');
  if(start<0)throw Error('Active notification section unavailable');
  const indent=lines[start].match(/^\s*/)[0].length,ids=[];
  for(const line of lines.slice(start+1)){
    if(line.trim()&&line.match(/^\s*/)[0].length<=indent)break;
    if(!/\bNotificationRecord\(/.test(line)||!/\bpkg=com\.blockcolc\.preview\s/.test(line))continue;
    const value=line.match(/\bid=(\d+)\b/);if(!value)throw Error('Own notification ID unavailable');
    ids.push(Number(value[1]));
  }
  return ids;
}
export function previewScreenOff(power){
  const state=power.match(/^\s*mWakefulness=(\w+)\s*$/m)?.[1];
  if(!state)throw Error('Actual wakefulness state unavailable');
  return {state,screenOff:state==='Asleep'||state==='Dozing'};
}
