import fs from 'node:fs';
const file='apps/android/android/app/src/main/java/com/blockcolc/app/BreakLiveUpdatePlugin.java';
const copy={
  '专注中':'Focusing','方块建造中':'Building blocks','项目 · ':'Project · ','当前 · ':'Now · ',
  '方块钟 · ':'Blockcolc · ','连续专注':'Continuous focus','专注':'Focus','休息中':'Taking a break',
  '第 %d / %d 轮':'Round %d / %d','本轮休息':'Break',' · 下一项 ':' · next: ',
  '返回专注 · ':'Return to focus · ','休息结束后返回专注\n':'Return to focus after the break\n',
  '\n下一项 · ':'\nNext · ','▣ 方块钟 · 返回专注':'▣ Blockcolc · return to focus',
  '跳过休息':'Skip break','第 ':'Round ',' 轮':'','休息中 · ':'Break · ',
  ' · 自动连续专注\n':' · auto-continue\n','休息中\n':'Break\n','▣ 方块钟 · ':'▣ Blockcolc · ',
  '返回专注':'Return to focus','休息已结束，回来开始下一轮专注。':'Break finished. Start your next round.',
  '休息已结束，回来开始下一轮专注。\n点击打开方块钟。':'Break finished. Start your next round.\nTap to open Blockcolc.',
  '实时专注与休息':'Live focus & breaks','在流体云、锁屏和通知栏显示专注或休息的实时倒计时':'Live focus & break countdowns',
};
let source=fs.readFileSync(file,'utf8');
source=source.replace(/"(?:\\.|[^"\\])*"/g,literal=>{let value;try{value=JSON.parse(literal);}catch{return literal;}return Object.hasOwn(copy,value)?`ui(context, ${literal}, ${JSON.stringify(copy[value])})`:literal;});
source=source.replaceAll('ensureChannel(manager)','ensureChannel(context, manager)').replace('ensureChannel(NotificationManager manager)','ensureChannel(Context context, NotificationManager manager)');
fs.writeFileSync(file,source);
