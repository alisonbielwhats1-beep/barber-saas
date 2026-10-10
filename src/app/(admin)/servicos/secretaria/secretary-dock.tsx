"use client";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SecretaryChat } from './secretary-chat';
import './secretary-mobile.css';

/** Where the panel sits (prototype v6 approved by the owner, 08/10/2026). From 1216 px it stays BESIDE the content, which
 * shrinks (nothing is covered); from 1024 px (the computer's menu) it opens ON TOP of the content behind a veil; below that, on
 * the phone and tablet shell, it takes the whole screen. The menu item and the phone's tab open it with the
 * `everflair:secretary-open` event (there is no floating button). */
type Mode = 'side' | 'over' | 'full';
const SIDE_QUERY = '(min-width: 1216px)', OVER_QUERY = '(min-width: 1024px)';
const OPEN_EVENT = 'everflair:secretary-open';
/** The panel is loaded after the page: a request made before it is there is kept on the root (an opener may set this mark
 * before dispatching the event) and honoured when the panel mounts. */
const REQUEST_MARK = 'data-secretary-requested';
function openSecretary() { document.documentElement.setAttribute(REQUEST_MARK, ''); window.dispatchEvent(new Event(OPEN_EVENT)); }
/** Recording or counting down a spoken "confirma": the veil and Esc do not close her (closing would drop the dictation). */
const holds = (panel: HTMLElement | null) => Boolean(panel?.querySelector('[data-sec-hold="true"]'));

