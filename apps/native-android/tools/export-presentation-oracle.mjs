import {buildSync} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {presentationFlowOracle} from './presentation-flow-oracle.mjs';
import {presentationStateOracle} from './presentation-state-oracle.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url)),output=process.argv[2];
if(!output)throw Error('Generated oracle directory required');
const sourceHashes={};
const sha=b=>createHash('sha256').update(b).digest('hex');
async function load(relative){
 const built=buildSync({entryPoints:[path.join(root,relative)],bundle:true,write:false,platform:'node',format:'esm',metafile:true,loader:{'.css':'empty'}});
 for(const file of Object.keys(built.metafile.inputs)){
  const absolute=path.resolve(file),name=path.relative(root,absolute).replaceAll('\\','/');
  assert.ok(!name.startsWith('../'));sourceHashes[name]=sha(readFileSync(absolute));
 }
 return import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
}
const {defaultFocusPreferences,parseFocusPreferences}=await load('apps/web/src/focus-preferences.ts');
const {planRoundsForDuration}=await load('apps/web/src/round-plan.ts');
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const defaults=defaultFocusPreferences(),preferences=[],schedules=[];
function pref(name,input){const wire=JSON.parse(JSON.stringify(input));preferences.push({name,input:wire,canonical:canonical(parseFocusPreferences(wire))});}
for(const input of [null,false,12,'bad',[],{},defaults,{focusMinutes:45,breakMinutes:5}])pref('root-'+preferences.length,input);
for(const field of ['focusMinutes','habitFocusMinutes','habitTargetRounds','breakMinutes','focusGlassTransparency'])
 for(const value of [-5,0,1,1.49,1.5,10,10.5,30,60,100,180,180.4,999,null,'45',true,{}])pref(`${field}:${JSON.stringify(value)}`,{...defaults,[field]:value});
for(const field of ['showWorldCoordinates','returnToFocusReminders','autoContinueFocus','autoCheckUpdates','realWeatherEnabled','minimalMode','progressiveStartup','quickNotesEnabled'])
 for(const value of [true,false,null,0,1,'true'])pref(`${field}:${value}`,{...defaults,[field]:value});
for(const field of ['lightingQuality','constructionOutlineVisibility','themeMode','fontStyle','language'])
 for(const value of ['auto','performance','balanced','cinematic','off','current','all','system','light','dark','pixel','en','zh-CN','bad',true,null])pref(`${field}:${value}`,{...defaults,[field]:value});
for(const field of ['saturation','brightness','contrast'])for(const value of [-100,0,49.5,50,80,99.5,100,120,150,151,null,'100'])pref(`color-${field}:${value}`,{...defaults,worldColorAdjustment:{[field]:value}});
for(const value of [null,[],{}, {enabled:true,primary:'shore-waves',rainEnabled:true,volume:70},
 {enabled:true,primary:'morning-birdsong',rainEnabled:true},{enabled:true,primary:'calm-ocean'},
 {enabled:true,primary:'evening-lakeside',imports:['a'.repeat(64)]},{enabled:true,primary:'bad',imports:['a'.repeat(64)]},
 {enabled:true,primary:'a'.repeat(64),volume:10.5},{enabled:true,primary:'A'.repeat(64),volume:999}])pref('ambience-'+preferences.length,{...defaults,ambience:value});
for(const primary of [['calm-ocean'],[['morning-birdsong']],['evening-lakeside',null],{},true,0,null])
 pref('ambience-coercion-'+preferences.length,{...defaults,ambience:{enabled:true,primary}});
