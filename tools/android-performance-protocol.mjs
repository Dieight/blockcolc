/** Decode complete bounded samples, never treat a partial log as a result. */
export function decodeProbeSamples(text, run, request) {
  const groups = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /event=sample run=([A-Za-z0-9_-]+) request=([A-Za-z0-9_-]+) sample=(\d+) part=(\d+)\/(\d+) data=([A-Za-z0-9+/=]+)$/.exec(line);
    if (!match || match[1] !== run || match[2] !== request) continue;
    const [, , , sequence, partText, totalText, chunk] = match;
    const part = Number(partText), total = Number(totalText);
    if (total < 1 || total > 16 || part >= total || chunk.length > 2400) continue;
    const group = groups.get(sequence) ?? { total, parts: new Map() };
    if (group.total !== total) continue;
    group.parts.set(part, chunk); groups.set(sequence, group);
  }
  const samples = [];
  for (const [sequence, group] of groups) {
    if (group.parts.size !== group.total) continue;
    try {
      const json = Buffer.from(Array.from({ length: group.total }, (_, index) => group.parts.get(index)).join(''), 'base64').toString('utf8');
      if (json.length > 25_000) continue;
      const value = JSON.parse(json);
      if (value.schemaVersion === 1 && value.native && typeof value.native.activityAgeMs === 'number') samples.push({ sequence: Number(sequence), value });
    } catch { /* A truncated/bad payload is missing evidence, never a pass. */ }
  }
  return samples.sort((a, b) => a.sequence - b.sequence).map(sample => sample.value);
}
export function screenPoint(sample, xFraction = .5, yFraction = .5) {
  if (!sample.visible || !sample.rect || !sample.viewport || !sample.native
    || sample.viewport.width <= 0 || sample.viewport.height <= 0) throw new Error('Visible target rectangle is required.');
  const { rect, viewport, native } = sample;
  return [Math.round(native.webViewX + (rect.x + rect.width * xFraction) * native.webViewWidth / viewport.width),
    Math.round(native.webViewY + (rect.y + rect.height * yFraction) * native.webViewHeight / viewport.height)];
}
