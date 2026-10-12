import { t, useI18n } from './i18n';
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { DomainState } from '@blockcolc/domain';
import { FocusFace } from './ui/FocusFace';
import { MinimalTodayPanel } from './MinimalTodayPanel';
import './styles/minimal-idle-carousel.css';

type Page = -1 | 0 | 1;

export function pageAfterHorizontalSwipe(page: Page, dx: number, dy: number, notes = false): Page {
  if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy) * 1.25) return page;
  return Math.max(notes ? -1 : 0, Math.min(1, page + (dx < 0 ? 1 : -1))) as Page;
}

export function pageAfterArrowKey(page: Page, key: string, notes = false): Page {
  if (key === 'ArrowRight') return Math.min(1, page + 1) as Page;
  if (key === 'ArrowLeft') return Math.max(notes ? -1 : 0, page - 1) as Page;
  return page;
}

/** The frosted panel stays put; only its clock/today content travels. */
export function MinimalIdleCarousel({ clock, exit, state, date, notes }: {
  clock: ReactNode; exit: ReactNode; state: DomainState; date: string; notes?: ReactNode;
}) {
  useI18n();
  const [page, setPage] = useState<Page>(0);
  const pointer = useRef<{ id: number; x: number; y: number; horizontal: boolean } | null>(null);
  const swiped = useRef(false);
  const hasNotes = Boolean(notes), activePage = !hasNotes && page === -1 ? 0 : page;
  const onPointerDownCapture = (event: PointerEvent<HTMLDivElement>) => {
    swiped.current = false;
    pointer.current = null;
    // Editing and selecting inside a note is not a panel gesture. Checkboxes,
    // labels and disclosure headers still allow an intentional return swipe.
    if (event.target instanceof Element && event.target.closest('input:not([type="checkbox"]),textarea,[contenteditable="true"]')) return;
    if (event.isPrimary && event.button === 0) {
      pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, horizontal:false };
    }
  };
  const onPointerMoveCapture = (event: PointerEvent<HTMLDivElement>) => {
    const start=pointer.current;if(!start||start.id!==event.pointerId)return;
    const dx=event.clientX-start.x,dy=event.clientY-start.y;
    if(!start.horizontal&&Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)*1.25){
      start.horizontal=true;event.currentTarget.setPointerCapture(event.pointerId);
    }
    if(start.horizontal){event.preventDefault();event.stopPropagation();}
  };
  const onPointerUpCapture = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointer.current;
    pointer.current = null;
    if (!start || start.id !== event.pointerId) return;
    const next = pageAfterHorizontalSwipe(activePage, event.clientX - start.x, event.clientY - start.y, hasNotes);
    if (next !== activePage) { swiped.current = true; setPage(next); }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const next = pageAfterArrowKey(activePage, event.key, hasNotes);
    if (next === activePage) return;
    event.preventDefault();
    setPage(next);
  };
  const pageName = activePage === 0 ? t("时钟") : activePage === -1 ? t('简易便签') : t("今日专注时间轴");
  return <div className="minimal-idle-carousel" data-page={activePage === 0 ? 'clock' : activePage === -1 ? 'notes' : 'today'}
    role="region" aria-label={t("极简信息面板：{0}", pageName)} aria-describedby="minimal-idle-carousel-help" tabIndex={0}
    onPointerDownCapture={onPointerDownCapture} onPointerMoveCapture={onPointerMoveCapture} onPointerUpCapture={onPointerUpCapture}
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
    <span className="sr-only" id="minimal-idle-carousel-help">{t("面板获得焦点后，按向左或向右方向键切换内容。")}</span>
    <span className="sr-only" role="status" aria-live="polite">{pageName}{t("面板")}</span>
    <div className="minimal-idle-viewport">
      <div className="minimal-idle-track" style={{ width:hasNotes?'300%':'200%', transform:`translateX(-${(activePage+(hasNotes?1:0))*100/(hasNotes?3:2)}%)`, '--idle-page-width':hasNotes?'33.333333%':'50%' } as import('react').CSSProperties}>
        {hasNotes && <div className="minimal-idle-page minimal-idle-notes-page" aria-hidden={activePage!==-1} inert={activePage!==-1}>{notes}</div>}
        <div className="minimal-idle-page" aria-hidden={activePage !== 0} inert={activePage !== 0}>
          <FocusFace timer={clock} controls={exit}/>
        </div>
        <div className="minimal-idle-page minimal-idle-today-page" aria-hidden={activePage !== 1} inert={activePage !== 1}>
          <MinimalTodayPanel state={state} date={date}/>
        </div>
      </div>
    </div>
  </div>;
}