for(const focusMinutes of [1,5,25,45,180])for(const breakMinutes of [0,5,60])for(const durationMs of [-1,0,1,60000,focusMinutes*60000-1,focusMinutes*60000,focusMinutes*60000+1,
 (focusMinutes+breakMinutes)*60000,(focusMinutes+breakMinutes)*60000+1,2*(focusMinutes+breakMinutes)*60000,24*(focusMinutes+breakMinutes)*60000+1]){
 const result=planRoundsForDuration(durationMs,focusMinutes,breakMinutes,25);schedules.push({durationMs,focusMinutes,breakMinutes,maxRounds:25,result});
}
for(const focusMinutes of [0,181])for(const breakMinutes of [0,61]){
 let rejected=false;try{planRoundsForDuration(60000,focusMinutes,breakMinutes);}catch{rejected=true;}assert.ok(rejected);
 schedules.push({durationMs:60000,focusMinutes,breakMinutes,maxRounds:24,rejected:true});
}
const flows=await presentationFlowOracle(load,defaults,canonical);
const workspaces=await presentationStateOracle(load,new URL('../../../',import.meta.url),canonical,sourceHashes);
const {parseDomainState}=await load('packages/domain/src/index.ts');
const {projectTodayFocusTimeline}=await load('apps/web/src/today-focus-timeline.ts');
const timelineInput='apps/native-android/tools/timeline-boundary-inputs.json';
const timelineBoundaries=JSON.parse(readFileSync(path.join(root,timelineInput),'utf8')).map(c=>({...c,expected:projectTodayFocusTimeline(parseDomainState(JSON.parse(c.inputCanonical)),c.date)}));
sourceHashes[timelineInput]=sha(readFileSync(path.join(root,timelineInput)));
const physics=await load('apps/web/src/ui/physical-slider.ts');
const weather=await load('apps/web/src/MinimalPanelWeatherOverlay.tsx');
const intensities=[-1,0,.001,.119999,.12,.339999,.34,.679999,.68,1,2];
const panelWeather={profiles:intensities.map(value=>({value,rain:weather.panelRainVisualProfile(value),snow:weather.panelSnowAccumulationProfile(value)})),steps:[],merges:[],lightning:[]};
const beads=Array.from({length:30},(_,i)=>({x:12+i*19,y:i*13,vx:(i-15)*.1,vy:i*1.7,radius:.2+i*.16,age:i*.55,holdSeconds:i%4*.6}));
beads[6]={...beads[6],age:33};beads[12]={...beads[12],y:999};
for(const delta of [-1,0,.016,.032,.05,4])for(const terminal of [-2,12,28,99])for(const height of [0,300])
 panelWeather.steps.push({drops:beads,delta,terminal,height,expected:weather.advanceGlassRaindrops(beads,delta,height,terminal)});
for(const offset of [.1,1,2,8]){
 const drops=beads.slice(0,5).map((drop,i)=>({...drop,x:24+i*offset,y:60+i*offset,radius:1.4+i*.5}));
 panelWeather.merges.push({drops,expected:weather.mergeGlassRaindrops(drops)});
}
for(const age of [-1,0,22.5,44.999,45,164.999,165,300,1000,1649,1650,1651])panelWeather.lightning.push({age,expected:weather.panelLightningOpacity(age)});
const flights=[];
for(const width of [160,280,640])for(const x of [0,width*.45,width])for(const dx of [-100,-25,0,25,100])for(const dy of [-110,-40,0,40,110]){
 const result=physics.sliderFlight(x,dx,dy,width);
 flights.push({width,x,dx,dy,result,positions:[0,.25,.5,.75,1].map(t=>physics.sliderFlightPosition(result,t*result.duration)),
  value:physics.sliderLandingValueAt(result.landing,width,0,100,5,result.vx)});
}
for(const file of ['apps/native-android/tools/export-presentation-oracle.mjs','apps/native-android/tools/presentation-flow-oracle.mjs','apps/native-android/tools/presentation-state-oracle.mjs','package-lock.json'])sourceHashes[file]=sha(readFileSync(path.join(root,file)));
mkdirSync(output,{recursive:true});writeFileSync(path.join(output,'presentation-oracle.json'),JSON.stringify({schema:1,sourceHashes,defaults:canonical(defaults),preferences,schedules,flows,workspaces,flights,timelineBoundaries,panelWeather}));
console.log(JSON.stringify({preferences:preferences.length,schedules:schedules.length,flows:flows.length,workspaces:workspaces.length,flights:flights.length,sources:Object.keys(sourceHashes).length}));
