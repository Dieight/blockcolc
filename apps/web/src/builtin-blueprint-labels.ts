import { LOCAL_BUILTIN_SOURCES } from '@blockcolc/voxel/local-blueprint-sources';
import { t } from './i18n';

const titles = new Map(Object.entries(LOCAL_BUILTIN_SOURCES).map(([filename, entry]) => [entry.id, filename.replace(/\.litematic$/, '')]));
/** Canonical packaged labels also translate old saved snapshots. User names stay intact. */
export function localBlueprintTitle(id: string, fallback: string): string {
  const title = titles.get(id);
  return title ? t(title) : fallback;
}
