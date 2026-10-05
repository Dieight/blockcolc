/** Code locations only. Never retain error text, task titles, URL queries or full stacks. */
export function renderRecoveryDiagnostic(error: Error, componentStack = '') {
  const category = /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(error.name) ? error.name : 'Error';
  const frames = Array.from((error.stack ?? '').split('\n').slice(1).join('\n').matchAll(/\/([A-Za-z0-9._-]+\.(?:[cm]?js|tsx?)):(\d+):(\d+)/g))
    .slice(0, 4).map(match => ({ file: match[1], line: Number(match[2]), column: Number(match[3]) }));
  const components = Array.from(componentStack.matchAll(/\bat ([A-Za-z_$][A-Za-z0-9_$]*)/g)).slice(0, 6).map(match => match[1]);
  return { category, frames, components };
}
