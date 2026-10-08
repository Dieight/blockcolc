/** Original pixel portal, review-only until its choreography is approved. */
export function createPortalMotion(host:HTMLElement,onCovered:()=>Promise<void>,baseDuration=2200){
  let active=false,disposed=false,generation=0,animations:Animation[]=[],overlay:HTMLDivElement|null=null;
  function clean(){animations.forEach(item=>item.cancel());animations=[];overlay?.remove();overlay=null;}
  const reduced=matchMedia('(prefers-reduced-motion:reduce)');
  async function travel(direction:1|-1=1){
    if(active||disposed)return;
    if(reduced.matches){active=true;try{await onCovered();}finally{active=false;}return;}
    active=true;const token=++generation;
    host.dataset.portalActive='true';host.dataset.portalPhase='appear';
    const layer=document.createElement('div');layer.className='portal-overlay';layer.setAttribute('aria-hidden','true');
    if(host===document.body)layer.style.position='fixed';
    const shade=document.createElement('div');shade.className='portal-shade';
    const door=document.createElement('div');door.className='portal-door';
    const field=document.createElement('div');field.className='portal-field';
    for(let i=0;i<3;i++){const ripple=document.createElement('i');ripple.className='portal-ripple';ripple.style.setProperty('--ripple',String(i));field.append(ripple);}
    door.append(field);
    for(let row=0;row<6;row++)for(let column=0;column<4;column++)if(row===0||row===5||column===0||column===3){
      const block=document.createElement('div');block.className='portal-block';
      Object.assign(block.style,{left:`${column*25}%`,top:`${row*100/6}%`});
      block.style.setProperty('--block-index',String(row*4+column));door.append(block);
    }
    layer.append(shade,door);host.append(layer);overlay=layer;
    const scale=Math.max(layer.clientWidth/(door.clientWidth*.5),layer.clientHeight/(door.clientHeight*2/3))*1.18;
    const pose=(zoom:number,tilt=0)=>`translate(-50%,-50%) perspective(900px) rotateY(${tilt}deg) scale(${zoom})`;
    const play=async(element:HTMLElement,frames:Keyframe[],part:number,easing='cubic-bezier(.22,.65,.25,1)')=>{
      const motion=element.animate(frames,{duration:baseDuration*part,easing,fill:'forwards'});
      animations.push(motion);await motion.finished.catch(()=>undefined);
      if(disposed||generation!==token)throw new Error('Portal review disposed');
    };
    try{
      void play(shade,[{opacity:0},{opacity:1}],.16).catch(()=>undefined);
      await play(door,[{opacity:0,transform:pose(.68,-14*direction)},{opacity:1,transform:pose(1.015)},{opacity:1,transform:pose(1)}],.18);
      await play(door,[{transform:pose(1)},{transform:pose(1.02)}],.11);
      host.dataset.portalPhase='enter';
      await play(door,[{transform:pose(1.02)},{transform:pose(scale)}],.24,'cubic-bezier(.56,.02,.83,.42)');
      host.dataset.portalPhase='covered';
      // The aperture, not a separate flash, is fully opaque during the real reframe.
      await onCovered();
      if(disposed||generation!==token)return;
      host.dataset.portalPhase='exit';
      await play(door,[{transform:pose(scale)},{transform:pose(1,4*direction)}],.3,'cubic-bezier(.1,.7,.24,1)');
      host.dataset.portalPhase='dismiss';
      void play(shade,[{opacity:1},{opacity:0}],.17).catch(()=>undefined);
      await play(door,[{opacity:1,transform:pose(1,4*direction)},{opacity:0,transform:pose(.8,12*direction)}],.17);
    }finally{
      if(generation===token){clean();active=false;host.dataset.portalActive='false';host.dataset.portalPhase='idle';}
    }
  }
  return{travel,configure(duration:number){if(Number.isFinite(duration))baseDuration=Math.max(1500,Math.min(3500,duration));},
    dispose(){disposed=true;generation++;clean();active=false;host.dataset.portalActive='false';host.dataset.portalPhase='idle';}};
}
