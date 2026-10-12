import {afterEach,describe,expect,it} from 'vitest';
import {appLocale,setAppLanguage,t} from './i18n';
import {parseFocusPreferences} from './focus-preferences';
import {LOCAL_BUILTIN_SOURCES} from '@blockcolc/voxel/local-blueprint-sources';
import {realWeatherLabel,WEATHER_LABELS} from './weather-labels';
import {localBlueprintTitle} from './builtin-blueprint-labels';
afterEach(()=>setAppLanguage('zh-CN'));
describe('presentation language',()=>{
  it('switches explicit labels without changing arbitrary user content',()=>{
    setAppLanguage('en');expect(t('设置')).toBe('Settings');expect(appLocale()).toBe('en-US');
    expect(t('我的自定义小任务')).toBe('我的自定义小任务');
    setAppLanguage('zh-CN');expect(t('设置')).toBe('设置');
  });
  it('preserves language and either font in preferences',()=>{
    for(const fontStyle of ['system','pixel'])expect(parseFocusPreferences({focusMinutes:45,breakMinutes:5,language:'en',fontStyle})).toMatchObject({language:'en',fontStyle});
    expect(parseFocusPreferences({focusMinutes:45,breakMinutes:5,language:'invalid'}).language).toBe('zh-CN');
  });
  it('formats both static templates and already formatted status messages',()=>{
    setAppLanguage('en');expect(t('第{0}/{1}轮',2,3)).toBe('Round 2/3');
    expect(t('第2/3轮')).toBe('Round 2/3');
  });
  it('preserves meaningful spaces at catalog boundaries without source trailing whitespace',()=>{
    setAppLanguage('en');
    expect(t('预计 ')).toBe('Preview ');
    expect(t('数据来源：')).toBe('Source: ');
    expect(t('习惯 · ')).toBe('Habit · ');
    expect(t('{0}结束 · ', 'Today')).toBe('Until Today · ');
  });
  it('translates every packaged supplemental title and description, not user content',()=>{
    setAppLanguage('en');
    for(const [filename,entry] of Object.entries(LOCAL_BUILTIN_SOURCES)){
      const title=filename.replace(/\.litematic$/,'');
      expect(t(title),entry.id).not.toMatch(/[\u3400-\u9fff]/);
      expect(t(entry.description),entry.id).not.toMatch(/[\u3400-\u9fff]/);
      expect(localBlueprintTitle(entry.id,'旧版本中文快照名'),entry.id).toBe(t(title));
    }
    expect(t('未分配 / 不可追溯')).toBe('Unassigned / untraceable');
    expect(localBlueprintTitle('custom-user-id','用户的蓝图名')).toBe('用户的蓝图名');
    expect(t('{0}结束 · 上下滑动调整',t('明天'))).toBe('Ends Tomorrow · swipe up or down');
  });
  it('uses provider codes to translate weather without re-requesting or mutating data',()=>{
    setAppLanguage('en');
    for(const code of Object.keys(WEATHER_LABELS))expect(realWeatherLabel(code,'原始天气')).not.toMatch(/[\u3400-\u9fff]/);
    expect(realWeatherLabel('306','中雨')).toBe('Moderate rain');
    expect(realWeatherLabel('new','新天气现象')).toBe('Real weather');
    setAppLanguage('zh-CN');expect(realWeatherLabel('306','Moderate rain')).toBe('中雨');
  });
});
