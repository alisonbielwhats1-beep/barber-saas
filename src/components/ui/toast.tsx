"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Info, X } from "lucide-react";

type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; message: string; kind: ToastKind };
type PauseReason = "focus" | "hover";
type ToastTimer = {
  handle: ReturnType<typeof setTimeout>;
  remainingMs: number;
  startedAt: number;
};

export const TOAST_DURATION_MS = 3_500;

let counter = 0;
const listeners = new Set<(toastItem: ToastItem) => void>();

/** Dispara um toast de qualquer client component: `toast("Salvo", "success")`. */
export function toast(message: string, kind: ToastKind = "success") {
  const item = { id: ++counter, message, kind };
  listeners.forEach((listener) => listener(item));
}

const CFG: Record<ToastKind, { icon: typeof Check; color: string }> = {
  success: { icon: Check, color: "#2ECC8B" },
  error: { icon: AlertTriangle, color: "#EF4444" },
  info: { icon: Info, color: "#3B9EFF" },
};

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timersRef = useRef(new Map<number, ToastTimer>());
  const pauseReasonsRef = useRef(new Map<number, Set<PauseReason>>());
  const closeButtonsRef = useRef(new Map<number, HTMLButtonElement>());
  const focusOriginsRef = useRef(new Map<number, HTMLElement>());
  const pendingFocusRef = useRef<{
    origin: HTMLElement | null;
    targetId: number | null;
  } | null>(null);

  function clearTimer(id: number) {
    const timer = timersRef.current.get(id);
    if (timer) clearTimeout(timer.handle);
    timersRef.current.delete(id);
  }

  function remove(id: number, preserveFocus = false) {
    clearTimer(id);
    pauseReasonsRef.current.delete(id);

    if (preserveFocus) {
      const index = items.findIndex((item) => item.id === id);
      const nextItem = items[index + 1] ?? items[index - 1] ?? null;
      pendingFocusRef.current = {
        targetId: nextItem?.id ?? null,
        origin: focusOriginsRef.current.get(id) ?? null,
      };
    }
    setItems((current) => current.filter((item) => item.id !== id));

    focusOriginsRef.current.delete(id);
  }

  function schedule(id: number, delayMs: number) {
    clearTimer(id);
    const normalizedDelay = Math.max(0, delayMs);
    const handle = setTimeout(() => remove(id), normalizedDelay);
    timersRef.current.set(id, {
      handle,
      remainingMs: normalizedDelay,
      startedAt: Date.now(),
    });
  }

  function pause(id: number, reason: PauseReason) {
    const reasons = pauseReasonsRef.current.get(id) ?? new Set<PauseReason>();
    if (reasons.has(reason)) return;
    const wasRunning = reasons.size === 0;
    reasons.add(reason);
    pauseReasonsRef.current.set(id, reasons);
    if (!wasRunning) return;

    const timer = timersRef.current.get(id);
    if (!timer) return;
    clearTimeout(timer.handle);
    timersRef.current.set(id, {
      ...timer,
      remainingMs: Math.max(0, timer.remainingMs - (Date.now() - timer.startedAt)),
    });
  }

  function resume(id: number, reason: PauseReason) {
    const reasons = pauseReasonsRef.current.get(id);
    if (!reasons) return;
    reasons.delete(reason);
    if (reasons.size > 0) return;
    pauseReasonsRef.current.delete(id);

    const timer = timersRef.current.get(id);
    if (timer) schedule(id, timer.remainingMs);
  }

  useEffect(() => {
    const timers = timersRef.current;
    const pauseReasons = pauseReasonsRef.current;
    const closeButtons = closeButtonsRef.current;
    const focusOrigins = focusOriginsRef.current;
    const add = (item: ToastItem) => {
      if (document.activeElement instanceof HTMLElement) {
        const focusedToastId = [...closeButtons.entries()].find(([, button]) =>
          button === document.activeElement || button.closest("li")?.contains(document.activeElement),
        )?.[0];
        focusOrigins.set(
          item.id,
          focusedToastId !== undefined
            ? focusOrigins.get(focusedToastId) ?? document.activeElement
            : document.activeElement,
        );
      }
      setItems((current) => [...current, item]);
      const handle = setTimeout(() => {
        timers.delete(item.id);
        pauseReasons.delete(item.id);
        focusOrigins.delete(item.id);
        setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      }, TOAST_DURATION_MS);
      timers.set(item.id, {
        handle,
        remainingMs: TOAST_DURATION_MS,
        startedAt: Date.now(),
      });
    };

    listeners.add(add);
    return () => {
      listeners.delete(add);
      timers.forEach((timer) => clearTimeout(timer.handle));
      timers.clear();
      pauseReasons.clear();
      closeButtons.clear();
      focusOrigins.clear();
    };
  }, []);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;

    if (pending.targetId !== null) {
      closeButtonsRef.current.get(pending.targetId)?.focus();
      return;
    }
    if (pending.origin?.isConnected) pending.origin.focus();
  }, [items]);

  return (
    <>
      <div
        data-testid="toast-live-polite"
        aria-live="polite"
        aria-atomic="false"
        className="sr-only"
      >
        {items
          .filter((item) => item.kind !== "error")
          .map((item) => <p key={item.id}>{item.message}</p>)}
      </div>
      <div
        data-testid="toast-live-assertive"
        aria-live="assertive"
        aria-atomic="false"
        className="sr-only"
      >
        {items
          .filter((item) => item.kind === "error")
          .map((item) => <p key={item.id}>{item.message}</p>)}
      </div>

      <ol
        aria-label="Notificações"
        className="pointer-events-none fixed bottom-4 left-4 right-4 z-[200] flex flex-col gap-2 print:hidden sm:bottom-5 sm:left-auto sm:right-5 sm:w-full sm:max-w-xs"
      >
        {items.map((item) => {
          const { icon: Icon, color } = CFG[item.kind];
          return (
            <li
              key={item.id}
              onMouseEnter={() => pause(item.id, "hover")}
              onMouseLeave={() => resume(item.id, "hover")}
              onFocusCapture={() => pause(item.id, "focus")}
              onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  resume(item.id, "focus");
                }
              }}
              className="animate-scale-in pointer-events-auto flex items-start gap-3 rounded-xl border border-border-strong bg-elevated p-3 shadow-premium"
            >
              <span
                className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full"
                style={{ background: `${color}1f`, color }}
              >
                <Icon aria-hidden="true" className="h-3.5 w-3.5" />
              </span>
              <p className="flex-1 pt-0.5 text-[13px] leading-snug">{item.message}</p>
              <button
                ref={(node) => {
                  if (node) closeButtonsRef.current.set(item.id, node);
                  else closeButtonsRef.current.delete(item.id);
                }}
                type="button"
                onClick={() => remove(item.id, true)}
                aria-label={`Fechar notificação: ${item.message}`}
                className="-m-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </li>
          );
        })}
      </ol>
    </>
  );
}