export function SecretaryDock({ voiceEnabled, voiceCorrection = false, transcribeEnabled = false, feedbackEnabled = false, flowEnabled = false }: { voiceEnabled: boolean; voiceCorrection?: boolean; transcribeEnabled?: boolean; feedbackEnabled?: boolean; flowEnabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  const [mode, setMode] = useState<Mode>('full');
  /** Beside the content the panel starts where the content starts (below a top bar that is not part of it). */
  const [top, setTop] = useState(0);
  const content = useRef<HTMLDivElement>(null);
  /** What had the focus when she was opened (the menu item, the tab): it gets it back when she closes. */
  const opener = useRef<HTMLElement | null>(null);
  const isOpen = useRef(open);
  isOpen.current = open;
  /** Owner 06/10 (mobile): with the virtual keyboard open the home-indicator inset is covered, so the composer drops it (iOS reports
   * the keyboard only in the visual viewport, which becomes shorter than the layout viewport). */
  const [keyboard, setKeyboard] = useState(false);
  /** The composer takes the focus; on the phone with voice, the microphone does, so the keyboard does not open over the
   * conversation. */
  const focusComposer = useCallback(() => {
    const mic = mode === 'full' && voiceEnabled ? content.current?.querySelector<HTMLElement>('[data-secretary-mic]') : undefined;
    (mic ?? content.current?.querySelector<HTMLElement>('textarea'))?.focus();
  }, [mode, voiceEnabled]);
  const focusLatest = useRef(focusComposer);
  focusLatest.current = focusComposer;

  useEffect(() => {
    const queries = typeof window.matchMedia === 'function' ? [window.matchMedia(SIDE_QUERY), window.matchMedia(OVER_QUERY)] : [];
    const update = () => setMode(queries[0]?.matches ? 'side' : queries[1]?.matches ? 'over' : 'full');
    update(); queries.forEach(query => query.addEventListener?.('change', update));
    const show = () => {
      document.documentElement.removeAttribute(REQUEST_MARK);
      if (isOpen.current) { focusLatest.current(); return; }
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body && !content.current?.contains(active) ? active : null;
      setVisited(true); setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, show);
    if (document.documentElement.hasAttribute(REQUEST_MARK)) show();
    return () => { queries.forEach(query => query.removeEventListener?.('change', update)); window.removeEventListener(OPEN_EVENT, show); };
  }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setKeyboard(window.innerHeight - viewport.height > 120);
    update(); viewport.addEventListener('resize', update);
    return () => viewport.removeEventListener('resize', update);
  }, []);
  // The root says where she is (secretary-mobile.css reserves her width beside the content). On top of the content (veil, full
  // screen) the rest of the app becomes inert. Declared before the focus effect: closing restores the app first, then the focus.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.setAttribute('data-secretary-open', mode);
    const shell = mode === 'side' ? null : document.querySelector<HTMLElement>('.admin-shell');
    const wasInert = shell?.inert ?? false;
    if (shell) shell.inert = true;
    return () => { root.removeAttribute('data-secretary-open'); if (shell) shell.inert = wasInert; };
  }, [open, mode]);
  // Opening focuses the message box (the content stays mounted between openings); closing gives the focus back to what opened
  // her, or to the content when that is gone. A focus the owner already moved elsewhere is left alone.
  useEffect(() => {
    if (!open) return;
    const panel = content.current;
    focusLatest.current();
    return () => {
      const active = document.activeElement;
      if (active && active !== document.body && !panel?.contains(active)) return;
      const back = opener.current;
      opener.current = null;
      if (back?.isConnected) back.focus({ preventScroll: true });
      if (!back || document.activeElement !== back) document.getElementById('main-content')?.focus({ preventScroll: true });
    };
  }, [open]);
  useEffect(() => {
    if (!open || mode !== 'side') return;
    const measure = () => setTop(Math.max(0, document.getElementById('main-content')?.getBoundingClientRect().top ?? 0));
    measure(); window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, mode]);
  // Esc closes her. Beside the content only with the focus in the panel (an Esc used on the screen is the screen's); never while
  // the decision window is open (Esc closes that window) or while recording or counting down. Whatever handled the key first
  // (a dialog of the page, the recording) wins.
  useEffect(() => {
    if (!open) return;
    let decision: Event | undefined;
    const early = (event: KeyboardEvent) => { if (event.key === 'Escape' && content.current?.querySelector('[data-sec-decision="true"]')) decision = event; };
    const late = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event === decision || holds(content.current)) return;
      if (mode === 'side' && !content.current?.contains(document.activeElement)) return;
      event.preventDefault(); setOpen(false);
    };
    window.addEventListener('keydown', early, true); window.addEventListener('keydown', late);
    return () => { window.removeEventListener('keydown', early, true); window.removeEventListener('keydown', late); };
  }, [open, mode]);
  /** On top of the content the Tab key cycles inside the panel. */
  function trapTab(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (mode === 'side' || event.key !== 'Tab') return;
    const items = Array.from(content.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], textarea:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? []).filter(item => item.getClientRects().length);
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && (document.activeElement === first || !content.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  const place = mode === 'full'
    ? { left: 'var(--app-viewport-left, 0px)', top: 'var(--app-viewport-top, 0px)', width: 'var(--app-viewport-width, 100vw)', height: 'var(--app-viewport-height, 100dvh)', paddingTop: 'var(--safe-top, 0px)',
      // Landscape phones: keep the text out from under the notch and the rounded corners.
      paddingLeft: 'var(--safe-left, 0px)', paddingRight: 'var(--safe-right, 0px)', ['--sec-bottom-inset' as string]: keyboard ? '0px' : 'var(--safe-bottom, 0px)' }
    : { right: 'var(--safe-right, 0px)', top: mode === 'side' ? `max(${top}px, var(--safe-top, 0px))` : 'var(--safe-top, 0px)', bottom: 'var(--safe-bottom, 0px)' };
  return visited ? createPortal(<>
    {open && mode === 'over' && <div aria-hidden="true" className="sec-scrim fixed inset-0 z-40 bg-black/50 print:hidden" onClick={() => { if (!holds(content.current)) setOpen(false); }} />}
    <div ref={content} role="dialog" aria-modal={open && mode !== 'side' ? true : undefined} aria-labelledby="secretary-title" aria-describedby="secretary-description"
      data-state={open ? 'open' : 'closed'} data-sec-mode={mode} tabIndex={-1} onKeyDown={trapTab} style={place}
      className={open ? cn('sec-panel fixed z-50 flex min-h-0 flex-col bg-background text-foreground focus:outline-none print:hidden',
        mode !== 'full' && 'w-[400px] max-w-full border-l border-border-strong motion-safe:animate-in motion-safe:slide-in-from-right-8 motion-safe:fade-in-0',
        mode === 'over' && 'shadow-[-24px_0_60px_rgb(0_0_0/0.35)]') : 'hidden'}>
      <header className="sec-header">
        <span aria-hidden="true" className="sec-mark"><Sparkles className="h-5 w-5" /></span>
        <div className="sec-head-text min-w-0 flex-1">
          <h2 id="secretary-title" className="text-base font-semibold leading-tight">Secretária</h2>
          <p id="secretary-description" className="text-xs text-muted-foreground">Você pede. Revisa. Confirma.</p>
        </div>
        <Button size="icon" variant="outline" aria-label="Fechar Secretária" className="shrink-0 max-lg:rounded-full" onClick={() => setOpen(false)}><X aria-hidden="true" className="h-5 w-5 lg:h-4 lg:w-4" /></Button>
      </header>
      {/* Following a link out of the chat closes the panel (the conversation stays mounted): on top of the content the rest of
          the app is inert while she is open, so the destination would be unusable. */}
      <div className="min-h-0 flex-1"><SecretaryChat voiceEnabled={voiceEnabled} voiceCorrection={voiceCorrection} transcribeEnabled={transcribeEnabled} feedbackEnabled={feedbackEnabled} flowEnabled={flowEnabled} active={open} onNavigate={() => setOpen(false)} /></div>
    </div>
  </>, document.body) : null;
}

/** The page /servicos/secretaria: opens the same panel. */
export function SecretaryEntry() {
  return <Button onClick={openSecretary}>Abrir Secretária</Button>;
}
