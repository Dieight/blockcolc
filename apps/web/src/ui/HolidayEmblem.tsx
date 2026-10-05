import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { holidayEmblemsOnDate } from '@blockcolc/domain';
import { useBackLayer } from '../back-layer';

// Original, integer-grid sprites. No emoji font or downloaded festival artwork.
const SPRITES:Record<string,string[]>={
 star:['.....a.....','.....a.....','...aaaaa...','aaaaaaaaaaa','..aaaaaaa..','...aaaaa...','..aaa.aaa..','..aa...aa..'],
 fire:['.....a.....','..b..a..b..','...b.a.b...','aaaa.c.aaaa','...b.a.b...','..b..a..b..','.....a.....','.....c.....','.....c.....'],
 gift:['..aa..aa..','..abbaaa..','...aaaa...','bbbbcbbbbb','bbbbcbbbbb','...cc.....','bbbccbbbbb','bbbccbbbbb','bbbccbbbbb'],
 lantern:['...cccc...','.....c....','..aaaaaa..','.abaaaaab.','.abaaaaab.','.abaaaaab.','..aaaaaa..','....cc....','....cc....'],
 knot:['....aa....','..aaaaaa..','.aa....aa.','aa..aa..aa','.aaaaaaa..','..aa..aa..','..aa..aa..','..aa..aa..'],
 cracker:['...cc.....','....c.....','...aaa....','...aba....','...aaa....','...aba....','...aaa....','...aba....','...aaa....'],
 heart:['.aaa..aaa.','aaaaaaaaaa','abaaaaaaaa','abaaaaaaaa','.aaaaaaaa.','..aaaaaa..','...aaaa...','....aa....'],
 flower:['...aaa....','..abbba...','.abbbbba..','..abbba...','...aaa....','....c.....','..ccc.....','....ccc...','....c.....'],
 mail:['aaaaaaaaaa','abaaaaaaba','aabaaaabaa','aaabaabaab','aaaabbbaaa','aaaaaaaaaa','aaaaaaaaaa'],
 rice:['..aaaaa...','.abbaaaba.','abbbbaaaab','.aaaaaaa..','...cccc...','..cccccc..','..cccccc..'],
 book:['aaa..bbb..','acaa.bcab.','acaa.bcab.','acaa.bcab.','acaa.bcab.','acaa.bcab.','aaaaaaaaaa','....cc....'],
 sprout:['aa......aa','aaaa..aaaa','.aaa..aaa.','..aa..aa..','....cc....','....cc....','....cc....','..bbbbbb..'],
 apple:['....cc....','....caa...','..aaaaaa..','.abaaaaaa.','.abaaaaaa.','.aaaaaaaa.','..aaaaaa..','...a..a...'],
 mirror:['..cccccc..','.caaaaaac.','caaabaaaac','caabaaaaac','cabaaaaaac','.caaaaaac.','..cccccc..','....cc....','..cccccc..'],
 water:['.....a....','....aaa...','...aaaaa..','..aabaaaa.','.aabaaaaaa','.aabaaaaaa','..aaaaaaa.','...aaaaa..'],
 bowl:['..a..a..a.','...aaa....','..bbbbb...','aaaaaaaaaa','.aaaaaaaa.','..aaaaaa..','...cccc...'],
 hammer:['aaaaaa....','aaaaaa....','...cc.....','...cc.....','...cc.....','...cc.....','...cc.....','...cc.....'],
 gear:['...aa.aa..','.aaaaaaaa.','.aa....aa.','aaa.cc.aaa','.aa.cc.aa.','aaa....aaa','.aaaaaaaa.','...aa.aa..'],
 africa:['..aaaa....','.aaaaaa...','aaaaaaaa..','.aaaaaaaa.','..aaaaaaa.','...aaaaa..','...aaaa...','....aa..a.','....a...a.'],
 leaf:['.....aaaa.','...aaaaaa.','..aabaaaa.','.aabaaaa..','.abaaaa...','..aaaa....','...c......','..c.......'],
 wind:['..aaa.....','..aaa.....','...aa.aaa.','aaaaabaaaa','aaaa.abaaa','...aaa....','...aaa....','....cc....','....cc....'],
 blocks:['..aaaa....','..abba....','..aaaa....','bbbbcccccc','bbcbbccacc','bbbbbccccc','bbbbbccccc'],
 balloon:['...aaaa...','..abbaaa..','.abbbaaaa.','.aaaaaaaa.','..aaaaaa..','...aaaa...','....cc....','.....c....','.....c....'],
 parcel:['....a.....','...aaa....','..aaaaa...','.aabaaaba.','aaabbbaaaa','aaaaaaaaaa','..cccccc..'],
 boat:['.......aa.','.......aba','..c.c.caa.','aaaaaaaaaa','.abbbbbaa.','..aaaaaa..','cccccccccc'],
 flag:['bbbbbbbbbb','baaccbaacc','baaccbaacc','baaccbaacc','....bb....','....bb....'],
 redflag:['caaaaaaaaa','cabaaaaaaa','caaaaaaaaa','caaaaaaaaa','c.........','c.........','c.........'],
 stripes:['cccaaaaaaa','cbcbbbbbbb','cccaaaaaaa','bbbbbbbbbb','aaaaaaaaaa','bbbbbbbbbb','..c.......','..c.......'],
 mooncake:['..aaaaaa..','.abbbbaaa.','aabbaabaaa','aabaabbaaa','aabbaabaaa','.aaaaaaa..','..aaaaaa..'],
 rabbit:['..aa..aa..','..aa..aa..','..aa..aa..','..aaaaaa..','.aabaaba..','.aaaaaaa..','..aaaaaa..','...cccc...'],
 pretzel:['..aaa.aaa.','.aabbaaaba','aa...a..aa','aa..aaa.aa','.aaa.aaaa.','..aa..aa..','...aaaa...'],
 mug:['aaaaaaaa..','abbabaaaac','abbabaaa.c','abbabaaa.c','abbabaaaac','aaaaaaaa..','aaaaaaaa..'],
 pumpkin:['....cc....','....c.....','..aaaaaa..','.abaaaaba.','aabaaabaaa','aaaccaaaaa','aaaacccaaa','.aaaaaaa..','..aaaaaa..'],
 candy:['aa......aa','.aaaaaaaa.','..abbbbba.','..abbbbba.','.aaaaaaaa.','aa......aa'],
 bat:['a........a','aa......aa','aaa.aa.aaa','aaaaaaaaaa','..aaaaaa..','...aaaa...','....aa....'],
 paper:['aaaaaaaaaa','.abaaaaba.','.aabbbbaa.','..aaaaaa..','..aa.aaa..','...a..a...'],
 candle:['....aa....','....aba...','.....a....','....bbb...','....bbb...','....bbb...','....bbb...','..cccccc..'],
 tree:['.....a....','....aaa...','...aaaaa..','....aaa...','..aaaaaaa.','...aaaaa..','.aaaaaaaaa','....cc....','....cc....'],
 bell:['...aaaa...','..aaaaaa..','..abaaaa..','..abaaaa..','.aaaaaaaa.','aaaaaaaaaa','....cc....'],
 umbrella:['...aaa....','..abbba...','.abbccba..','aabbccbbba','.....c....','.....c....','...c.c....','....cc....'],
 drum:['..bbbbbb..','.baaaaaab.','..cccccc..','..caaaac..','..caaaac..','..cccccc..','..bbbbbb..'],
};
const SYMBOLS:Record<string,[string,string,string,string]>={
 '烟花':['fire','#f4b638','#e65b47','#80947e'],'礼盒':['gift','#e16457','#edc950','#578571'],'星星':['star','#edc950','#fff1c4','#e58f38'],
 '灯笼':['lantern','#df5948','#f4c35e','#7c6249'],'结绳':['knot','#dc554a','#f4bf5b','#665541'],'爆竹':['cracker','#de5747','#f4c654','#596f52'],
 '心形':['heart','#df6376','#f5acaa','#bf455f'],'玫瑰':['flower','#d9566b','#f2a293','#508264'],'信封':['mail','#eee3ce','#e9a887','#ba756d'],
 '汤圆':['rice','#f4ead7','#ffffff','#b98f73'],'含羞草':['flower','#f0ca47','#f8e37d','#5e8d5e'],'书':['book','#d59c68','#dce1cb','#edf0dc'],
 '嫩芽':['sprout','#74a45b','#9b7657','#466f53'],'苹果':['apple','#de6251','#f6a470','#4f7950'],'镜子':['mirror','#8ec2d0','#dfeef0','#bb9a64'],
 '水滴':['water','#62b8d5','#c6e9ef','#467f9b'],'花碗':['bowl','#cfdad7','#e8798d','#87b6b2'],'锤子':['hammer','#b7c2bd','#edf3df','#ab8159'],
 '齿轮':['gear','#c3995b','#e3c683','#766e60'],'非洲轮廓':['africa','#dcb15c','#729c62','#e9824d'],'绿叶':['leaf','#79a260','#9bbc71','#557747'],
 '风车':['wind','#df7161','#eccb69','#708cbb'],'积木':['blocks','#efbd54','#db766d','#6c9bb5'],'气球':['balloon','#e47788','#f6bbbc','#867c76'],
 '粽子':['parcel','#6f9a62','#a9be7a','#c5a270'],'龙舟':['boat','#ae8758','#81a467','#71bcc4'],'三色旗串':['flag','#6e9ebb','#e65b59','#f4efde'],
 '红旗':['redflag','#df5048','#f2cd53','#91765b'],'星条旗':['stripes','#df6259','#f1ecdf','#577dba'],
 '月饼':['mooncake','#d3a05b','#8c6946','#f3d091'],'桂花':['flower','#edc952','#f8dfa0','#709568'],'玉兔':['rabbit','#eee5d1','#d5787f','#c9b5a1'],
 '椒盐卷饼':['pretzel','#c99253','#e9c891','#775a40'],'啤酒花':['flower','#93aa63','#c5c88a','#5a805e'],'杯':['mug','#e0b747','#f1dfaa','#99b4b9'],
 '南瓜灯':['pumpkin','#e59149','#f8b35b','#746750'],'糖果':['candy','#dc7592','#f4d482','#90afb8'],'蝙蝠':['bat','#82719d','#c8adc9','#56466c'],
 '万寿菊':['flower','#e7a14b','#f4c064','#6a945d'],'剪纸彩旗':['paper','#e78698','#7eb9bd','#ecc264'],'烛光':['candle','#f4c957','#f2dfb7','#b6875b'],
 '常青树':['tree','#699269','#afbf79','#927457'],'铃铛':['bell','#e2bb61','#f5daa0','#bb9252'],'彩色小伞':['umbrella','#dd798e','#e7c360','#729fba'],'鼓':['drum','#bf8569','#e9dab1','#777c71'],
};
export function HolidayPixelGlyph({emblem}:{emblem:string}){
 const [sprite,a,b,c]=SYMBOLS[emblem]!;const rows=SPRITES[sprite]!;
 return <svg viewBox="0 0 12 12" className="holiday-pixel" aria-hidden="true" shapeRendering="crispEdges">{rows.flatMap((row,y)=>[...row].flatMap((cell,x)=>cell==='.'?[]:<rect key={`${x}:${y}`} x={x+.5} y={y+(12-rows.length)/2} width="1" height="1" fill={{a,b,c}[cell as 'a'|'b'|'c']}/>))}</svg>;
}

