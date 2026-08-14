/**
 * Shared full-screen loading page. Used for both the initial bootstrap
 * (restoring the local world) and the world renderer rebuild on the timer
 * tab, so the two stages read as one continuous loading screen.
 */
export function LoadingPage({ status }: { status: string }) {
  return (
    <div className="boot-page" role="status">
      <div className="boot-page-inner">
        <span className="boot-page-mark">方块钟<small>Blockcolc</small></span>
        <p className="boot-page-status">{status}</p>
        <div className="boot-page-blocks" aria-hidden="true"><i/><i/><i/></div>
        <p className="boot-page-hint">稍等片刻，马上回到你的聚落</p>
      </div>
    </div>
  );
}
