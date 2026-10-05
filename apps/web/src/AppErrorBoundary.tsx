import { Component, type ReactNode, type ErrorInfo } from 'react';
import { PixelReset } from './ui/PixelIcon';
import { renderRecoveryDiagnostic } from './render-recovery-diagnostic';
import { completeStartupPresentation } from './startup-presentation';

/** A render failure must never clear storage or masquerade as a first installation. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    completeStartupPresentation();
    document.documentElement.dataset.renderState = 'failed';
    const bridge = (window as typeof window & { BlockcolcNativeInput?: { logRenderDiagnostic?: (message: string) => void } }).BlockcolcNativeInput;
    // Task names, error messages and component props stay out of native logs.
    try { bridge?.logRenderDiagnostic?.(`[blockcolc-render] ${JSON.stringify(renderRecoveryDiagnostic(error, info.componentStack ?? ''))}`); }
    catch { /* A diagnostic bridge cannot fail the recovery UI. */ }
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <section className="fatal" role="alert"><h1>页面暂时没能打开</h1>
      <p>重新打开会读取本机记录，不会重置任务。</p>
      <button className="primary" type="button" onClick={() => window.location.reload()}><PixelReset/>重新打开</button>
    </section>;
  }
}
