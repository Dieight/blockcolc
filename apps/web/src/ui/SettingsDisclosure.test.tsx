import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {SettingsDisclosure} from './SettingsDisclosure';

describe('secondary setting semantics',()=>{
  it('keeps a concise stable name and associates its visible description and saved value',()=>{
    const html=renderToStaticMarkup(<SettingsDisclosure title="习惯任务" description="时长与轮数" value="45 分钟"><input/></SettingsDisclosure>);
    expect(html).toContain('aria-label="习惯任务"');expect(html).toMatch(/aria-describedby="[^"]+-description [^"]+-value"/);
    expect(html).toContain('时长与轮数');expect(html).toContain('45 分钟');expect(html).toContain('aria-expanded="false"');
  });
  it('does not leave empty description references on a plain disclosure',()=>{
    const html=renderToStaticMarkup(<SettingsDisclosure title="更多"><input/></SettingsDisclosure>);
    expect(html).not.toContain('aria-describedby');expect(html).toContain('aria-controls=');
  });
});
