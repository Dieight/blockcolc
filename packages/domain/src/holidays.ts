import { Lunar } from 'lunar-typescript';
import { addLocalDays, assertISODate } from './calendar.js';

export const HOLIDAY_IDS = ['new-year','spring-festival','valentine','lantern','women','nowruz','songkran','labour','africa','children','dragon-boat','us-independence','france','mid-autumn','oktoberfest','china-national','halloween','day-of-dead','christmas','carnival'] as const;
export type HolidayId = typeof HOLIDAY_IDS[number];
export interface HolidayOccurrence { id:HolidayId; year:number; date:string; name:string; emblems:readonly string[]; description:string; buildingName:string; }
type Entry=Omit<HolidayOccurrence,'date'|'year'> & { fixed?:string; lunar?:readonly[number,number] };
const CATALOG:readonly Entry[]=[
 {id:'new-year',name:'元旦',fixed:'01-01',emblems:['烟花','礼盒','星星'],description:'烟花与礼盒，迎接公历新年的开始。',buildingName:'烟花观景台'},
 {id:'spring-festival',name:'春节',lunar:[1,1],emblems:['灯笼','结绳','爆竹'],description:'灯笼与爆竹，迎接农历新年与团聚。',buildingName:'双灯笼小亭'},
 {id:'valentine',name:'情人节',fixed:'02-14',emblems:['心形','玫瑰','信封'],description:'玫瑰与信笺，传递爱意和心意。',buildingName:'玫瑰邮筒庭院'},
 {id:'lantern',name:'元宵节',lunar:[1,15],emblems:['灯笼','汤圆'],description:'正月十五赏花灯，汤圆寓意团圆。',buildingName:'花灯台'},
 {id:'women',name:'国际妇女节',fixed:'03-08',emblems:['含羞草','书'],description:'含羞草与书，纪念女性的贡献与平等权利。',buildingName:'金色阅读花园'},
 {id:'nowruz',name:'诺鲁孜节',fixed:'03-21',emblems:['嫩芽','苹果','镜子'],description:'伊朗与中亚等地迎新春；嫩芽与镜子象征更新。',buildingName:'春芽玻璃花房'},
 {id:'songkran',name:'泰国宋干节',fixed:'04-13',emblems:['水滴','花碗'],description:'泰国新年以水迎新，花碗盛着清凉祝福。',buildingName:'水轮花庭'},
 {id:'labour',name:'劳动节',fixed:'05-01',emblems:['锤子','齿轮'],description:'多国在五月一日纪念劳动者；工具象征创造。',buildingName:'工具工坊'},
 {id:'africa',name:'非洲日',fixed:'05-25',emblems:['非洲轮廓','绿叶'],description:'五月二十五日纪念非洲的团结与多样文化。',buildingName:'绿荫阅读庭院'},
 {id:'children',name:'儿童节',fixed:'06-01',emblems:['风车','积木','气球'],description:'中国及多国在六月一日庆祝；积木与风车寄托童趣。',buildingName:'积木风车屋'},
 {id:'dragon-boat',name:'端午节',lunar:[5,5],emblems:['粽子','龙舟'],description:'农历五月初五，粽子与龙舟是传统节日意象。',buildingName:'龙舟停泊台'},
 {id:'us-independence',name:'美国独立日',fixed:'07-04',emblems:['星条旗','烟花','星星'],description:'七月四日纪念美国独立；星条旗与烟花是常见庆祝意象。',buildingName:'星光烟花亭'},
 {id:'france',name:'法国国庆日',fixed:'07-14',emblems:['三色旗串','烟花'],description:'法国七月十四日以三色旗与烟花庆祝国庆。',buildingName:'烟花小花园'},
 {id:'mid-autumn',name:'中秋节',lunar:[8,15],emblems:['月饼','桂花','玉兔'],description:'农历八月十五，月饼与桂花寄托团圆。',buildingName:'桂花赏月亭'},
 {id:'oktoberfest',name:'慕尼黑啤酒节',emblems:['椒盐卷饼','啤酒花','杯'],description:'德国慕尼黑的秋季庆典，以卷饼、啤酒花和蓝白棚为意象。',buildingName:'蓝白市集棚'},
 {id:'china-national',name:'中国国庆节',fixed:'10-01',emblems:['红旗','灯笼','烟花'],description:'十月一日纪念中华人民共和国成立；红旗、灯笼与烟花装点庆祝。',buildingName:'红旗灯笼亭'},
 {id:'halloween',name:'万圣节',fixed:'10-31',emblems:['南瓜灯','糖果','蝙蝠'],description:'十月末的节日庆祝，以南瓜灯、糖果和蝙蝠点缀。',buildingName:'南瓜糖果屋'},
 {id:'day-of-dead',name:'墨西哥亡灵节',fixed:'11-01',emblems:['万寿菊','剪纸彩旗','烛光'],description:'主要在十一月一至二日，以花与彩纸追思亲友。',buildingName:'万寿菊记忆花廊'},
 {id:'christmas',name:'圣诞节',fixed:'12-25',emblems:['常青树','礼盒','铃铛'],description:'常青树、礼物与铃铛，是广泛使用的庆祝意象。',buildingName:'礼物松林屋'},
 {id:'carnival',name:'巴西狂欢节',emblems:['彩色小伞','鼓'],description:'巴西的年度狂欢庆典，以彩伞与鼓表现音乐和色彩。',buildingName:'彩伞音乐亭'},
];
const cache=new Map<number,readonly HolidayOccurrence[]>();
function iso(year:number,month:number,day:number){return`${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;}
// Gregorian ecclesiastical computus; only used to locate Carnival Tuesday.
export function carnivalDate(year:number):string {
 const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3);
 const h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
 const value=h+l-7*m+114;return addLocalDays(iso(year,Math.floor(value/31),value%31+1),-47);
}
export function holidaysForYear(year:number):readonly HolidayOccurrence[] {
 if(!Number.isInteger(year)||year<100||year>9999)throw new Error('Invalid holiday year');
 const existing=cache.get(year);if(existing)return existing;
 const result=CATALOG.map(({fixed,lunar,...entry})=>{
  let date:string;
  if(fixed)date=`${String(year).padStart(4,'0')}-${fixed}`;
  else if(lunar){const solar=Lunar.fromYmd(year,lunar[0],lunar[1]).getSolar();date=iso(solar.getYear(),solar.getMonth(),solar.getDay());}
  else if(entry.id==='carnival')date=carnivalDate(year);
  else {const sept16=`${year}-09-16`;date=addLocalDays(sept16,(6-new Date(`${sept16}T00:00:00Z`).getUTCDay()+7)%7);}
  assertISODate(date);return Object.freeze({...entry,emblems:Object.freeze([...entry.emblems]),year,date});
 }).sort((a,b)=>a.date.localeCompare(b.date)||HOLIDAY_IDS.indexOf(a.id)-HOLIDAY_IDS.indexOf(b.id));
 const frozen=Object.freeze(result);cache.set(year,frozen);if(cache.size>8)cache.delete(cache.keys().next().value!);return frozen;
}
export function holidaysOnDate(date:string):readonly HolidayOccurrence[] {
 assertISODate(date);const year=Number(date.slice(0,4));
 return [...(year>100?holidaysForYear(year-1):[]),...holidaysForYear(year)]
  .filter(h=>date>=h.date&&date<=addLocalDays(h.date,2)).sort((a,b)=>a.date.localeCompare(b.date)||HOLIDAY_IDS.indexOf(a.id)-HOLIDAY_IDS.indexOf(b.id));
}
export function holidayEmblemsOnDate(date:string){return holidaysOnDate(date).flatMap(holiday=>holiday.emblems.map((emblem,index)=>({holiday,emblem,index}))).slice(0,3);}
