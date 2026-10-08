import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {bootSceneFromSample} from './boot-scenes';
import {BootScene} from './LoadingPage';
import {TOMATO_STAGES,TomatoLoading} from './TomatoLoading';
describe('loading scenes',()=>{
  it('selects both families without replacing house variants',()=>{
    expect(bootSceneFromSample(0)).toBe('house');expect(bootSceneFromSample(.49)).toBe('house');
    expect(bootSceneFromSample(.5)).toBe('tomato');expect(bootSceneFromSample(.99)).toBe('tomato');
    expect(bootSceneFromSample(NaN)).toBe('house');
    expect(renderToStaticMarkup(createElement(BootScene,{scene:'house'}))).toContain('boot-windmill-rotor');
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
