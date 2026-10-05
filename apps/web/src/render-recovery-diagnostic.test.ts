import { describe, expect, it } from 'vitest';
import { renderRecoveryDiagnostic } from './render-recovery-diagnostic';

describe('private render recovery diagnostic', () => {
  it('keeps useful code locations but excludes error content, hostnames and URL queries', () => {
    const error = new TypeError('private task title');
    error.stack = 'TypeError: private task title\n at f (http://localhost/assets/WorldScreen-123.js:23:7)\n at https://private.example/path?token=secret';
    const diagnostic = renderRecoveryDiagnostic(error, '\n at WorldScreenV7 (http://localhost/src/WorldScreenV7.tsx:12:3)\n at App');
    expect(diagnostic).toEqual({ category: 'TypeError', frames: [{ file: 'WorldScreen-123.js', line: 23, column: 7 }], components: ['WorldScreenV7', 'App'] });
    const text = JSON.stringify(diagnostic);
    for (const forbidden of ['private', 'localhost', 'secret', 'token', 'http']) expect(text).not.toContain(forbidden);
  });
  it('bounds unusual error names and missing diagnostics', () => {
    const error = new Error('not retained'); error.name = 'task title with spaces'; error.stack = undefined;
    expect(renderRecoveryDiagnostic(error)).toEqual({ category: 'Error', frames: [], components: [] });
  });
});
