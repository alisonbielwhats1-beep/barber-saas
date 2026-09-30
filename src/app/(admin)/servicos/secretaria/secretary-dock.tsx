"use client";
import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Mic, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SecretaryChat } from './secretary-chat';

export function SecretaryDock({ voiceEnabled, voiceCorrection = false, transcribeEnabled = false, feedbackEnabled = false }: { voiceEnabled: boolean; voiceCorrection?: boolean; transcribeEnabled?: boolean; feedbackEnabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    content.current?.querySelector<HTMLElement>('textarea')?.focus();
    if (desktop) return;
    // Keep the conversation mounted across viewport changes; only the surrounding
    // product becomes inert while the mobile sheet is open.
    const shell = document.querySelector<HTMLElement>('.admin-shell');
    const wasInert = shell?.inert ?? false;
    if (shell) shell.inert = true;
    return () => { if (shell) shell.inert = wasInert; };
  }, [open, desktop]);
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
      <Dialog.Trigger asChild><Button aria-label="Abrir Secretária" className="fixed right-4 z-40 min-h-12 rounded-full px-4 shadow-lg print:hidden" style={{ bottom: 'calc(5rem + var(--safe-bottom, 0px))' }}><Mic aria-hidden="true" className="mr-2 h-5 w-5" />Secretária</Button></Dialog.Trigger>
      {visited && <Dialog.Portal forceMount>
        <Dialog.Content ref={content} forceMount aria-modal={open && !desktop ? true : undefined} onInteractOutside={event => event.preventDefault()} onOpenAutoFocus={event => { if (!open) event.preventDefault(); }}
          onKeyDown={event => {
            if (desktop || event.key !== 'Tab') return;
            const items = Array.from(content.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], textarea:not(:disabled), [tabindex="0"]') ?? []).filter(item => item.getClientRects().length);
            const first = items[0], last = items.at(-1);
            if (event.shiftKey && (document.activeElement === first || !content.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }}
          aria-describedby="secretary-description" className={open ? 'fixed z-50 flex min-h-0 flex-col border-l border-border bg-card text-foreground shadow-xl focus:outline-none print:hidden' : 'hidden'}
          style={desktop ? { right: 'var(--safe-right, 0px)', top: 'var(--safe-top, 0px)', bottom: 'var(--safe-bottom, 0px)', width: 400 }
            : { left: 'var(--app-viewport-left, 0px)', top: 'var(--app-viewport-top, 0px)', width: 'var(--app-viewport-width, 100vw)', height: 'var(--app-viewport-height, 100dvh)', paddingTop: 'var(--safe-top, 0px)' }}>
          <header className="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
            <div><Dialog.Title className="font-semibold">Secretária</Dialog.Title><Dialog.Description id="secretary-description" className="text-xs text-muted-foreground">Você pede. Revisa. Confirma.</Dialog.Description></div>
            <Dialog.Close asChild><Button size="icon" variant="ghost" aria-label="Fechar Secretária"><X aria-hidden="true" className="h-5 w-5" /></Button></Dialog.Close>
          </header>
          {/* Following a link out of the chat closes the dock (the conversation stays mounted): on mobile an open
              dock keeps the rest of the app inert, so the destination would be unusable. */}
          <div className="min-h-0 flex-1"><SecretaryChat voiceEnabled={voiceEnabled} voiceCorrection={voiceCorrection} transcribeEnabled={transcribeEnabled} feedbackEnabled={feedbackEnabled} active={open} onNavigate={() => setOpen(false)} /></div>
        </Dialog.Content>
      </Dialog.Portal>}
    </Dialog.Root>
  </>;
}

export function SecretaryEntry() {
  return <Button onClick={() => window.dispatchEvent(new Event('everflair:secretary-open'))}>Abrir Secretária</Button>;
}
