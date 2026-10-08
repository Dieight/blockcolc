import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import '../styles/index.css';
import './v260-review.css';
import './portal-review.css';
function PortalReview(){
  const [kind,setKind]=useState<'portal'|'tomato'|'house'>('portal');
  const [theme,setTheme]=useState<'light'|'dark'>('light');
  return <main className="review-layout">
    <header className="review-heading"><h1>v2.6.0 · 传送门与番茄循环</h1><p>传送门直接复用计时页；样例只用独立内存，不读取本机记录</p></header>
    <div className="review-options"><fieldset><legend>审看内容</legend>
      <button type="button" aria-pressed={kind==='portal'} onClick={()=>setKind('portal')}>实际计时页 · 传送门</button>
      <button type="button" aria-pressed={kind==='tomato'} onClick={()=>setKind('tomato')}>番茄循环</button>
      <button type="button" aria-pressed={kind==='house'} onClick={()=>setKind('house')}>房屋风车</button>
    </fieldset><fieldset><legend>主题</legend><button type="button" aria-pressed={theme==='light'} onClick={()=>setTheme('light')}>浅色</button><button type="button" aria-pressed={theme==='dark'} onClick={()=>setTheme('dark')}>深色</button></fieldset></div>
    <div className="actual-review-phone"><iframe title={kind==='portal'?'实际计时页传送门':'加载动画池预览'} key={`${kind}-${theme}`} src={kind==='portal'?`/review-2.6.0-app.html?theme=${theme}`:`/review-2.6.0-loading.html?theme=${theme}&scene=${kind}`}/></div>
  </main>;
}
createRoot(document.getElementById('review-root')!).render(<PortalReview/>);
