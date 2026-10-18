import {describe,expect,it} from 'vitest';
import {MODE_TRANSITION_MS,modeViewport,modeViewportClip} from './mode-transition';

describe('world viewport transition',()=>{
  it('uses the accepted short symmetric duration',()=>expect(MODE_TRANSITION_MS).toBe(720));
  it.each([[360,800],[412,915],[915,412],[768,1024],[1440,900]])('keeps exact pixel endpoints at %sx%s',(width,height)=>{
    const ordinary={left:width>=700?88:0,top:58,width:width>=700?width-88:width,height:Math.min(320,height*.35)};
    const immersive={left:0,top:0,width,height};
    expect(modeViewport(ordinary,immersive,0)).toEqual(ordinary);
    expect(modeViewport(ordinary,immersive,1)).toEqual(immersive);
    expect(modeViewport(ordinary,immersive,-1)).toEqual(ordinary);
    expect(modeViewport(ordinary,immersive,2)).toEqual(immersive);
    expect(modeViewportClip(immersive,width,height)).toBe('inset(0px 0px 0px 0px)');
    for(const p of [.1,.25,.5,.75,.9]){
      const forward=modeViewport(ordinary,immersive,p),backward=modeViewport(immersive,ordinary,1-p);
      for(const key of ['left','top','width','height'] as const)expect(forward[key]).toBeCloseTo(backward[key],12);
    }
  });
  it('clips a window without adding scale or camera transforms',()=>{
    expect(modeViewportClip({left:20,top:58,width:360,height:280},412,915)).toBe('inset(58px 32px 577px 20px)');
  });
});
