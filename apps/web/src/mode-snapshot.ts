import { captureWorldFrame } from './portal-backdrop';

/** In-memory UI pixels isolated from :has(), fixed layouts, IDs and live events. */
export function captureModeSnapshot(root:HTMLElement) {
  const {bitmap,bounds}=captureWorldFrame(root);
  const host=document.createElement('div');host.className='mode-transition__snapshot';host.inert=true;
  const shadow=host.attachShadow({mode:'open'}),pseudo:string[]=[];
  let serial=0;
  const frozenStyle=(style:CSSStyleDeclaration)=>Array.from(style)
    .filter(name=>!name.startsWith('animation')&&!name.startsWith('transition'))
    .map(name=>`${name}:${style.getPropertyValue(name)};`).join('')+'animation:none!important;transition:none!important;';
  const copy=(source:Node):Node|null=>{
    if(source.nodeType===Node.TEXT_NODE)return source.cloneNode();
    if(!(source instanceof Element))return null;
    const style=getComputedStyle(source);
    if(style.display==='none'||['SCRIPT','STYLE','LINK'].includes(source.tagName))return null;
    const target=source.cloneNode(false) as HTMLElement|SVGElement;
    for(const attr of [...target.attributes])if(/^(class|id|name|role|data-.+|aria-.+|on.+)$/.test(attr.name))target.removeAttribute(attr.name);
    target.setAttribute('style',frozenStyle(style));
    const id=String(++serial);target.setAttribute('data-copy',id);
    for(const part of ['::before','::after']){
      const computed=getComputedStyle(source,part);
      if(computed.content!=='none'&&computed.content!=='normal')pseudo.push(`[data-copy="${id}"]${part}{${frozenStyle(computed)}}`);
    }
    if(source instanceof HTMLCanvasElement&&target instanceof HTMLCanvasElement){
      target.width=source.width;target.height=source.height;
      try{target.getContext('2d')?.drawImage(source,0,0);}catch{/* A transient weather canvas may be empty. */}
    }else for(const node of source.childNodes){const child=copy(node);if(child)target.append(child);}
    return target;
  };
  const capturePart=(selector:string)=>{
    const source=root.querySelector<HTMLElement>(selector);
    if(!source||getComputedStyle(source).display==='none')return null;
    const rect=source.getBoundingClientRect();if(rect.width<=0||rect.height<=0)return null;
    const element=copy(source) as HTMLElement;
    Object.assign(element.style,{position:'fixed',left:`${rect.left}px`,top:`${rect.top}px`,right:'auto',bottom:'auto',width:`${rect.width}px`,height:`${rect.height}px`,minHeight:'0',maxHeight:'none',maxWidth:'none',margin:'0',boxSizing:'border-box',transform:'none'});
    shadow.append(element);return {element,bounds:rect};
  };
  const panel=capturePart('.focus-panel'),header=capturePart('.topbar'),navigation=capturePart('.bottom-nav'),hud=capturePart('.world-hud');
  const styles=document.createElement('style');styles.textContent=pseudo.join('\n');shadow.prepend(styles);
  return {host,bitmap,bounds,panel,header,navigation,hud,dispose(){host.remove();bitmap.remove();bitmap.width=bitmap.height=0;}};
}
