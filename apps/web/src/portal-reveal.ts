type Point=readonly [number,number];
type Stone={x:number;y:number;size:number};

const images=new Map<string,Promise<HTMLImageElement|null>>();
function backgroundImage(css:string) {
  const url=/^url\(["']?(.*?)["']?\)$/.exec(css)?.[1];
  if(!url)return Promise.resolve(null);
  let image=images.get(url);
  if(!image){image=new Promise(resolve=>{
    const item=new Image();item.onload=()=>resolve(item);item.onerror=()=>resolve(null);item.src=url;
  });images.set(url,image);}
  return image;
}
function outline(context:CanvasRenderingContext2D,points:readonly Point[]) {
  context.beginPath();points.forEach(([x,y],index)=>index?context.lineTo(x,y):context.moveTo(x,y));context.closePath();
}

/** Explicit viewport coordinates avoid WebView's animated even-odd CSS clip
 * reference-box bugs. Only this 500 ms cover paints, never the real world/UI. */
export async function revealPortalCover(options:{
  layer:HTMLElement;door:HTMLElement;field:HTMLElement;stone:HTMLElement;stones:readonly Stone[];
  width:number;height:number;block:number;duration:number;signal:AbortSignal;
  edge:(progress:number)=>readonly Point[];
}) {
  const {layer,door,field,stone,stones,width,height,block,duration,signal,edge}=options;
  const stoneStyle=getComputedStyle(stone);
  const palette=getComputedStyle(layer);
  // An opaque palette base stays independent of animated shorthand/opacity.
  const frameColor=palette.getPropertyValue('--portal-frame').trim()||'#282137';
  const fieldColor=palette.getPropertyValue('--portal-field').trim()||'#76459c';
  const [fieldImage,stoneImage]=await Promise.all([
    backgroundImage(getComputedStyle(field,'::before').backgroundImage),backgroundImage(stoneStyle.backgroundImage),
  ]);
  if(signal.aborted)throw new DOMException('Cancelled','AbortError');
  const cover=document.createElement('canvas'),skin=document.createElement('canvas');
  cover.className='mode-portal__reveal-cover';
  // CSS-pixel resolution is deliberate for the pixel cover; no DPR-dependent
  // bitmap/ref-box disagreement and no full device-resolution allocation.
  cover.width=skin.width=Math.ceil(width);cover.height=skin.height=Math.ceil(height);
  Object.assign(cover.style,{width:`${width}px`,height:`${height}px`});
  const paint=skin.getContext('2d'),context=cover.getContext('2d');
  if(!paint||!context)throw new Error('Portal cover unavailable');
  paint.fillStyle=frameColor;paint.fillRect(0,0,width,height);
  paint.fillStyle=fieldColor;paint.fillRect(block-1,block-1,width-block*2+2,height-block*2+2);
  if(fieldImage){
    const tile=document.createElement('canvas');tile.width=tile.height=96;
    tile.getContext('2d')!.drawImage(fieldImage,0,0,96,96);
    const pattern=paint.createPattern(tile,'repeat');
    if(pattern){paint.save();paint.translate(block-1,block-1);paint.globalAlpha=.42;paint.fillStyle=pattern;paint.fillRect(0,0,width-block*2+2,height-block*2+2);paint.restore();}
  }
  paint.imageSmoothingEnabled=false;
  for(const position of stones){
    if(stoneImage)paint.drawImage(stoneImage,position.x,position.y,position.size,position.size);
    else{paint.fillStyle=frameColor;paint.fillRect(position.x,position.y,position.size,position.size);}
  }
  context.drawImage(skin,0,0);layer.append(cover);door.style.visibility='hidden';
  await new Promise<void>((resolve,reject)=>{
    let frame=0,started:number|undefined,finished=false;
    const finish=(error?:Error)=>{if(finished)return;finished=true;cancelAnimationFrame(frame);signal.removeEventListener('abort',aborted);error?reject(error):resolve();};
    const aborted=()=>finish(new DOMException('Cancelled','AbortError'));
    signal.addEventListener('abort',aborted,{once:true});
    const tick=(now:number)=>{
      if(signal.aborted){aborted();return;}
      started??=now;
      const raw=Math.min(1,(now-started)/duration),progress=raw*raw;
      context.clearRect(0,0,width,height);context.globalCompositeOperation='source-over';context.drawImage(skin,0,0);
      const points=edge(progress);
      context.globalCompositeOperation='destination-out';outline(context,points);context.fill();
      context.globalCompositeOperation='source-over';
      if(raw>0&&raw<1){
        outline(context,points);context.strokeStyle='#d1a4ed';context.lineWidth=8*Math.sin(Math.PI*progress);context.stroke();
      }
      cover.dataset.revealProgress=String(progress);
      if(raw===1)finish();else frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
  });
}
