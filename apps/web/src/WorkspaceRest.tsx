import type { ApplicationCommand, ApplicationResult } from '@blockcolc/application';
import type { DomainState } from '@blockcolc/domain';
import { useRef, useState } from 'react';
import { PixelCheck, PixelPlay, PixelPlus } from './ui/PixelIcon';

export function WorkspaceRest({ state, run, onCreate }: { state: DomainState;
  run: (command: ApplicationCommand) => Promise<ApplicationResult>; onCreate: () => void }) {
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
    } catch { setError('暂未切换，请重试。'); }
    finally { pending.current = false; setBusy(null); }
  };
  return <div className="workspace-rest">
    <span className="eyebrow"><PixelCheck size={16}/>建造记录已保留</span>
    <h1>{paused.length ? '继续哪项工作？' : '给下一项工作留个位置'}</h1>
    <p>可以回看建筑，也可以开始新的任务。</p>
    {paused.map(project => <button className="workspace-resume" key={project.id} type="button"
      disabled={busy !== null} aria-busy={busy === project.id} onClick={() => void resume(project.id)}>
      <span>{project.title}</span><PixelPlay size={16}/>
    </button>)}
    {error && <p role="alert">{error}</p>}
    <button className="primary" type="button" disabled={busy !== null} onClick={onCreate}><PixelPlus/>新建任务</button>
  </div>;
}
