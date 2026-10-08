import type { AppUpdateAsset } from '@blockcolc/platform-capacitor';
export const REPOSITORY_URL = 'https://github.com/Dieight/blockcolc';
const RELEASE_API = 'https://api.github.com/repos/Dieight/blockcolc/releases/latest';
export interface AppRelease { version: string; url: string; asset?: AppUpdateAsset }
const VERSION = /^(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})$/;
export const MAX_UPDATE_APK_BYTES = 100 * 1024 * 1024;

export function releaseAsset(version: string, tag: string, assets: unknown): AppUpdateAsset | undefined {
  if (!VERSION.test(version) || !(tag === version || tag === `v${version}`) || !Array.isArray(assets)) return;
  const name = `Blockcolc-v${version}.apk`;
  const url = `${REPOSITORY_URL}/releases/download/${tag}/${name}`;
  const matches = assets.filter((asset: unknown) => asset && typeof asset === 'object' && (asset as Record<string, unknown>).name === name);
  if (matches.length !== 1) return;
  const asset = matches[0] as Record<string, unknown>;
  if (asset.state !== 'uploaded' || asset.browser_download_url !== url || typeof asset.size !== 'number'
    || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_UPDATE_APK_BYTES
    || typeof asset.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest)) return;
  return { version, url, size: asset.size, sha256: asset.digest.slice(7).toLowerCase() };
}

export function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number), b = right.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
}

/** Public, stable releases only. Never trusts a remotely supplied download URL. */
export async function latestAppRelease(signal?: AbortSignal, request: typeof fetch = fetch): Promise<AppRelease> {
  const response = await request(RELEASE_API, { signal, headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(`Release check failed: ${response.status}`);
  const release: unknown = await response.json();
  if (!release || typeof release !== 'object') throw new Error('Invalid release');
  const { tag_name, draft, prerelease, assets } = release as Record<string, unknown>;
  if (typeof tag_name !== 'string' || !VERSION.test(tag_name.replace(/^v/, '')) || draft === true || prerelease === true) throw new Error('Invalid release');
  const version = tag_name.replace(/^v/, '');
  const asset = releaseAsset(version, tag_name, assets);
  return { version, url: `${REPOSITORY_URL}/releases/tag/${encodeURIComponent(tag_name)}`, ...(asset ? { asset } : {}) };
}

export async function checkAppUpdate(signal?: AbortSignal): Promise<AppRelease> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 12_000);
  try { return await latestAppRelease(controller.signal); }
  finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}
