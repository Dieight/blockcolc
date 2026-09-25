import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourceRoot = dirname(fileURLToPath(import.meta.url));
const styleRoot = resolve(sourceRoot, 'styles');
const expectedImports = [
  'tokens.css', 'base.css', 'foundation.css', 'settings.css', 'workbench.css',
  'tasks-stats.css', 'setup.css', 'world.css', 'minimal-mode.css', 'theme.css', 'building-memory.css', 'glass-overlays.css',
];

describe('style architecture', () => {
  it('has one ordered runtime entry and no legacy override entry', () => {
    const main = readFileSync(resolve(sourceRoot, 'main.tsx'), 'utf8');
    expect(main).toContain("import './styles/index.css';");
    expect(main).not.toMatch(/styles(?:-overrides)?\.css/);
    expect(existsSync(resolve(sourceRoot, 'styles.css'))).toBe(false);
    expect(existsSync(resolve(sourceRoot, 'styles-overrides.css'))).toBe(false);

    const index = readFileSync(resolve(styleRoot, 'index.css'), 'utf8');
    const imports = [...index.matchAll(/@import '\.\/(.+?)';/g)].map((match) => match[1]);
    expect(imports).toEqual(expectedImports);
    expectedImports.forEach((file) => expect(existsSync(resolve(styleRoot, file))).toBe(true));
  });

  it('keeps version numbers out of current selectors and new feature overrides', () => {
    const css = expectedImports.map((file) => readFileSync(resolve(styleRoot, file), 'utf8')).join('\n');
    expect(css).not.toMatch(/\.v\d+(?:-|\b)/i);
    expect(readFileSync(resolve(styleRoot, 'building-memory.css'), 'utf8')).not.toContain('!important');
    expect(readFileSync(resolve(styleRoot, 'glass-overlays.css'), 'utf8')).not.toContain('!important');
    expect(readFileSync(resolve(styleRoot, 'tokens.css'), 'utf8')).not.toContain('!important');
  });

  it('keeps reading and functional glass independent of the immersive preference', () => {
    const tokens=readFileSync(resolve(styleRoot,'tokens.css'),'utf8');
    expect(tokens).not.toContain('--glass-alpha-scale');
    expect(tokens).not.toContain('--glass-blur-scale');
    expect(tokens).toContain('--sheet-glass-background: var(--reading-glass-background)');
    const world=readFileSync(resolve(sourceRoot,'WorldScreenV7.tsx'),'utf8');
    expect(world).not.toContain("root.style.setProperty('--focus-glass-");
    expect(readFileSync(resolve(sourceRoot,'use-focus-preferences.ts'),'utf8')).toContain("root.style.setProperty('--focus-glass-");
  });
});
