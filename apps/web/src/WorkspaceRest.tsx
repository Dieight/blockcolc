import { t, useI18n } from './i18n';
import type { ApplicationCommand, ApplicationResult } from '@blockcolc/application';
import type { DomainState } from '@blockcolc/domain';
import { useRef, useState } from 'react';
import { PixelCheck, PixelPlay, PixelPlus } from './ui/PixelIcon';

export function WorkspaceRest({ state, run, onCreate }: { state: DomainState;
  run: (command: ApplicationCommand) => Promise<ApplicationResult>; onCreate: () => void }) {
  useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const paused = state.projects.filter(project => project.status === 'paused');
  const resume = async (id: string) => {
    if (pending.current) return;
    pending.current = true; setBusy(id); setError('');
    try {
      const result = await run({ type: 'SwitchActiveProject', projectId: id });
      if (!result.ok) setError(result.message);
    } catch { setError(t("暂未切换，请重试。")); }
    finally { pending.current = false; setBusy(null); }
  };
  return <div className="workspace-rest">
    <span className="eyebrow"><PixelCheck size={16}/>{t("建造记录已保留")}</span>
    <h1>{paused.length ? t("继续哪项工作？") : t("给下一项工作留个位置")}</h1>
    <p>{t("可以回看建筑，也可以开始新的任务。")}</p>
    {paused.map(project => <button className="workspace-resume" key={project.id} type="button"
      disabled={busy !== null} aria-busy={busy === project.id} onClick={() => void resume(project.id)}>
      <span>{project.title}</span><PixelPlay size={16}/>
    </button>)}
    {error && <p role="alert">{error}</p>}
    <button className="primary" type="button" disabled={busy !== null} onClick={onCreate}><PixelPlus/>{t("新建任务")}</button>
  </div>;
}
