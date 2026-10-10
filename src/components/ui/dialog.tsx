"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
const DialogThemeContext = React.createContext<"salon-dark" | "salon-light" | undefined>(undefined);
export const DialogThemeProvider = DialogThemeContext.Provider;
/**
 * Onde "painel inferior abaixo de 768px" é o padrão das janelas. Fora de um provider (telas públicas, painel da
 * plataforma, HQ, onboarding) o padrão continua sendo a janela centralizada de produção; só o painel do
 * estabelecimento liga a folha inferior (ver `src/app/(admin)/layout.tsx`). A prop `mobileSheet` de cada janela vence.
 */
const DialogMobileSheetContext = React.createContext(false);
export function DialogMobileSheetDefault({ value = true, children }: { value?: boolean; children: React.ReactNode }) {
  return <DialogMobileSheetContext.Provider value={value}>{children}</DialogMobileSheetContext.Provider>;
}
/** Padrão de folha inferior vigente para as janelas deste ponto da árvore (para quem adapta o próprio conteúdo ao modo folha). */
export function useDialogMobileSheetDefault() {
  return React.useContext(DialogMobileSheetContext);
}
/** O cabeçalho só precisa se afastar do botão X quando a janela usa o preenchimento padrão. */
const DialogReservesCloseContext = React.createContext(false);
/** Quem define o próprio preenchimento (p-0, p-4, pr-0…) cuida sozinho do espaço do botão X. */
const OWN_PADDING = /(^| )p[xr]?-/;

/** A downward drag longer than this (or a quick flick) closes a mobile sheet. */
const SHEET_DISMISS_PX = 96;
const SHEET_DISMISS_VELOCITY = 0.55;

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /**
     * Below 768px the dialog is a bottom sheet with a grabber. Omitted, it follows `DialogMobileSheetDefault`
     * (on only inside the establishment panel; centred everywhere else). `true`/`false` always win.
     */
    mobileSheet?: boolean;
  }
>(({ className, children, style, onScroll, mobileSheet: mobileSheetProp, ...props }, ref) => {
  const sheetDefault = React.useContext(DialogMobileSheetContext);
  const mobileSheet = mobileSheetProp ?? sheetDefault;
  const theme = React.useContext(DialogThemeContext);
  const closeButton = React.useRef<HTMLButtonElement>(null);
  const content = React.useRef<HTMLDivElement | null>(null);
  const drag = React.useRef<{ startY: number; lastY: number; lastT: number; velocity: number } | null>(null);
  const setRefs = React.useCallback((node: HTMLDivElement | null) => {
    content.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  }, [ref]);
  // No celular o conteúdo usa a largura toda (pr-6); o 64px do X (pr-16) só vale de sm para cima.
  // O título e a descrição se afastam do X pelo DialogHeader (pr-10), não pela janela inteira.
  const reservesClose = !OWN_PADDING.test(className ?? "");

  // Arrastar a alça para baixo fecha o painel como o X: mesma saída, mesmas confirmações de descarte.
  function settle(node: HTMLDivElement) {
    node.style.transition = "translate 220ms cubic-bezier(0.32, 0.72, 0, 1)";
    node.style.translate = "0 0";
  }
  function onGrabStart(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startY: event.clientY, lastY: event.clientY, lastT: event.timeStamp, velocity: 0 };
  }
  function onGrabMove(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current, node = content.current;
    if (!state || !node) return;
    const elapsed = Math.max(1, event.timeStamp - state.lastT);
    state.velocity = (event.clientY - state.lastY) / elapsed;
    state.lastY = event.clientY;
    state.lastT = event.timeStamp;
    const offset = Math.max(0, event.clientY - state.startY);
    node.style.transition = "none";
    node.style.translate = `0 ${offset}px`;
  }
  function onGrabEnd() {
    const state = drag.current, node = content.current;
    drag.current = null;
    if (!state || !node) return;
    const offset = state.lastY - state.startY;
    if (offset > SHEET_DISMISS_PX || (offset > 24 && state.velocity > SHEET_DISMISS_VELOCITY)) {
      closeButton.current?.click();
      // Quem pede confirmação antes de fechar (formulário com alterações) mantém o painel aberto: ele volta ao lugar.
      window.setTimeout(() => { if (node.dataset.state === "open") settle(node); }, 60);
    } else settle(node);
  }

  return (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
    <DialogPrimitive.Content
      ref={setRefs}
      data-theme={theme}
      data-mobile-sheet={mobileSheet || undefined}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 grid min-h-0 min-w-0 w-full max-w-lg overflow-y-auto overscroll-contain -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border border-border bg-card p-6 shadow-2xl",
        reservesClose && "pr-6 sm:pr-16",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        "data-[state=open]:duration-200 data-[state=closed]:duration-150",
        className,
      )}
      {...props}
      style={{
        ...style,
        top: "calc(var(--app-viewport-top, 0px) + (var(--app-viewport-height, 100dvh) + var(--safe-top, 0px) - var(--safe-bottom, 0px)) / 2)",
        left: "calc(var(--app-viewport-left, 0px) + (var(--app-viewport-width, 100vw) + var(--safe-left, 0px) - var(--safe-right, 0px)) / 2)",
        transform: "translate(-50%, -50%)",
        width: "calc(var(--app-viewport-width, 100vw) - var(--safe-left, 0px) - var(--safe-right, 0px) - 1rem)",
        maxHeight: "calc(var(--app-viewport-height, 100dvh) - var(--safe-top, 0px) - var(--safe-bottom, 0px) - 1rem)",
        scrollPaddingBlock: "3.5rem 1rem",
      }}
      onScroll={event => {
        if (event.target === event.currentTarget && closeButton.current) {
          closeButton.current.style.transform = `translateY(${event.currentTarget.scrollTop}px)`;
        }
        onScroll?.(event);
      }}
    >
      <DialogReservesCloseContext.Provider value={reservesClose}>{children}</DialogReservesCloseContext.Provider>
      {/* Depois do conteúdo: seletores ":first-child" das janelas continuam valendo. Posição absoluta no topo. */}
      {mobileSheet && <div data-sheet-grabber aria-hidden="true" onPointerDown={onGrabStart} onPointerMove={onGrabMove} onPointerUp={onGrabEnd} onPointerCancel={onGrabEnd} />}
      <DialogPrimitive.Close
        ref={closeButton}
        type="button"
        aria-label="Fechar janela"
        className="absolute right-2 top-2 z-10 grid h-11 w-11 place-items-center rounded-full bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X aria-hidden="true" className="h-4 w-4" />
        <span className="sr-only">Fechar</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
  );
});
DialogContent.displayName = "DialogContent";

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const reservesClose = React.useContext(DialogReservesCloseContext);
  return <div className={cn("flex flex-col gap-1", reservesClose && "pr-10 sm:pr-0", className)} {...props} />;
}
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}
export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-base font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = "DialogDescription";
