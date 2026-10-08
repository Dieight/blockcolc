import {describe,it,expect} from 'vitest';
import {ONBOARDING_KEY,shouldOfferTutorial,completeTutorial,TUTORIAL_PAGES} from './onboarding';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {OnboardingDialog} from './OnboardingDialog';
describe('first-install tutorial',()=>{
 function store(){const values=new Map<string,string>();return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};}
 it('offers once on fresh install, not on upgrade or an existing empty workspace',()=>{const s=store();expect(shouldOfferTutorial(s,true)).toBe(true);completeTutorial(s);expect(shouldOfferTutorial(s,true)).toBe(false);const legacy=store();expect(shouldOfferTutorial(legacy,false)).toBe(false);expect(legacy.getItem(ONBOARDING_KEY)).toBe('1');});
 it('does not trap first use when storage fails',()=>{const broken={getItem:()=>{throw Error('private');},setItem:()=>{throw Error('quota');}};expect(shouldOfferTutorial(broken,true)).toBe(true);expect(shouldOfferTutorial(broken,false)).toBe(false);expect(()=>completeTutorial(broken)).not.toThrow();});
 it('briefly covers task types, focus, world gestures, goals, stats, settings and recovery',()=>{const text=JSON.stringify(TUTORIAL_PAGES);for(const feature of ['习惯','双击','双指','今日目标','热力图','材质包','恢复','更新'])expect(text).toContain(feature);expect(TUTORIAL_PAGES).toHaveLength(6);for(const page of TUTORIAL_PAGES)expect(page.lines).toHaveLength(3);});
 it('shares the edge glass sheet and keeps feature numbers decorative',()=>{const html=renderToStaticMarkup(createElement(OnboardingDialog,{onClose:()=>{}}));expect(html).toContain('dialog-backdrop edge-sheet-backdrop tutorial-backdrop');expect(html).toContain('confirm-dialog tutorial-sheet');expect(html).toContain('class="tutorial-features"');expect([...html.matchAll(/class="tutorial-feature-index" aria-hidden="true"/g)]).toHaveLength(3);expect(html).toContain('aria-modal="true"');expect(html).toContain('关闭新手教程');});
});
