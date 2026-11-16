import { useRef, useState } from 'react';
import type { ApplicationService } from '@blockcolc/application';
import { MAX_BACKUP_BYTES } from '@blockcolc/storage-indexeddb';
import { FileUp, Upload } from 'lucide-react';
import { appLocale, t, useI18n } from './i18n';
import { readBackupFileText } from './browser-adapters';

/** First-run restore and settings import share validation, preview and the atomic replacement. */
export function BackupImport({ service, onRestored, disabled = false, onBegin, onEnd, onBusyChange, onError }: {
  service: ApplicationService;
  onRestored: () => void;
  disabled?: boolean;
  onBegin?: (action: 'preview' | 'import') => boolean;
  onEnd?: () => void;
  onBusyChange?: (busy: boolean) => void;
  onError?: (message: string) => void;
}) {
  useI18n();
  const [preview, setPreview] = useState<Awaited<ReturnType<ApplicationService['previewImport']>> | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [phase, setPhase] = useState<'preview' | 'import' | null>(null);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const reportError = (message: string) => { setError(message); onError?.(message); };
  const begin = (next: 'preview' | 'import') => {
    if (disabled || pending.current || onBegin?.(next) === false) return false;
    pending.current = true; setPhase(next); reportError(''); onBusyChange?.(true); return true;
  };
  const end = () => { pending.current = false; setPhase(null); onEnd?.(); onBusyChange?.(false); };
  const choose = async (file?: File) => {
    if (!file || !begin('preview')) return;
    setPreview(null); setText(null);
    try {
      const next = await readBackupFileText(file);
      const checked = await service.previewImport(next);
      setText(next); setPreview(checked);
    } catch (cause) {
      const code = typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : '';
      reportError(code === 'BACKUP_TOO_LARGE' ? t('备份文件不能超过 {0} MiB。', MAX_BACKUP_BYTES / 1048576)
        : t('无法读取备份：{0}', cause instanceof Error ? cause.message : String(cause)));
    } finally { end(); }
  };
  const restore = async () => {
    if (!text || !preview || !begin('import')) return;
    try {
      await service.replaceFromImport(text);
      setPreview(null); setText(null); onRestored();
    } catch (cause) { reportError(t('导入失败：{0}', cause instanceof Error ? cause.message : String(cause))); }
    finally { end(); }
  };
  const busy = disabled || phase !== null;
  return <div className="backup-import">
    <div className="setting-row"><div className="setting-name"><span>{t('导入备份')}</span><small>{t('导入前留回滚点；完整替换，不合并。')}</small></div>
      <label className="file-button settings-text-action backup-file-action" aria-busy={phase === 'preview'} aria-disabled={busy}><FileUp/>{phase === 'preview' ? t('正在读取…') : t('选择备份')}
        <input aria-label={t('选择备份 JSON 文件')} type="file" accept="application/json,.json" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ''; void choose(file); }}/>
      </label>
    </div>
    {preview && <div className="import-preview"><h3>{t('导入预览')}</h3><dl>
      <div><dt>{t('导出时间')}</dt><dd>{new Date(preview.exportedAt).toLocaleString(appLocale())}</dd></div>
      <div><dt>{t('项目')}</dt><dd>{preview.summary.projectCount} {t('个')}{preview.summary.activeProjectTitle ? t(' · 当前：{0}', preview.summary.activeProjectTitle) : ''}</dd></div>
      <div><dt>{t('专注记录')}</dt><dd>{preview.summary.completedFocusCount} {t('完成 /')} {preview.summary.interruptedFocusCount} {t('中断')}</dd></div>
      <div><dt>{t('进度汇报')}</dt><dd>{preview.summary.progressReportCount} {t('条')}</dd></div>
    </dl><div className="backup-import-actions"><button type="button" disabled={busy} onClick={() => { setPreview(null); setText(null); setError(''); }}>{t('取消')}</button>
      <button className="danger-action backup-confirm" type="button" disabled={busy} aria-busy={phase === 'import'} onClick={() => void restore()}><Upload/>{phase === 'import' ? t('正在替换…') : t('确认替换本地数据')}</button>
    </div></div>}
    {error && !onError && <p className="import-error" role="alert">{error}</p>}
  </div>;
}
