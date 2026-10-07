"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./dialog";

export type SheetAction = {
  key: string;
  label: string;
  description?: string;
  icon?: LucideIcon;
  tone?: "default" | "primary" | "danger";
  disabled?: boolean;
  /** Runs after the sheet starts closing, so focus returns to the trigger first. */
  onSelect?: () => void;
  href?: string;
};

/**
 * Context actions in a bottom sheet (a centred dialog from 768px up): one large
 * row per action, grouped like a native action sheet. Destructive actions are red.
 */
export function ActionSheet({
  open,
  onOpenChange,
  title,
  description,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  actions: readonly SheetAction[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent {...(description ? {} : { "aria-describedby": undefined })} className="gap-4 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-[17px] leading-snug">{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <ul className="overflow-hidden rounded-2xl bg-surface-1 ring-1 ring-inset ring-border">
          {actions.map((action) => {
            const Icon = action.icon;
            const body = (
              <>
                {Icon && (
                  <span
                    className={cn(
                      "grid h-9 w-9 shrink-0 place-items-center rounded-full",
                      action.tone === "danger" ? "bg-danger/10 text-danger" : action.tone === "primary" ? "bg-primary/15 text-primary" : "bg-muted text-foreground",
                    )}
                  >
                    <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-[15px] font-medium", action.tone === "danger" && "text-danger")}>{action.label}</span>
                  {action.description && <span className="mt-0.5 block text-[13px] text-muted-foreground">{action.description}</span>}
                </span>
              </>
            );
            const rowClass = "press-row flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-45";
            return (
              <li key={action.key} className="border-b border-border last:border-b-0">
                {action.href ? (
                  <Link href={action.href} prefetch={false} onClick={() => onOpenChange(false)} className={rowClass}>
                    {body}
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled={action.disabled}
                    onClick={() => {
                      onOpenChange(false);
                      action.onSelect?.();
                    }}
                    className={rowClass}
                  >
                    {body}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
