import {afterEach,describe,expect,it} from 'vitest';
import {formatDurationSummary} from './focus-format';
import {setAppLanguage,t} from './i18n';

afterEach(()=>setAppLanguage('zh-CN'));
describe('plan summary language',()=>{
  it('localizes duration units in each branch, without translating user text',()=>{
    setAppLanguage('en');
    expect(formatDurationSummary(45*60_000)).toBe('45 min');
    expect(formatDurationSummary(60*60_000)).toBe('1 h');
    expect(formatDurationSummary(95*60_000)).toBe('1 h 35 min');
    expect(t('{0} 轮 · 总计 {1}',2,formatDurationSummary(95*60_000))).toBe('2 rounds · 1 h 35 min total');
  });
  it('covers import actions and habit plan note',()=>{
    setAppLanguage('en');
    expect(t('导入备份')).toBe('Import backup');expect(t('导入')).toBe('Import');
    expect(t('选择备份')).toBe('Choose');expect(t('份')).toBe('copies');
    expect(t('完成即推进建筑。')).toBe('Each round advances the building.');
  });
  it('keeps the existing Chinese duration format',()=>{
    expect(formatDurationSummary(45*60_000)).toBe('45 分钟');
    expect(formatDurationSummary(60*60_000)).toBe('1 小时');
    expect(formatDurationSummary(95*60_000)).toBe('1 小时 35 分钟');
  });
});
