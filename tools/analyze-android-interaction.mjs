import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { decode } from '@jridgewell/sourcemap-codec';

const [reportPath, mapsRoot] = process.argv.slice(2);
if (!reportPath || !mapsRoot) throw new Error('Capture report and immutable source-map directory required');
const report = JSON.parse(await readFile(reportPath, 'utf8'));
if (report.status !== 'completed') throw new Error('Incomplete interaction capture');
const maps = new Map();
async function resolve(frame) {
  if (!frame.url) return { name: frame.functionName || '(anonymous)', source: '', line: 0 };
  const file = path.basename(new URL(frame.url).pathname);
  if (!maps.has(file)) {
    try { const map = JSON.parse(await readFile(path.join(mapsRoot, `${file}.map`), 'utf8')); maps.set(file, { ...map, decoded: decode(map.mappings) }); }
    catch { maps.set(file, null); }
  }
  const map = maps.get(file), segments = map?.decoded[frame.lineNumber];
  let chosen;
  for (const segment of segments ?? []) { if (segment[0] > frame.columnNumber) break; chosen = segment; }
  if (!chosen || chosen.length < 4) return { name: frame.functionName || '(anonymous)', source: file, line: frame.lineNumber + 1 };
  const [, sourceIndex, line, column, nameIndex] = chosen;
  const lines = map.sourcesContent?.[sourceIndex]?.split('\n') ?? [];
  let declaration;
  for (let n = line; n >= Math.max(0, line - 90); n--) {
    const match = /(?:function\s+([\w$]+)|(?:const|let)\s+([\w$]+)\s*=\s*(?:function|\([^)]*\)\s*=>)|this\.([\w$]+)\s*=\s*function)/.exec(lines[n] ?? '');
    if (match) { declaration = match[1] || match[2] || match[3]; break; }
  }
  return { name: declaration || (nameIndex === undefined ? undefined : map.names[nameIndex]) || frame.functionName || '(anonymous)',
    source: map.sources[sourceIndex].replace(/^(\.\.\/)+/, ''), line: line + 1,
    sourceLine: lines[line]?.trim(), generatedName: frame.functionName, column };
}
const results = [];
for (const sample of report.samples) {
  const profile = JSON.parse(await readFile(sample.profile, 'utf8'));
  const nodes = new Map();
  for (const node of profile.nodes) nodes.set(node.id, { ...await resolve(node.callFrame), selfMs: 0, inclusiveMs: 0, children: node.children ?? [] });
  profile.samples.forEach((id, i) => { const node = nodes.get(id); if (node) node.selfMs += profile.timeDeltas[i] / 1000; });
  const sum = id => { const node = nodes.get(id); return node.inclusiveMs = node.selfMs + node.children.reduce((total, child) => total + sum(child), 0); };
  sum(profile.nodes[0].id);
  const grouped = new Map();
  for (const node of nodes.values()) {
    const key = `${node.source}:${node.name}`;
    const value = grouped.get(key) ?? { name: node.name, source: node.source, line: node.line, sourceLine: node.sourceLine, selfMs: 0, inclusiveMs: 0 };
    value.selfMs += node.selfMs; value.inclusiveMs += node.inclusiveMs; grouped.set(key, value);
  }
  const frames = sample.frames ?? [];
  results.push({ mode: sample.mode, label: sample.label, profileMs: (profile.endTime - profile.startTime) / 1000,
    renderer: sample.probe.renderer, raf: sample.probe.raf, longTasks: sample.probe.longTasks,
    tierChanges: frames.filter(f => f.qualityBefore !== f.qualityAfter),
    slowFrames: frames.filter(f => f.cpuMs > 40),
    topSelf: [...grouped.values()].sort((a, b) => b.selfMs - a.selfMs).slice(0, 24),
    topInclusive: [...grouped.values()].filter(n => n.source && !n.source.includes('node_modules')).sort((a, b) => b.inclusiveMs - a.inclusiveMs).slice(0, 16) });
}
const output = reportPath.replace(/\.json$/, '-analysis.json');
await writeFile(output, JSON.stringify({ status: 'completed', apkSha256: report.apkSha256, results }, null, 2));
console.log(JSON.stringify(results.map(r => ({mode:r.mode,label:r.label,maxRaf:r.raf.maxMs,tierChanges:r.tierChanges,slowFrames:r.slowFrames,topSelf:r.topSelf.slice(0,7)})),null,2));