export function HolidayEmblem({date,slot}:{date:string;slot:0|1|2}){
 const entry=holidayEmblemsOnDate(date)[slot];const [open,setOpen]=useState(false);
 const button=useRef<HTMLButtonElement>(null),popover=useRef<HTMLDivElement>(null);const id=useId();
 const [position,setPosition]=useState<CSSProperties>({});
 const close=()=>{setOpen(false);button.current?.focus({preventScroll:true});};
 useBackLayer(open,()=>{close();return true;});
 useEffect(()=>setOpen(false),[date,entry?.holiday.id]);
 useEffect(()=>{
  if(!open)return;
  const rect=button.current!.getBoundingClientRect(),width=Math.min(290,innerWidth-24);
  setPosition({width,left:Math.max(12,Math.min(innerWidth-width-12,rect.right-width)),top:rect.bottom+120>innerHeight?Math.max(12,rect.top-112):rect.bottom+8});
  const outside=(e:PointerEvent)=>{if(!button.current?.contains(e.target as Node)&&!popover.current?.contains(e.target as Node))setOpen(false);};
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();}};
  document.addEventListener('pointerdown',outside);window.addEventListener('keydown',key,true);
  return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('keydown',key,true);};
 },[open]);
 if(!entry)return null;
 return <span className="holiday-emblem" data-holiday={entry.holiday.id} onPointerDown={e=>e.stopPropagation()} onPointerUp={e=>e.stopPropagation()}>
  <button ref={button} type="button" className="holiday-emblem-button" aria-label={`${entry.holiday.name} · ${entry.emblem}`} aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>setOpen(v=>!v)}><HolidayPixelGlyph emblem={entry.emblem}/></button>
  {open&&createPortal(<div ref={popover} id={id} className="holiday-intro" role="dialog" aria-label={`${entry.holiday.name}介绍`} style={position}><div><strong>{entry.holiday.name}</strong><button type="button" aria-label="关闭节日介绍" onClick={close}>×</button></div><p>{entry.holiday.description}</p></div>,document.body)}
 </span>;
}
