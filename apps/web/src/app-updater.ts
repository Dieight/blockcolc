import type { AppUpdatePort, AppUpdateStatus } from '@blockcolc/platform-capacitor';
import type { AppRelease } from './app-update';

export interface UpdateView { status: AppUpdateStatus | null; pending: boolean; message: string }
const downloading = (status: AppUpdateStatus | null) => status?.phase === 'downloading' || status?.phase === 'paused';

/** Native owns the file/job. This store outlives About and never touches domain data. */
export function createAppUpdater(getPort: () => Promise<AppUpdatePort>) {
  let view: UpdateView = { status: null, pending: false, message: '' };
  const listeners = new Set<() => void>();
  let revision = 0, initialized = false, checking: Promise<AppUpdateStatus | null> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null, users = 0;
  const publish = (next: UpdateView) => { view = next; listeners.forEach(listener => listener()); };
  const schedule = () => {
    if (timer) clearTimeout(timer); timer = null;
    if (!users || typeof document === 'undefined' || document.hidden || !downloading(view.status)) return;
    timer = setTimeout(() => { timer = null; void refresh(); }, view.status?.phase === 'paused' ? 3000 : 1200);
  };
  async function refresh(): Promise<AppUpdateStatus | null> {
    if (checking) return checking;
    const owner = revision;
    checking = (async () => {
      try {
        const status = await (await getPort()).status(); initialized = true;
        if (revision === owner) publish({ ...view, status, message: '' });
        return status;
      } catch {
        if (revision === owner) publish({ ...view, message: '暂时无法读取更新状态，请重试。' });
        return null;
      } finally { checking = null; schedule(); }
    })();
    return checking;
  }
  async function operate(action: (port: AppUpdatePort) => Promise<AppUpdateStatus | void>, success = '') {
    if (view.pending) return;
    ++revision; publish({ ...view, pending: true, message: '' });
    try {
      const status = await action(await getPort());
      publish({ status: status ?? view.status, pending: false, message: success });
    } catch (error) {
      // Native may have rejected a once-ready file during the final recheck.
      // Read its failed/permission state so the user gets a retry path, not a stale install button.
      let status = view.status;
      try { status = await (await getPort()).status(); } catch { /* Keep the known state if the bridge itself failed. */ }
      publish({ status, pending: false, message: error instanceof Error ? error.message : '更新未完成，请重试。' });
    } finally { schedule(); }
  }
  async function download(release: AppRelease, automatic = false) {
    if (view.pending) return;
    const status = initialized ? view.status : await refresh();
    // Both UI and native gate private builds. A failed capability read is not permission.
    if (!status?.native || status.channel !== 'standard') return;
    if (!release.asset) { if (!automatic) publish({ ...view, message: '新版暂未提供可验证的安装包。' }); return; }
    await operate(port => port.start(release.asset!));
  }
  const onVisible = () => { if (!document.hidden) void refresh(); else if (timer) { clearTimeout(timer); timer = null; } };
  return {
    snapshot: () => view,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    attach() {
      if (++users === 1) { document.addEventListener('visibilitychange', onVisible); void refresh(); }
      return () => { if (--users === 0) { document.removeEventListener('visibilitychange', onVisible); if (timer) clearTimeout(timer); timer = null; } };
    },
    refresh, download,
    cancel: () => operate(port => port.cancel()),
    allowInstall: () => operate(port => port.allowInstall(), '允许此来源后，返回并点击安装更新。'),
    install: () => operate(port => port.install(), '请在系统安装页面确认；取消后仍可继续使用。'),
  };
}

export const appUpdater = createAppUpdater(async () => (await import('@blockcolc/platform-capacitor')).nativeAppUpdate);
