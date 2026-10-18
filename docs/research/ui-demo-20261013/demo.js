/* Standalone review prototype. No product database, service worker or network API. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const root = document.documentElement;
  // Shared 12 px glyph geometry from apps/web/src/ui/PixelIcon.tsx.
  const glyphs = {
    cube:['000111100000','011000011000','100000000100','101000010100','100110100100','100001000100','100001000100','010001001000','001001010000','000111100000','000000000000','000000000000'],
    clock:['000011110000','001100001100','010000000010','010001000010','100001000001','100001110001','100000000001','100000000001','010000000010','010000000010','001100001100','000011110000'],
    tasks:['011101111100','010100000000','011100000000','000000000000','011101111100','010100000000','011100000000','000000000000','011101111100','010100000000','011100000000','000000000000'],
    chart:['000000000000','000000011000','000000011000','011000011000','011000011000','011011011000','011011011000','011011011000','011011011000','000000000000','111111111110','000000000000'],
    gear:['000011110000','000110011000','011100001110','010000000010','110001100011','100010010001','100010010001','110001100011','010000000010','011100001110','000110011000','000011110000'],
    play:['000000000000','001100000000','001111000000','001111110000','001111111100','001111111100','001111110000','001111000000','001100000000','000000000000','000000000000','000000000000'],
    check:['000000000000','000000000110','000000001100','000000011000','011000110000','001101100000','000111000000','000010000000','000000000000','000000000000','000000000000','000000000000'],
    plus:['000000000000','000001100000','000001100000','000001100000','000011110000','011111111110','011111111110','000011110000','000001100000','000001100000','000001100000','000000000000'],
    minus:['000000000000','000000000000','000000000000','000000000000','011111111110','011111111110','000000000000','000000000000','000000000000','000000000000','000000000000','000000000000'],
    edit:['000000001100','000000010010','000000101100','000001011000','000010110000','000101100000','001011000000','010110000000','011100000000','111000000000','000000000000','000000000000'],
    trophy:['000111111000','011100001110','010100001010','010100001010','001111111100','000011110000','000001100000','000001100000','000111111000','000111111000','000000000000','000000000000'],
    sprout:['011100000000','011110001110','000110011110','000011111000','000001100000','000001100000','000001100000','000001100000','001111111100','000000000000','000000000000','000000000000'],
    chest:['000000000000','001111111100','011000000110','010000000010','011111111110','010001100010','010001100010','010000000010','011111111110','000000000000','000000000000','000000000000'],
    close:['000000000000','011000001100','011100011100','001110111000','000111110000','000011100000','000111110000','001110111000','011100011100','011000001100','000000000000','000000000000'],
    chevron:['000000000000','000000000000','011000001100','001100011000','000110110000','000011100000','000001000000','000000000000','000000000000','000000000000','000000000000','000000000000'],
    map:['000000000000','011110011110','010010110010','010010010010','010010010010','010010010010','010010010010','010010010010','011110011110','000000000000','000000000000','000000000000'],
    hammer:['000000110000','000001111000','000011111100','000111111100','001111111000','000111110000','000011100000','000111000000','001110000000','011100000000','000000000000','000000000000'],
    flag:['001111111000','001000001000','001000110000','001111000000','001000000000','001000000000','001000000000','001000000000','001000000000','011110000000','000000000000','000000000000'],
    stop:['000000000000','011111111100','011111111100','011111111100','011111111100','011111111100','011111111100','011111111100','011111111100','011111111100','000000000000','000000000000'],
  };
  const path = (name, predicate = () => true) => glyphs[name].flatMap((row,y) => [...row].flatMap((v,x) => v === '1' && predicate(x,y) ? [`M${x} ${y}h1v1h-1z`] : [])).join('');
  function icon(name) {
    const part = (key, predicate) => `<path data-part="${key}" d="${path(name,predicate)}"/>`;
    let content;
    if(name === 'clock') content = part('face',(x,y) => !(x>=5 && x<=7 && y>=3 && y<=5)) + part('hour',(x,y) => x>=6 && x<=7 && y===5) + part('minute',(x,y) => x===5 && y>=3 && y<=5);
    else if(name === 'gear') content = part('outer',(x,y) => !(x>=4 && x<=7 && y>=4 && y<=7)) + part('center',(x,y) => x>=4 && x<=7 && y>=4 && y<=7);
    else if(name === 'tasks') content = [0,1,2].map(i => part(`row${i}`,(_x,y) => y>=i*4 && y<i*4+3)).join('');
    else if(name === 'chart') content = part('base',(_x,y) => y===10) + [0,1,2].map(i => part(`bar${i}`,(x,y) => y<9 && x>=1+i*3 && x<=2+i*3)).join('');
    else content = `<path d="${path(name)}"/>`;
    return `<svg viewBox="0 0 12 12" class="icon" aria-hidden="true" focusable="false">${content}</svg>`;
  }
  $$('[data-icon]').forEach(element => { element.outerHTML = icon(element.dataset.icon); });
  $('#brand-icon').innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges"><path fill="#d4523f" d="M4 3h7v1h2v2h1v7h-2v2H4v-1H2v-2H1V7h1V5h2z"/><path fill="#a63e34" d="M2 6h2v1h2v8H4v-1H2v-2H1V7h1z"/><path fill="#ed7660" d="M4 3h7v1h2v2H6V5H4z"/><path fill="#8d3c33" d="M7 6h5v1h1v6h-1v1H7v-1H6V7h1z"/><path fill="#f1e8d5" d="M8 7h4v5h-1v1H7V8h1z"/><path fill="#344d3d" d="M9 8h1v2h2v1H9z"/><path fill="#35533c" d="M7 1h3v1h3v2h-3v1H7V4H4V2h3z"/><path fill="#64905b" d="M7 0h3v1h3v1h-3v1H7V2H4V1h3z"/><path fill="#91b377" d="M7 0h3v1H7zM4 1h3v1H4z"/><path fill="#486943" d="M8 2h2v2H8z"/></svg>';
  $$('.pixel-meter').forEach(meter => { meter.innerHTML = Array.from({length:20},(_,i) => `<i class="${i<Number(meter.dataset.progress)/5 ? 'on' : ''}"></i>`).join(''); });
  let toastTimer;
  function toast(message) { clearTimeout(toastTimer); $('#toast').textContent=message; $('#toast').hidden=false; toastTimer=setTimeout(() => { $('#toast').hidden=true; },3200); }
  const routes = ['timer','tasks','stats','settings'];
  let currentRoute='timer', statsSeen=false;
  function navigate(route,updateHash=true) {
    if(!routes.includes(route)) return;
    const changed=currentRoute !== route;
    currentRoute=route;
    $$('.page').forEach(page => { page.hidden=page.id!==`page-${route}`; });
    $$('[data-route]').forEach(button => {
      if(button.dataset.route===route) { button.setAttribute('aria-current','page');button.classList.remove('nav-animate');void button.offsetWidth;button.classList.add('nav-animate'); }
      else button.removeAttribute('aria-current');
    });
    if(updateHash && location.hash!==`#${route}`) history.replaceState(null,'',`#${route}`);
    if(changed) window.scrollTo({top:0,behavior:'instant'});
    if(route==='stats'&&!statsSeen){
      statsSeen=true;
      if(!reduced) $$('[data-day]').forEach((cell,index)=>{const color=getComputedStyle(cell).backgroundColor;cell.animate([{backgroundColor:getComputedStyle(root).getPropertyValue('--level-0')},{backgroundColor:color}],{duration:1,delay:Math.floor(index/7)*38,fill:'backwards',easing:'steps(1,end)'});});
    }
  }
  $$('[data-route]').forEach(button => button.addEventListener('click',() => navigate(button.dataset.route)));
  $$('[data-go]').forEach(button => button.addEventListener('click',() => navigate(button.dataset.go)));
  window.addEventListener('hashchange',() => { if(routes.includes(location.hash.slice(1))) navigate(location.hash.slice(1),false); });
  $('.brand').addEventListener('click',event => {event.preventDefault();navigate('timer');});
  // Native dialogs supply focus trapping, Escape and return-to-trigger behavior.
  function openDialog(id){const dialog=$(id);if(!dialog.open) dialog.showModal();}
  $$('dialog').forEach(dialog => dialog.addEventListener('click',event => { if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom) dialog.close();} }));
  $('#review-notes').onclick=() => openDialog('#notes-dialog');
  $('#world-detail').onclick=() => openDialog('#memory-dialog');
  $('#show-memory').onclick=() => {$('#notes-dialog').close();openDialog('#memory-dialog');};
  $('#memory-continue').onclick=() => {$('#memory-dialog').close();navigate('timer');};
  let theme='light', font='pixel';
  const motionQuery=matchMedia('(prefers-reduced-motion: reduce)');
  let reduced=motionQuery.matches, opaque=matchMedia('(prefers-reduced-transparency: reduce)').matches;
  function applyTheme(value){theme=value;root.dataset.theme=value;$('#theme-toggle').textContent=value==='dark'?'浅色':'深色';$('#theme-toggle').setAttribute('aria-pressed',String(value==='dark'));$$('[data-theme-value]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.themeValue===value)));$('#theme-segment').style.setProperty('--index',value==='dark'?'1':'0');}
  function applyFont(value){font=value;root.dataset.font=value;$('#font-toggle').textContent=value==='pixel'?'原字体':'像素';$('#font-toggle').setAttribute('aria-pressed',String(value==='system'));$$('[data-font-value]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.fontValue===value)));$('#font-segment').style.setProperty('--index',value==='system'?'1':'0');}
  function applyMotion(value){reduced=value || motionQuery.matches;root.dataset.motion=reduced?'reduced':'full';if(reduced)document.getAnimations().forEach(animation=>animation.cancel());$('#motion-toggle').setAttribute('aria-pressed',String(reduced));$('#motion-switch').setAttribute('aria-checked',String(reduced));}
  function applyTransparency(value){opaque=value;root.dataset.transparency=value?'reduced':'full';$('#transparency-switch').setAttribute('aria-checked',String(value));}
  $('#theme-toggle').onclick=()=>applyTheme(theme==='light'?'dark':'light');
  $('#font-toggle').onclick=()=>applyFont(font==='pixel'?'system':'pixel');
  $('#motion-toggle').onclick=()=>applyMotion(!reduced);
  $$('[data-theme-value]').forEach(b=>b.onclick=()=>applyTheme(b.dataset.themeValue));
  $$('[data-font-value]').forEach(b=>b.onclick=()=>applyFont(b.dataset.fontValue));
  $$('.switch').forEach(b=>b.onclick=()=>{const value=b.getAttribute('aria-checked')!=='true';if(b.id==='motion-switch')applyMotion(value);else if(b.id==='transparency-switch')applyTransparency(value);else {b.setAttribute('aria-checked',String(value));toast('已更新本页示例偏好');}});
  motionQuery.addEventListener('change',()=>applyMotion(motionQuery.matches));
  applyTheme(theme);applyFont(font);applyMotion(reduced);applyTransparency(opaque);
  // The clock is a wall-time projection. It does not backfill real sessions.
  let focusMinutes=25, breakMinutes=5, rounds=1, draftRounds=1;
  let running=false, deadline=0, secondsLeft=1500;
  const taskTitles=['收集沿途的植物与叶片','画下三种叶子的轮廓','整理图鉴的文字与版式'];
  let selectedTask=0;
  function renderTasks(){
    $('#task-list').replaceChildren(...taskTitles.map((title,index)=>{
      const button=document.createElement('button');button.className='task-row';button.setAttribute('aria-pressed',String(index===selectedTask));
      button.innerHTML=`<span class="task-index">0${index+1}</span><span class="task-copy"><strong></strong><span><span>完成 75% · 25 分钟投入</span><span class="pixel-meter" aria-hidden="true">${Array.from({length:12},(_,i)=>`<i class="${i<9?'on':''}"></i>`).join('')}</span></span></span>${icon(index===selectedTask?'check':'play')}`;
      button.querySelector('strong').textContent=title;
      button.onclick=()=>{if(running){toast('请先结束本轮示例，再切换任务');return;}selectedTask=index;$('#current-task-title').textContent=title;renderTasks();toast(`下一轮：${title}`);};return button;
    }));
  }
  function renderClock(){
    const seconds=running?Math.max(0,Math.ceil((deadline-Date.now())/1000)):secondsLeft;
    const mm=String(Math.floor(seconds/60)).padStart(2,'0'),ss=String(seconds%60).padStart(2,'0');
    $('#timer-value').innerHTML=`${mm}<span>:</span>${ss}`;$('#timer-value').setAttribute('aria-label',`剩余 ${Number(mm)} 分 ${Number(ss)} 秒`);
    if(running&&seconds===0){running=false;secondsLeft=0;updateTimerActions();openReport();}
  }
  function updateTimerActions(){
    $('#timer-mode').textContent=running?'正在专注 · 示例':'准备开始';
    $('#start-focus').innerHTML=icon(running?'stop':'play')+`<span>${running?'结束并汇报':'开始这一轮'}</span>`;
    $('#edit-plan').disabled=running;$('#focus-minutes').disabled=running;$('#break-minutes').disabled=running;
    $('#focus-hint').textContent=running?'把注意力，轻轻放回眼前。':'留一小段时间，只做眼前这一件。';
    $('#plan-summary').textContent=`${rounds} 轮专注 · 每轮 ${focusMinutes} 分钟`;
    $('#round-track').innerHTML=Array.from({length:rounds},(_,i)=>`<i class="${i===0?'current':''}"></i>`).join('');
  }
  function openReport(){ $('#report-task').textContent=taskTitles[selectedTask];$('#report-range').value='75';$('#report-value').textContent='75%';openDialog('#report-dialog'); }
  $('#start-focus').onclick=()=>{if(running){openReport();return;}if(secondsLeft===0)secondsLeft=focusMinutes*60;running=true;deadline=Date.now()+secondsLeft*1000;updateTimerActions();renderClock();};
  $('#finish-focus').onclick=openReport;
  setInterval(renderClock,1000);document.addEventListener('visibilitychange',renderClock);
  function updateDraft(){
    $('#draft-rounds').textContent=String(draftRounds);$('#round-minus').disabled=draftRounds===1;$('#round-plus').disabled=draftRounds===8;
    $('#plan-total').textContent=`${draftRounds*focusMinutes} 分钟专注 · ${draftRounds===1?'无轮间休息':`${(draftRounds-1)*breakMinutes} 分钟休息`}`;
    $('#plan-sequence').innerHTML=Array.from({length:draftRounds},(_,i)=>`${i?'<i class="rest"></i>':''}<i></i>`).join('');
  }
  $('#edit-plan').onclick=()=>{draftRounds=rounds;updateDraft();openDialog('#plan-dialog');};
  $('#round-minus').onclick=()=>{draftRounds=Math.max(1,draftRounds-1);updateDraft();};
  $('#round-plus').onclick=()=>{draftRounds=Math.min(8,draftRounds+1);updateDraft();};
  $('#save-plan').onclick=()=>{rounds=draftRounds;secondsLeft=focusMinutes*60;updateTimerActions();renderClock();$('#plan-dialog').close();toast('这一段时间，安排好了');};
  for(const [id,min,max] of [['focus-minutes',1,180],['break-minutes',0,60]]){
    const field=$(`#${id}`);field.addEventListener('change',()=>{
      const previous=id==='focus-minutes'?focusMinutes:breakMinutes;
      if(field.value.trim()===''||!Number.isInteger(Number(field.value))||Number(field.value)<min||Number(field.value)>max){field.value=String(previous);toast(`请输入 ${min}–${max} 之间的整数`);return;}
      if(id==='focus-minutes'){focusMinutes=Number(field.value);secondsLeft=focusMinutes*60;renderClock();}else breakMinutes=Number(field.value);
      updateTimerActions();toast('已更新本页示例偏好');
    });
  }
  $('#report-range').oninput=()=>{$('#report-value').textContent=`${$('#report-range').value}%`;};
  let reportTimer;
  $('#save-report').onclick=()=>{
    const button=$('#save-report');button.disabled=true;button.textContent='材料已送达！';
    running=false;secondsLeft=focusMinutes*60;renderClock();updateTimerActions();
    clearTimeout(reportTimer);reportTimer=setTimeout(()=>{$('#report-dialog').close();button.disabled=false;button.textContent='送达这次的材料';toast('汇报反馈演示完成，示例数据保持原样');},2000);
  };
  $('#new-project').onclick=()=>openDialog('#new-dialog');$('#close-new').onclick=()=>$('#new-dialog').close();
  $('#new-task-form').onsubmit=event=>{
    event.preventDefault();const title=$('#new-title').value.trim();if(!title){$('#new-title').setCustomValidity('请填写任务名称');$('#new-title').reportValidity();return;}
    const card=document.createElement('article');card.className='extra-project';const heading=document.createElement('h2');heading.textContent=title;const note=document.createElement('p');note.textContent='已加入示例列表 · 尚未开始 · 刷新后重置';card.append(heading,note);$('.tasks-layout').after(card);$('#new-title').value='';$('#new-dialog').close();toast('示例任务已加入列表');
  };
  $('#new-title').addEventListener('input',()=>$('#new-title').setCustomValidity(''));
  $('#export-demo').onclick=()=>{
    const data={format:'blockcolc-ui-demo-preferences',version:1,theme,font,reducedMotion:reduced,reducedTransparency:opaque,focusMinutes,breakMinutes,rounds};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='blockcolc-ui-demo-preferences.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已生成示例偏好文件');
  };
  // Deterministic fixture: only these synthetic sessions are painted, empty dates stay empty.
  const endDate=new Date(Date.UTC(2026,9,18)),days=Array.from({length:182},(_,i)=>{
    const date=new Date(endDate.getTime()-(181-i)*86400000),key=date.toISOString().slice(0,10);
    const age=Math.round((Date.UTC(2026,9,13)-date.getTime())/86400000);
    const minutes=age<0||age>120||i%7===6||i%11===0?0:(i%9===0?600:i%5===0?420:i%4===0?225:i%3===0?75:0);
    return {key,minutes:key==='2026-10-13'?75:minutes,rounds:key==='2026-10-13'?3:Math.floor(minutes/25)};
  });
  const dayLevel=minutes=>minutes===0?0:minutes<=180?1:minutes<=360?2:minutes<=540?3:4;
  let selectedStart=days.findIndex(day=>day.key==='2026-10-13'),selectedEnd=selectedStart,focusDay=selectedStart,selectionAnchor=selectedStart,dragging=false,highlightLevel=null;
  function durationText(minutes){const hours=Math.floor(minutes/60),rest=minutes%60;return `${hours?`${hours} 小时 `:''}${rest||!hours?`${rest} 分钟`:''}`.trim();}
  function updateSelection(start,end=start){
    selectedStart=Math.min(start,end);selectedEnd=Math.max(start,end);const selected=days.slice(selectedStart,selectedEnd+1),minutes=selected.reduce((sum,day)=>sum+day.minutes,0),count=selected.reduce((sum,day)=>sum+day.rounds,0),active=selected.filter(day=>day.minutes>0).length;
    $('#selected-period').textContent=start===end?`${days[start].key.replaceAll('-',' / ')}`:`${days[selectedStart].key.replaceAll('-',' / ')} — ${days[selectedEnd].key.replaceAll('-',' / ')}`;
    $('#selected-duration').innerHTML=`${Math.floor(minutes/60)}<small>小时</small>${minutes%60}<small>分钟</small>`;$('#selected-rounds').innerHTML=`${count} <small>/ ${selected.length*8}</small>`;$('#selected-days').textContent=String(active);
    $('#allocation-duration').textContent=durationText(minutes);$('#allocation').setAttribute('aria-label',minutes?'所选范围内的投入全部归于植物图鉴项目':'所选日期没有投入');$('.allocation-label').textContent=minutes?'做一本小小的植物图鉴':'这段时间，还是一片留白';$('#allocation').style.visibility=minutes?'visible':'hidden';
    $$('[data-day]').forEach((button,index)=>{button.setAttribute('aria-pressed',String(index>=selectedStart&&index<=selectedEnd));button.tabIndex=index===focusDay?0:-1;});
  }
  $('#heatmap').replaceChildren(...days.map((day,index)=>{
    const button=document.createElement('button');button.type='button';button.dataset.day=String(index);button.dataset.level=String(dayLevel(day.minutes));button.setAttribute('aria-label',`${day.key}，${durationText(day.minutes)}`);button.title=`${day.key} · ${durationText(day.minutes)}`;button.tabIndex=index===focusDay?0:-1;
    button.addEventListener('pointerdown',event=>{if(event.button!==0)return;dragging=true;focusDay=index;selectionAnchor=index;updateSelection(index);});
    button.addEventListener('pointerenter',()=>{if(dragging){focusDay=index;updateSelection(selectionAnchor,index);}});
    button.addEventListener('click',()=>{if(selectedStart===selectedEnd){focusDay=index;selectionAnchor=index;updateSelection(index);}});
    button.addEventListener('keydown',event=>{
      const shifts={ArrowLeft:-7,ArrowRight:7,ArrowUp:-1,ArrowDown:1,Home:-index,End:181-index};
      if(event.key in shifts){event.preventDefault();const next=Math.max(0,Math.min(181,index+shifts[event.key]));focusDay=next;if(!event.shiftKey)selectionAnchor=next;updateSelection(event.shiftKey?selectionAnchor:next,next);$(`[data-day="${next}"]`).focus();}
      else if(event.key==='Enter'||event.key===' '){event.preventDefault();focusDay=index;selectionAnchor=index;updateSelection(index);}
    });return button;
  }));
  window.addEventListener('pointerup',()=>{dragging=false;});window.addEventListener('pointercancel',()=>{dragging=false;});
  $('#heatmap').addEventListener('pointermove',event=>{if(!dragging)return;const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-day]');if(target){focusDay=Number(target.dataset.day);updateSelection(selectionAnchor,focusDay);}});
  $$('.calendar-legend button').forEach(button=>button.onclick=()=>{
    highlightLevel=highlightLevel===button.dataset.level?null:button.dataset.level;$('#heatmap').classList.toggle('has-highlight',!!highlightLevel);
    const longest=Math.max(...days.map(day=>day.minutes));
    $$('[data-day]').forEach((cell,index)=>{cell.classList.toggle('highlight',cell.dataset.level===highlightLevel);cell.classList.toggle('is-longest',highlightLevel==='4'&&days[index].minutes===longest);});
    $$('.calendar-legend button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.level===highlightLevel)));
  });
  // The approved hundred-field graphic, with 100 pixels = 100% of this one-project fixture.
  $('#allocation').innerHTML=Array.from({length:100},(_,i)=>{const radius=Math.sqrt(i+.5)*7.6,angle=i*2.39996323,x=105+Math.cos(angle)*radius,y=88+Math.sin(angle)*radius;return `${i%5===0?`<path d="M105 88L${x.toFixed(2)} ${y.toFixed(2)}" stroke="var(--line)" stroke-width=".6"/>`:''}<rect x="${(x-2).toFixed(2)}" y="${(y-2).toFixed(2)}" width="4" height="4" fill="var(--accent)"/>`;}).join('');
  renderTasks();renderClock();updateTimerActions();updateSelection(selectedStart);
  navigate(routes.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'timer',false);
  // Make the review notes reachable in narrow layouts without crowding the app navigation.
  const mobileNotes=document.createElement('button');mobileNotes.className='text-action mobile-review-notes';mobileNotes.textContent='查看设计说明 ↗';mobileNotes.onclick=()=>openDialog('#notes-dialog');$('.page-footnote').append(mobileNotes);
})();
