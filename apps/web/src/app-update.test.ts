import { describe, expect, it, vi } from 'vitest';
import { compareVersions, latestAppRelease, releaseAsset, MAX_UPDATE_APK_BYTES, REPOSITORY_URL } from './app-update';

describe('public release checks', () => {
  it('compares numeric versions, not string order', () => {
    expect(compareVersions('2.10.0','2.9.9')).toBeGreaterThan(0);
    expect(compareVersions('2.6.0','2.6.0')).toBe(0);
    expect(compareVersions('2.5.6','2.6.0')).toBeLessThan(0);
  });
  it('uses a trusted release link and forwards cancellation', async () => {
    const signal=new AbortController().signal;
    const request=vi.fn().mockResolvedValue({ok:true,json:async()=>({tag_name:'v2.6.0',html_url:'https://evil.invalid',draft:false,prerelease:false})});
    expect(await latestAppRelease(signal,request)).toEqual({version:'2.6.0',url:`${REPOSITORY_URL}/releases/tag/v2.6.0`});
    expect(request.mock.calls[0]![1].signal).toBe(signal);
  });
  it.each([null,{}, {tag_name:'v2.6.0-rc.1'}, {tag_name:'v2.6.0',prerelease:true}, {tag_name:'v2.6.0',draft:true}])('rejects a malformed or non-stable release %j',async release=>{
    const request=vi.fn().mockResolvedValue({ok:true,json:async()=>release});
    await expect(latestAppRelease(undefined,request)).rejects.toThrow('Invalid release');
  });
  it('reports failed requests to the caller without converting them to no-update',async()=>{
    await expect(latestAppRelease(undefined,vi.fn().mockResolvedValue({ok:false,status:503}))).rejects.toThrow('503');
  });
  const asset = { name: 'Blockcolc-v2.6.0.apk', state: 'uploaded', size: 5_000_000, digest: `sha256:${'a'.repeat(64)}`, browser_download_url: `${REPOSITORY_URL}/releases/download/v2.6.0/Blockcolc-v2.6.0.apk` };
  it('extracts an exact standard asset and its GitHub SHA-256 digest', () => {
    expect(releaseAsset('2.6.0', 'v2.6.0', [asset])).toEqual({ version: '2.6.0', url: asset.browser_download_url, size: asset.size, sha256: 'a'.repeat(64) });
  });
  it.each([{ state: 'new' }, { name: 'Blockcolc-v2.6.0-private-verification.apk' }, { size: 0 }, { size: MAX_UPDATE_APK_BYTES + 1 }, { size: 1.5 }, { digest: null }, { digest: 'sha256:abcd' }, { browser_download_url: 'https://evil.invalid/update.apk' }])('does not trust an invalid asset %j', patch => {
    expect(releaseAsset('2.6.0', 'v2.6.0', [{ ...asset, ...patch }])).toBeUndefined();
  });
  it('rejects ambiguous duplicate assets and mismatched tags', () => {
    expect(releaseAsset('2.6.0', 'v2.6.0', [asset, asset])).toBeUndefined();
    expect(releaseAsset('2.6.0', 'evil', [asset])).toBeUndefined();
  });
});
