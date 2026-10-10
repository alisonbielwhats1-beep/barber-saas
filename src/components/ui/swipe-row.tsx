"use client";

import { useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type SwipeAction = {
  key: string;
  label: string;
  icon: LucideIcon;
  tone?: "primary" | "danger" | "neutral";
  onSelect: () => void;
};

const ACTION_WIDTH = 84;

/**
 * Touch-only shortcut: swiping a row to the left reveals its actions, and a long
 * swipe runs the first one (like a mail app). It is an extra path only: every
 * action must also exist as a normal button inside the row, so the revealed
 * buttons stay out of the accessibility tree and the tab order.
 */
export function SwipeRow({
  actions,
  children,
  className,
  disabled = false,
}: {
  actions: readonly SwipeAction[];
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const row = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; y: number; base: number; axis: "x" | "y" | null; id: number } | null>(null);
  const suppressClick = useRef(false);
  const [open, setOpen] = useState(false);
  // Actions stay invisible at rest, so a translucent row never shows them through.
  const [revealed, setRevealed] = useState(false);
  const reveal = actions.length * ACTION_WIDTH;

  function place(offset: number, animate: boolean) {
    const node = row.current;
    if (!node) return;
    node.style.transition = animate ? "translate 260ms cubic-bezier(0.32, 0.72, 0, 1)" : "none";
    node.style.translate = `${offset}px 0`;
  }
  function settle(nextOpen: boolean) {
    setOpen(nextOpen);
    place(nextOpen ? -reveal : 0, true);
    if (!nextOpen) window.setTimeout(() => setRevealed(false), 260);
  }

  if (disabled || actions.length === 0) return <div className={className}>{children}</div>;

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <div aria-hidden="true" className="absolute inset-y-0 right-0 flex" style={{ width: reveal, visibility: revealed || open ? "visible" : "hidden" }}>
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            tabIndex={-1}
            onClick={() => { settle(false); action.onSelect(); }}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 text-xs font-semibold",
              action.tone === "danger" ? "bg-destructive text-destructive-foreground" : action.tone === "neutral" ? "bg-muted text-foreground" : "bg-primary text-primary-foreground",
            )}
          >
            <action.icon aria-hidden="true" className="h-5 w-5" />
            {action.label}
          </button>
        ))}
      </div>
      <div
        ref={row}
        className="relative"
        style={{ touchAction: "pan-y" }}
        onPointerDown={(event) => {
          if (event.pointerType !== "touch") return;
          gesture.current = { x: event.clientX, y: event.clientY, base: open ? -reveal : 0, axis: null, id: event.pointerId };
        }}
        onPointerMove={(event) => {
          const state = gesture.current;
          if (!state || state.id !== event.pointerId) return;
          const dx = event.clientX - state.x, dy = event.clientY - state.y;
          if (!state.axis) {
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
            state.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
            if (state.axis === "x") { event.currentTarget.setPointerCapture(event.pointerId); setRevealed(true); }
          }
          if (state.axis !== "x") return;
          const width = event.currentTarget.offsetWidth;
          place(Math.min(0, Math.max(-width * 0.85, state.base + dx)), false);
        }}
        onPointerUp={(event) => {
          const state = gesture.current;
          gesture.current = null;
          if (!state || state.axis !== "x") return;
          suppressClick.current = true;
          const offset = state.base + (event.clientX - state.x);
          if (offset < -event.currentTarget.offsetWidth * 0.6) { settle(false); actions[0].onSelect(); }
          else settle(offset < -reveal / 2);
        }}
        onPointerCancel={() => { gesture.current = null; settle(open); }}
        onClickCapture={(event) => {
          // A drag (or a tap while open) only moves the row; it never opens what is under the finger.
          if (suppressClick.current || open) {
            event.preventDefault();
            event.stopPropagation();
            suppressClick.current = false;
            if (open) settle(false);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
