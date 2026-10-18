import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {AnimatedDetails} from './AnimatedDetails';

describe('shared animated native disclosure',()=>{
  it('starts collapsed with inert content and an accessible summary',()=>{
    const html=renderToStaticMarkup(<AnimatedDetails summary="归档"><button>恢复</button></AnimatedDetails>);
    expect(html).toContain('aria-expanded="false"');expect(html).toContain('inert=""');
    expect(html).not.toContain(' open=""');expect(html).toContain('class="content-reveal"');
  });
  it('supports a deliberately open initial section without hiding controls',()=>{
    const html=renderToStaticMarkup(<AnimatedDetails defaultOpen summary="归档"><button>恢复</button></AnimatedDetails>);
    expect(html).toContain('open=""');expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('content-reveal is-open');expect(html).not.toContain('inert=""');
  });
});
