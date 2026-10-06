"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Mic, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SecretaryChat } from './secretary-chat';
import './secretary-mobile.css';

export function SecretaryDock({ voiceEnabled, voiceCorrection = false, transcribeEnabled = false, feedbackEnabled = false, flowEnabled = false }: { voiceEnabled: boolean; voiceCorrection?: boolean; transcribeEnabled?: boolean; feedbackEnabled?: boolean; flowEnabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  /** Owner 06/10 (mobile): with the virtual keyboard open the home-indicator inset is covered, so the composer drops it (iOS reports
   * the keyboard only in the visual viewport, which becomes shorter than the layout viewport). */
  const [keyboard, setKeyboard] = useState(false);
  /** The composer takes the focus; on the phone sheet with voice, the microphone does, so the keyboard does not open over
   * the conversation. */
  const focusComposer = useCallback(() => {
    const mic = !desktop && voiceEnabled ? content.current?.querySelector<HTMLElement>('[data-secretary-mic]') : undefined;
    (mic ?? content.current?.querySelector<HTMLElement>('textarea'))?.focus();
  }, [desktop, voiceEnabled]);
  useEffect(() => {
    if (!open) return;
    // Reopening (the content stays mounted). The first opening mounts the portal later: onOpenAutoFocus below focuses it.
    focusComposer();
    if (desktop) return;
    // Keep the conversation mounted across viewport changes; only the surrounding
    // product becomes inert while the mobile sheet is open.
    const shell = document.querySelector<HTMLElement>('.admin-shell');
    const wasInert = shell?.inert ?? false;
    if (shell) shell.inert = true;
    return () => { if (shell) shell.inert = wasInert; };
  }, [open, desktop, focusComposer]);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setKeyboard(window.innerHeight - viewport.height > 120);
    update(); viewport.addEventListener('resize', update);
    return () => viewport.removeEventListener('resize', update);
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1280px)');
    const update = () => setDesktop(media.matches); update(); media.addEventListener('change', update);
    const show = () => { setVisited(true); setOpen(true); };
    window.addEventListener('everflair:secretary-open', show);
    return () => { media.removeEventListener('change', update); window.removeEventListener('everflair:secretary-open', show); };
  }, []);
  return <>
    {open && desktop && <div aria-hidden="true" className="w-[400px] shrink-0 print:hidden" />}
    <Dialog.Root open={open} onOpenChange={value => { if (value) setVisited(true); setOpen(value); }} modal={false}>
      {/* Owner 06/10 (mobile): on a phone the page's own create button (agenda "+", Novo cliente, Novo serviço) sits at the bottom right above the
       bottom bar; the Secretary stacks above it there, and returns to 5rem from lg up, where those buttons move into the page header. */}
      <Dialog.Trigger asChild><Button aria-label="Abrir Secretária" className="fixed bottom-[calc(9rem+var(--safe-bottom,0px))] right-4 z-40 min-h-12 rounded-full px-4 shadow-lg print:hidden lg:bottom-[calc(5rem+var(--safe-bottom,0px))]"><Mic aria-hidden="true" className="mr-2 h-5 w-5" />Secretária</Button></Dialog.Trigger>
      {visited && <Dialog.Portal forceMount>
        <Dialog.Content ref={content} forceMount aria-modal={open && !desktop ? true : undefined} onInteractOutside={event => event.preventDefault()} onOpenAutoFocus={event => { event.preventDefault(); if (open) focusComposer(); }}
          onKeyDown={event => {
            if (desktop || event.key !== 'Tab') return;
            const items = Array.from(content.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], textarea:not(:disabled), [tabindex="0"]') ?? []).filter(item => item.getClientRects().length);
            const first = items[0], last = items.at(-1);
            if (event.shiftKey && (document.activeElement === first || !content.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }}
          aria-describedby="secretary-description" className={open ? 'fixed z-50 flex min-h-0 flex-col border-l border-border bg-card text-foreground shadow-xl focus:outline-none print:hidden' : 'hidden'}
          style={desktop ? { right: 'var(--safe-right, 0px)', top: 'var(--safe-top, 0px)', bottom: 'var(--safe-bottom, 0px)', width: 400 }
            : { left: 'var(--app-viewport-left, 0px)', top: 'var(--app-viewport-top, 0px)', width: 'var(--app-viewport-width, 100vw)', height: 'var(--app-viewport-height, 100dvh)', paddingTop: 'var(--safe-top, 0px)',
              // Landscape phones: keep the text out from under the notch and the rounded corners.
              paddingLeft: 'var(--safe-left, 0px)', paddingRight: 'var(--safe-right, 0px)', ['--sec-bottom-inset' as string]: keyboard ? '0px' : 'var(--safe-bottom, 0px)' }}>
          <header className="sec-header shrink-0">
            <div className="sec-head-text"><Dialog.Title className="font-semibold">Secretária</Dialog.Title><Dialog.Description id="secretary-description" className="text-xs text-muted-foreground">Você pede. Revisa. Confirma.</Dialog.Description></div>
            <Dialog.Close asChild><Button size="icon" variant="ghost" aria-label="Fechar Secretária"><X aria-hidden="true" className="h-5 w-5" /></Button></Dialog.Close>
          </header>
          {/* Following a link out of the chat closes the dock (the conversation stays mounted): on mobile an open
              dock keeps the rest of the app inert, so the destination would be unusable. */}
          <div className="min-h-0 flex-1"><SecretaryChat voiceEnabled={voiceEnabled} voiceCorrection={voiceCorrection} transcribeEnabled={transcribeEnabled} feedbackEnabled={feedbackEnabled} flowEnabled={flowEnabled} active={open} onNavigate={() => setOpen(false)} /></div>
        </Dialog.Content>
      </Dialog.Portal>}
    </Dialog.Root>
  </>;
}

export function SecretaryEntry() {
  return <Button onClick={() => window.dispatchEvent(new Event('everflair:secretary-open'))}>Abrir Secretária</Button>;
}
