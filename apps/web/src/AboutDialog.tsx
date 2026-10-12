import { t, useI18n } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { PixelBrand, PixelClose, PixelReset } from './ui/PixelIcon';
import { checkAppUpdate, compareVersions, REPOSITORY_URL, type AppRelease } from './app-update';
import { appUpdater } from './app-updater';
import { useAppUpdateState } from './use-app-updater';
import { finishRefreshFeedback } from './refresh-feedback';
import releaseVersion from '../../../version.json';

const APP_VERSION = releaseVersion.versionName;
const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

export function AboutDialog({ onClose, availableRelease }: { onClose: () => void; availableRelease: AppRelease | null }) {
  useI18n();
  const [checking, setChecking] = useState(false), [result, setResult] = useState('');
  const [release, setRelease] = useState(availableRelease);
  const { status, pending, message } = useAppUpdateState();
  const privateChannel = status?.channel === 'private';
  const close = useRef<HTMLButtonElement>(null), request = useRef<AbortController | null>(null);
  useEffect(() => { if (availableRelease) { setRelease(availableRelease); setResult(''); } }, [availableRelease]);
  useEffect(() => { void appUpdater.refresh(); return () => request.current?.abort(); }, []);
  useEffect(() => {
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const check = async () => {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    const started = performance.now(); setChecking(true);
    try {
      const latest = await checkAppUpdate(controller.signal); await finishRefreshFeedback(started);
      if (!controller.signal.aborted) {
        const newer = compareVersions(latest.version, APP_VERSION) > 0;
        setRelease(newer ? latest : null); setResult(newer ? '' : t("当前已是最新版本 {0}。", APP_VERSION));
      }
    } catch {
      await finishRefreshFeedback(started);
      if (!controller.signal.aborted) setResult(t("暂时无法检查更新，请确认网络后重试。"));
    } finally { request.current = null; if (!controller.signal.aborted) setChecking(false); }
  };
  const job = status?.version && status.phase !== 'idle' ? status : null;
  const moving = job?.phase === 'downloading' || job?.phase === 'paused';
  const verified = job?.phase === 'ready';
  const newerJobThanRelease = job && (!release || compareVersions(job.version!, release.version) >= 0);
  const text = message || (privateChannel && release ? t("公开版 {0} 已更新；私人版保留好友同步，不下载公开包。", release.version)
    : job?.phase === 'failed' ? job.message
    : verified ? t("版本 {0} 已下载并验证，等待安装。", job.version)
    : moving ? t("正在{0} {1}", job.phase === 'paused' ? '等待网络后继续' : '下载', job.version)
    : result || (release ? t("发现新版本 {0}{1}。", release.version, release.asset ? ` · ${megabytes(release.asset.size)}` : '，安装包暂不可验证') : t("等待手动检查更新")));
  const progress = job?.totalBytes ? Math.min(100, (job.receivedBytes ?? 0) / job.totalBytes * 100) : 0;
  return <div className="dialog-backdrop edge-sheet-backdrop" role="presentation">
    <section className="confirm-dialog about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title">
      <button ref={close} className="dialog-close" aria-label={t("关闭关于页面")} onClick={onClose}><PixelClose/></button>
      <header className="about-brand"><button type="button" className="about-brand-bounce" aria-label={t("跳一跳，方块钟")}><PixelBrand size={36}/></button><div><h2 id="about-title">{t("方块钟")}<span>blockcolc</span></h2><p className="about-version">{t("版本")}{' '}{APP_VERSION}{privateChannel ? t(" · 私人版") : ''}</p></div></header>
      <p className="about-description">{t("把时间，慢慢建成一座聚落。任务、记录与蓝图默认保存在本机。")}</p>
      <dl>
        <div><dt>{t("项目仓库")}</dt><dd><a href={REPOSITORY_URL} target="_blank" rel="noreferrer">GitHub <ExternalLink/></a></dd></div>
        <div><dt>{t("隐私")}</dt><dd>{t("默认本地保存；外部服务按设置启用")}</dd></div>
        <div><dt>{t("项目许可")}</dt><dd><a href={`${REPOSITORY_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer">Apache-2.0 <ExternalLink/></a></dd></div>
        <div><dt>{t("天文计算")}</dt><dd><a href="licenses/suncalc.txt" target="_blank" rel="noreferrer">SunCalc · BSD-2-Clause <ExternalLink/></a></dd></div>
        <div><dt>{t("节日历法")}</dt><dd><a href="licenses/lunar-typescript/LICENSE.txt" target="_blank" rel="noreferrer">lunar-typescript · MIT <ExternalLink/></a></dd></div>
        <div><dt>{t("像素字体")}</dt><dd><a href="licenses/fusion-pixel/OFL.txt" target="_blank" rel="noreferrer">{t("缝合像素 · OFL-1.1")}<ExternalLink/></a></dd></div>
      </dl>
      <p className="legal-note">{t("本应用不是 Minecraft 官方产品，未获 Mojang Studios 或 Microsoft 认可或关联。Minecraft 是其权利人的商标。")}</p>
      <button className="check-update" type="button" disabled={checking || pending} aria-busy={checking} onClick={() => void check()}><PixelReset className={checking ? 'is-spinning' : ''}/>{t("手动检查更新")}</button>
      <p className="update-result" role="status">{t(text??'')}</p>
      {moving && <div className="update-transfer"><progress aria-label={t("更新下载进度")} max={100} value={progress}/><span>{megabytes(job.receivedBytes ?? 0)} / {megabytes(job.totalBytes ?? 0)}</span></div>}
      <div className="update-actions">
        {!privateChannel && status?.native && release?.asset && !moving && !(verified && newerJobThanRelease) && <button type="button" disabled={pending} aria-busy={pending} onClick={() => void appUpdater.download(release)}>{pending ? t("处理中") : t("确认下载更新")}</button>}
        {!privateChannel && moving && <button type="button" disabled={pending} onClick={() => void appUpdater.cancel()}>{t("取消下载")}</button>}
        {!privateChannel && verified && <button type="button" disabled={pending} aria-busy={pending} onClick={() => void (status!.canInstall ? appUpdater.install() : appUpdater.allowInstall())}>{pending ? t("处理中") : status!.canInstall ? t("安装更新") : t("允许安装此来源")}</button>}
        {release && (!status?.native || privateChannel || !release.asset) && <a className="update-download" href={release.url} target="_blank" rel="noreferrer">{t("查看发布说明")}<ExternalLink size={14}/></a>}
      </div>
    </section>
  </div>;
}
