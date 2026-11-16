import {buildSync} from 'esbuild';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../../../',import.meta.url)),output=process.argv[2];
if(!output)throw Error('Reward presentation oracle directory required');
const sourceHashes={};
function track(name){sourceHashes[name]=createHash('sha256').update(readFileSync(path.join(root,name))).digest('hex');}
async function load(name){
 const compiled=buildSync({entryPoints:[path.join(root,name)],bundle:true,write:false,platform:'node',format:'esm',metafile:true});
 for(const file of Object.keys(compiled.metafile.inputs))track(path.relative(root,path.resolve(file)).replaceAll('\\','/'));
 return import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
}
const {holidaysForYear,holidayEmblemsOnDate,birthdayOnDate,addLocalDays}=await load('packages/domain/src/index.ts');
const {pixelConfettiFrame,goalConfettiFrame}=await load('apps/web/src/celebrations.ts');
const dates=new Set(['2026-10-18','2027-02-28','2028-02-28','2028-02-29','2026-12-31','2027-01-01']);
for(const year of [2025,2026,2028,2030])for(const holiday of holidaysForYear(year))for(const delta of [-1,0,1,2,3])dates.add(addLocalDays(holiday.date,delta));
const holidays=[];
for(const date of [...dates].sort())for(const birthday of [null,{enabled:false,month:1,day:1},{enabled:true,month:Number(date.slice(5,7)),day:Number(date.slice(8))},{enabled:true,month:2,day:29}]){
 for(let slot=0;slot<3;slot++){
  const source=holidayEmblemsOnDate(date)[slot];
  const entries=source?[{id:source.holiday.id,name:source.holiday.name,description:source.holiday.description,emblem:source.emblem}]:[];
  if(slot===0&&birthday&&birthdayOnDate(birthday,date))entries.push({id:'birthday',name:'生日快乐',description:'今天属于你。小蛋糕留在聚落，祝你新的一岁自在生长。',emblem:'生日蛋糕'});
  holidays.push({date,slot,birthday,entries});
 }
}
const frames=[];
for(const [width,height]of [[360,800],[800,360],[1080,2400]])for(const elapsed of [-1,0,27,56,280,700,1200,2100,3400,3401])for(const goal of [false,true]){
 frames.push({width,height,elapsed,goal,pixels:(goal?goalConfettiFrame:pixelConfettiFrame)(elapsed,width,height)});
}
// Sprite constants are deliberately checked against the actual formal TSX,
// rather than generating a second independent set of decorative fixtures.
const glyphSource='apps/web/src/ui/HolidayEmblem.tsx';track(glyphSource);
const source=readFileSync(path.join(root,glyphSource),'utf8');
const spritesLiteral=source.match(/const SPRITES:Record<string,string\[\]>=(\{[\s\S]*?\n\});/)?.[1];
const symbolsLiteral=source.match(/const SYMBOLS:Record<string,\[string,string,string,string\]>=(\{[\s\S]*?\n\});/)?.[1];
assert.ok(spritesLiteral&&symbolsLiteral,'Formal holiday sprite declarations changed');
const compiled=buildSync({stdin:{contents:`export const sprites=${spritesLiteral}; export const symbols=${symbolsLiteral};`,loader:'ts'},write:false,platform:'node',format:'esm'});
const {sprites,symbols}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const glyphs=Object.fromEntries(Object.entries(symbols).map(([name,[sprite,...colors]])=>[name,{rows:sprites[sprite],colors:colors.map(color=>parseInt('ff'+color.slice(1),16))}]));
track('apps/native-android/tools/export-reward-presentation-oracle.mjs');track('package-lock.json');
mkdirSync(output,{recursive:true});writeFileSync(path.join(output,'reward-presentation-oracle.json'),JSON.stringify({schema:1,sourceHashes,holidays,frames,glyphs}));
console.log(JSON.stringify({dates:dates.size,holidayCases:holidays.length,frames:frames.length,pixels:frames.reduce((n,f)=>n+f.pixels.length,0),glyphs:Object.keys(glyphs).length,sources:Object.keys(sourceHashes).length}));
