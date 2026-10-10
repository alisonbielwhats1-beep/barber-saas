"use client";

import { useId } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  /** Accessible name when the label alone is ambiguous (e.g. an icon). */
  ariaLabel?: string;
};

/**
 * iOS/Material-style segmented control: one track, a sliding thumb under the
 * chosen option. Buttons keep `aria-pressed`, like the filter pills they replace.
 * Overflowing options scroll sideways instead of wrapping into rows.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
  stretch = true,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  ariaLabel: string;
  className?: string;
  /** Options share the width equally (default) or keep their natural width. */
  stretch?: boolean;
}) {
  const thumbId = useId();
  const reduce = useReducedMotion();
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "segmented-control scrollbar-none flex max-w-full gap-[3px] overflow-x-auto rounded-[11px] border border-border-strong bg-card p-[3px]",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            aria-label={option.ariaLabel}
            onClick={() => onChange(option.value)}
            className={cn(
              "press relative isolate inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-lg px-3 text-sm transition-colors lg:min-h-[34px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              stretch && "flex-1",
              active ? "font-semibold text-foreground" : "font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                aria-hidden="true"
                layoutId={thumbId}
                transition={reduce ? { duration: 0 } : { type: "spring", bounce: 0.18, duration: 0.38 }}
                className="absolute inset-0 -z-10 rounded-lg bg-[hsl(var(--border))] ring-1 ring-inset ring-border-strong"
              />
            )}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
