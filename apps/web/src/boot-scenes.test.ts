import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {readFileSync} from 'node:fs';
import {bootSceneFromSample} from './boot-scenes';
import {BootScene,BootHouse} from './LoadingPage';
import {TOMATO_STAGES,TomatoLoading} from './TomatoLoading';
describe('loading scenes',()=>{
  it('selects both families without replacing house variants',()=>{
    expect(bootSceneFromSample(0)).toBe('house');expect(bootSceneFromSample(.49)).toBe('house');
    expect(bootSceneFromSample(.5)).toBe('tomato');expect(bootSceneFromSample(.99)).toBe('tomato');
    expect(bootSceneFromSample(NaN)).toBe('house');
    const markup=renderToStaticMarkup(createElement(BootScene,{scene:'house'}));
    expect(markup).toContain('boot-pixel-house');
    expect(markup).toContain('boot-house-block');
    expect(markup).not.toContain('boot-windmill-rotor');
    const variants=[0,1,2,3].map(variant=>renderToStaticMarkup(createElement(BootHouse,{variant})));
    expect(new Set(variants).size).toBe(4);
    variants.forEach((house,index)=>{
      expect(house).toContain(`data-boot-house="${index}"`);
      expect(house.match(/class="boot-house-block"/g)!.length).toBeGreaterThan(40);
      expect(house).toContain('animation-delay:');
    });
    const styles=readFileSync(new URL('./styles/loading-scenes.css',import.meta.url),'utf8');
    expect(styles).toContain('animation:pixel-house-build 4.8s steps(1,end) infinite');
    expect(styles).toContain(".boot-scene[data-paused='true'] .boot-house-block{animation-play-state:paused}");
    expect(styles).toContain('@media(prefers-reduced-motion:reduce){.boot-house-block{animation:none;opacity:1}}');
  });
  it('grows once then cycles fruit with one isolated falling layer',()=>{
    const markup=renderToStaticMarkup(createElement(TomatoLoading));
    expect(TOMATO_STAGES).toHaveLength(5);
    for(const stage of TOMATO_STAGES)expect(markup).toContain(`data-tomato-stage="${stage}"`);
    expect(markup.match(/class="tomato-fall"/g)).toHaveLength(1);
    expect(markup).not.toMatch(/<animate|<filter|requestAnimationFrame/);
    expect(markup).not.toMatch(/种子|腐烂|tomato-wilt|tomato-seed/);
  });
});
