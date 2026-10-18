/** Only current summary fields are checked; historical failure logs stay intact. */
export function currentDocumentProblems({ product, todo, delivery }) {
  const problems = [];
  const current = todo.match(/^正式版本：\[v([\d.]+)\s*\/\s*(\d+)\]/m);
  const productCurrent = product.match(/^正式版本：v([\d.]+)，versionCode (\d+)。/m);
  if (!current || !productCurrent || current[1] !== productCurrent[1] || current[2] !== productCurrent[2]) {
    problems.push('BLOCKCOLC.md and docs/TODO.md must agree on the formal release');
  }
  if (current && !product.includes(`[发布记录](docs/releases/v${current[1]}.md)`)) problems.push('Product release link does not match the formal release');
  if (/^正式版本：.*已发布/m.test(todo)) {
    const pending = delivery.split(/^## /m).filter(section => /^(两个包|发布与关闭)\s/m.test(section));
    if (pending.some(section => /待生成|尚未创建 .*Release|待完整门禁/.test(section))) problems.push('Released delivery summary still contains pending publication placeholders');
  }
  return problems;
}
