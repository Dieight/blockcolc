import { describe, expect, it, vi } from 'vitest';
import type { AppUpdatePort, AppUpdateStatus } from '@blockcolc/platform-capacitor';
import { createAppUpdater } from './app-updater';
import type { AppRelease } from './app-update';

const release: AppRelease = { version: '2.9.0', url: 'release', asset: { version: '2.9.0', url: 'asset', size: 10, sha256: 'a'.repeat(64) } };
function fixture(channel: AppUpdateStatus['channel'] = 'standard') {
  const idle: AppUpdateStatus = { native: channel !== 'web', channel, phase: 'idle', canInstall: false };
  const port: AppUpdatePort = { status: vi.fn().mockResolvedValue(idle), start: vi.fn().mockResolvedValue({ ...idle, phase: 'downloading', version: '2.9.0', totalBytes: 10 }), cancel: vi.fn().mockResolvedValue(idle), allowInstall: vi.fn().mockResolvedValue(undefined), install: vi.fn().mockResolvedValue(undefined) };
  return { idle, port, updater: createAppUpdater(async () => port) };
}
describe('in-app update coordinator', () => {
  it('restores capability/job without starting a transfer or installer', async () => {
    const { updater, port } = fixture(); await updater.refresh();
    expect(updater.snapshot().status?.channel).toBe('standard');
    expect(port.start).not.toHaveBeenCalled(); expect(port.install).not.toHaveBeenCalled();
  });
  it.each(['private', 'web'] as const)('never downloads on %s, including automatic checks', async channel => {
    const { updater, port } = fixture(channel); await updater.download(release, true); await updater.download(release);
    expect(port.start).not.toHaveBeenCalled(); expect(port.install).not.toHaveBeenCalled();
  });
  it('can automatically download but never auto-installs', async () => {
    const { updater, port } = fixture(); await updater.download(release, true);
    expect(port.start).toHaveBeenCalledWith(release.asset); expect(port.install).not.toHaveBeenCalled();
    expect(updater.snapshot().status?.phase).toBe('downloading');
  });
  it('does not download without verified asset metadata or a successful capability read', async () => {
    const { updater, port } = fixture(); await updater.download({ version: '2.9.0', url: 'release' });
    expect(port.start).not.toHaveBeenCalled();
    const failed = createAppUpdater(async () => { throw new Error('bridge unavailable'); });
    await failed.download(release, true); expect(failed.snapshot().status).toBeNull();
  });
  it('owns one transfer, exposes error and permits retry', async () => {
    const { updater, port } = fixture();
    vi.mocked(port.start).mockRejectedValueOnce(new Error('download failed'));
    await updater.download(release); expect(updater.snapshot().message).toBe('download failed');
    await updater.download(release); expect(updater.snapshot().status?.phase).toBe('downloading');
    await updater.cancel(); expect(updater.snapshot().status?.phase).toBe('idle');
  });
  it('requires separate user actions for source permission and installation', async () => {
    const { updater, port, idle } = fixture();
    vi.mocked(port.status).mockResolvedValue({ ...idle, phase: 'ready', version: '2.9.0' });
    await updater.refresh(); await updater.allowInstall(); expect(port.install).not.toHaveBeenCalled();
    await updater.install(); expect(port.install).toHaveBeenCalledTimes(1);
  });
  it('an old status response cannot overwrite a completed cancellation', async () => {
    const { updater, port, idle } = fixture();
    let finish!: (status: AppUpdateStatus) => void;
    vi.mocked(port.status).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const old = updater.refresh(); await Promise.resolve(); await Promise.resolve();
    await updater.cancel(); finish({ ...idle, phase: 'downloading' }); await old;
    expect(updater.snapshot().status?.phase).toBe('idle');
  });
  it('replaces a stale ready state when the final native installation check fails', async () => {
    const { updater, port, idle } = fixture();
    vi.mocked(port.status).mockResolvedValueOnce({ ...idle, phase: 'ready', version: '2.9.0' }).mockResolvedValue({ ...idle, phase: 'failed', version: '2.9.0', message: 'hash mismatch' });
    await updater.refresh(); vi.mocked(port.install).mockRejectedValue(new Error('hash mismatch'));
    await updater.install(); expect(updater.snapshot().status?.phase).toBe('failed');
    expect(updater.snapshot().pending).toBe(false);
  });
});
