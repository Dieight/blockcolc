import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { selectLocalBuiltinInput } from '../scripts/local-builtin-input.js';

describe('explicit local blueprint conversion and application build boundary', () => {
  it('requires an explicit input rather than scanning a machine-specific directory', () => {
    expect(() => selectLocalBuiltinInput(undefined)).toThrow('requires an explicit input directory');
    expect(() => selectLocalBuiltinInput('  ')).toThrow('requires an explicit input directory');
  });
  it('keeps the explicitly chosen directory intact, including spaces', () => {
    expect(selectLocalBuiltinInput(' C:/source blueprints/approved ')).toBe('C:/source blueprints/approved');
    expect(selectLocalBuiltinInput('C:/explicit')).toBe('C:/explicit');
  });
  it('builds Web and Android from workspace assets without an automatic conversion hook', () => {
    const web = JSON.parse(readFileSync(new URL('../../../apps/web/package.json', import.meta.url), 'utf8'));
    const android = JSON.parse(readFileSync(new URL('../../../apps/android/package.json', import.meta.url), 'utf8'));
    expect(web.scripts.prebuild).toBeUndefined();
    expect(web.scripts['prebuild:assets']).toBeUndefined();
    for (const script of [...Object.values(web.scripts), ...Object.values(android.scripts)]) {
      expect(script).not.toMatch(/package:local-builtins|D:[/\\]Litematic|BLOCKCOLC_LOCAL_BUILTIN_SOURCE_DIR/);
    }
  });
});
