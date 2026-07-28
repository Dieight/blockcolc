import type { Clock, FocusLifecycleEvent, FocusLifecyclePort, IdGenerator, NotificationCapability, NotificationPort } from '@tomato-clock/application';

export const LITEMATIC_MAX_COMPRESSED_BYTES = 10 * 1024 * 1024;

export class DateClock implements Clock { now() { return new Date(); } }
export class CryptoIdGenerator implements IdGenerator { next(kind: 'project' | 'subtask' | 'focus-session' | 'progress-report') { return `${kind}-${crypto.randomUUID()}`; } }

export class BrowserNotificationPort implements NotificationPort {
  private timers = new Map<string, number>();
  async requestPermission() { if (!('Notification' in window)) return unavailable(); const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission; return capability(permission); }
  async refreshCapability() { return 'Notification' in window ? capability(Notification.permission) : unavailable(); }
  async scheduleFocusCompletion({ sessionId, endsAt }: { sessionId: string; endsAt: string }) { if (!('Notification' in window) || Notification.permission !== 'granted') return; this.cancel(sessionId); const delay = Math.min(2_147_000_000, Math.max(0, Date.parse(endsAt) - Date.now())); this.timers.set(sessionId, window.setTimeout(() => { new Notification('专注完成', { body: '回来记录这次小任务的实际进度。', tag: sessionId }); this.timers.delete(sessionId); }, delay)); }
  async cancelFocusCompletion(sessionId: string) { this.cancel(sessionId); }
  private cancel(id: string) { const timer = this.timers.get(id); if (timer !== undefined) window.clearTimeout(timer); this.timers.delete(id); }
}

/** Page Visibility cannot distinguish tab switching, minimization, and screen locking. */
export class BrowserFocusLifecyclePort implements FocusLifecyclePort {
  async subscribe(listener: (event: FocusLifecycleEvent) => void | Promise<void>) {
    const onVisibilityChange = () => {
      const event: FocusLifecycleEvent = document.hidden
        ? { type: 'background', source: 'web' }
        : { type: 'foreground' };
      void Promise.resolve(listener(event)).catch(error => console.error('Focus lifecycle reconciliation failed', error));
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }
}

/** Saves through the native adapter when available, otherwise downloads a JSON Blob. */
export async function saveBackupFile(json: string, filename: string): Promise<void> {
  const platform = await import('@tomato-clock/platform-capacitor');
  const native = platform as typeof platform & { saveNativeBackupFile?: (name: string, content: string) => Promise<boolean> };
  if (platform.isCapacitorNative() && native.saveNativeBackupFile) {
    if (await native.saveNativeBackupFile(filename, json)) return;
  }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function readBrowserFileBytes(file: File, maxBytes = LITEMATIC_MAX_COMPRESSED_BYTES): Promise<Uint8Array> {
  if (file.size > maxBytes) throw fileTooLarge();
  if (typeof file.arrayBuffer === 'function') {
    try {
      const buffer = await file.arrayBuffer();
      return checkedBytes(new Uint8Array(buffer), maxBytes);
    } catch (error) {
      if ((error as { code?: string }).code === 'INPUT_TOO_LARGE') throw error;
      // Android WebView providers can expose a File whose arrayBuffer path fails.
    }
  }
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read selected file'));
    reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error('Selected file did not contain binary data'));
    reader.readAsArrayBuffer(file);
  });
  return checkedBytes(new Uint8Array(buffer), maxBytes);
}

function checkedBytes(bytes: Uint8Array, maxBytes: number): Uint8Array {
  if (bytes.byteLength > maxBytes) throw fileTooLarge();
  return bytes;
}

function fileTooLarge(): Error & { code: string } {
  return Object.assign(new Error('Selected file exceeds the import limit'), { code: 'INPUT_TOO_LARGE' });
}

function unavailable(): NotificationCapability { return { permission: 'unavailable', precision: 'unavailable', canSchedule: false }; }
function capability(permission: NotificationPermission): NotificationCapability { return { permission: permission === 'default' ? 'prompt' : permission, precision: permission === 'granted' ? 'inexact' : 'unavailable', canSchedule: permission === 'granted' }; }
