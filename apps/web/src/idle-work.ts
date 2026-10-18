export interface IdleWorkPorts {
  schedule(callback: (shortSlot?:boolean) => void,allowShortSlot?:boolean): () => void;
  allowed(): boolean;
  failed?(error: unknown): void;
}

/** One low-priority job at a time; replacement coalesces pending layout writes. */
export function createIdleWorkQueue(ports: IdleWorkPorts) {
  const jobs = new Map<string, {job:()=>void|Promise<void>;allowShortSlot:boolean}>();
  let scheduled: (() => void) | null = null, running = false, stopped = false;
  const next=()=>[...jobs.entries()].find(([,entry])=>entry.allowShortSlot)??jobs.entries().next().value!;
  const pump = () => {
    if (stopped || running || scheduled || !jobs.size) return;
    scheduled = ports.schedule((shortSlot=false) => {
      scheduled = null;
      if (stopped || !jobs.size) return;
      const [key, entry] = next();
      if (!ports.allowed()) { pump();return; }
      // Cheap worker dispatches may pass a deferred UI mount, but a short slot
      // never becomes permission to force a monolithic main-thread job.
      if(shortSlot&&!entry.allowShortSlot){pump();return;}
      const {job}=entry;
      jobs.delete(key); running = true;
      Promise.resolve().then(job).catch(error => ports.failed?.(error)).finally(() => { running = false; pump(); });
    },next()[1].allowShortSlot);
  };
  return {
    enqueue(key: string, job: () => void | Promise<void>,allowShortSlot=false) {
      if (stopped) return () => {};
      const entry={job,allowShortSlot};jobs.set(key,entry);pump();
      return () => { if (jobs.get(key) === entry) jobs.delete(key); };
    },
    stop() { stopped = true; jobs.clear(); scheduled?.(); scheduled = null; },
  };
}

/** A timeout requests a scheduling opportunity, never permission to ignore
 * the queue's startup, interaction or visibility guards. */
export function scheduleIdleOpportunity(callback: (shortSlot?:boolean) => void, postpone: () => void,allowShortSlot=false) {
  let idle: number | undefined;
  const timer = window.setTimeout(() => {
    if (typeof requestIdleCallback === 'function') idle = requestIdleCallback(deadline => {
      // Timeout callbacks intentionally have zero idle budget. Re-deferring
      // those would starve work forever when the browser provides no idle slot.
      const short=!allowShortSlot&&!deadline.didTimeout&&deadline.timeRemaining()<12;
      if(short)postpone();
      callback(short);
    }, { timeout: 1500 });
    else callback();
  }, 600);
  return () => { clearTimeout(timer); if (idle !== undefined) cancelIdleCallback(idle); };
}

let quietUntil = 0;
let browserQueue: ReturnType<typeof createIdleWorkQueue> | null = null;
function browserIsQuiet() {
  const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-world-canvas]');
  const shell = document.querySelector<HTMLElement>('.app-shell');
  const inputPending = (navigator as Navigator & { scheduling?: { isInputPending(): boolean } }).scheduling?.isInputPending();
  return !document.hidden && performance.now() >= quietUntil && !inputPending
    && shell?.dataset.modePortalActive !== 'true' && shell?.dataset.worldPreparing !== 'true'
    && (!shell?.dataset.presentationTransition || shell.dataset.presentationTransition === 'complete')
    && ![...document.querySelectorAll<HTMLElement>('.boot-page')].some(loader=>loader.getClientRects().length>0)
    && ![...document.querySelectorAll<HTMLElement>('[aria-busy="true"]')].some(element=>element.getClientRects().length>0)
    && (!canvas || canvas.dataset.initialPresentationPreparationMs !== undefined && canvas.dataset.openingRevealState !== 'active');
}

export function queueIdleWork(key: string, work: () => void | Promise<void>,options?:{backgroundDispatch:boolean}): () => void {
  if (!browserQueue) {
    const busy = () => { quietUntil = performance.now() + 1200; };
    for (const name of ['pointerdown','pointermove','wheel','keydown']) window.addEventListener(name,busy,{passive:true});
    if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      new PerformanceObserver(busy).observe({type:'longtask'});
    }
    browserQueue = createIdleWorkQueue({
      allowed: browserIsQuiet,
      schedule: (callback,allowShortSlot) => scheduleIdleOpportunity(callback, () => {},allowShortSlot),
      failed: error => console.warn('Background preparation skipped',error),
    });
  }
  return browserQueue.enqueue(key,work,options?.backgroundDispatch===true);
}
