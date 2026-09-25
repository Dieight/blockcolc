import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { DomainState } from '@tomato-clock/domain';
import { FocusFace } from './ui/FocusFace';
import { MinimalTodayPanel } from './MinimalTodayPanel';
import './styles/minimal-idle-carousel.css';

type Page = 0 | 1;

export function pageAfterHorizontalSwipe(page: Page, dx: number, dy: number): Page {
  if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy) * 1.25) return page;
  return dx < 0 ? 1 : 0;
}

export function pageAfterArrowKey(page: Page, key: string): Page {
  if (key === 'ArrowRight') return 1;
  if (key === 'ArrowLeft') return 0;
  return page;
}

/** The frosted panel stays put; only its clock/today content travels. */
export function MinimalIdleCarousel({ clock, exit, state, date }: {
  clock: ReactNode; exit: ReactNode; state: DomainState; date: string;
}) {
  const [page, setPage] = useState<Page>(0);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const onPointerDownCapture = (event: PointerEvent<HTMLDivElement>) => {
    swiped.current = false;
    if (event.isPrimary && event.button === 0) {
      pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      // The clock owns its pointer for vertical time selection. The today page
      // has no such child capture, so keep its return swipe alive even when a
      // thumb lifts beyond the glass panel's right edge.
      if (page === 1) event.currentTarget.setPointerCapture(event.pointerId);
    }
  };
  const onPointerUpCapture = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointer.current;
    pointer.current = null;
    if (!start || start.id !== event.pointerId) return;
    const next = pageAfterHorizontalSwipe(page, event.clientX - start.x, event.clientY - start.y);
    if (next !== page) { swiped.current = true; setPage(next); }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const next = pageAfterArrowKey(page, event.key);
    if (next === page) return;
    event.preventDefault();
    setPage(next);
  };
  const pageName = page === 0 ? '时钟' : '今日专注时间轴';
  return <div className="minimal-idle-carousel" data-page={page === 0 ? 'clock' : 'today'}
    role="region" aria-label={`极简信息面板：${pageName}`} aria-describedby="minimal-idle-carousel-help" tabIndex={0}
    onPointerDownCapture={onPointerDownCapture} onPointerUpCapture={onPointerUpCapture}
    onPointerCancelCapture={() => { pointer.current = null; swiped.current = false; }}
    onDragStartCapture={event => event.preventDefault()}
    onPointerUp={event => { if (swiped.current) event.stopPropagation(); }}
    onClickCapture={event => {
      if (!swiped.current) return;
      swiped.current = false;
      // Keyboard and assistive-technology clicks have no pointer detail.
      if (event.detail === 0) return;
      event.preventDefault();
      event.stopPropagation();
    }} onKeyDown={onKeyDown}>
    <span className="sr-only" id="minimal-idle-carousel-help">面板获得焦点后，按向左或向右方向键切换内容。</span>
    <span className="sr-only" role="status" aria-live="polite">{pageName}面板</span>
    <div className="minimal-idle-viewport">
      <div className="minimal-idle-track" style={{ transform: `translateX(-${page * 50}%)` }}>
        <div className="minimal-idle-page" aria-hidden={page !== 0} inert={page !== 0}>
          <FocusFace timer={clock} controls={exit}/>
        </div>
        <div className="minimal-idle-page minimal-idle-today-page" aria-hidden={page !== 1} inert={page !== 1}>
          <MinimalTodayPanel state={state} date={date}/>
        </div>
      </div>
    </div>
  </div>;
}
