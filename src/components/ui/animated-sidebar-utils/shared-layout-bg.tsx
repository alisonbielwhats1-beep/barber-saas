"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type ElementType,
  forwardRef,
  type HTMLAttributes,
  type PointerEvent,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { SPRING_LAYOUT } from "./ease";

export interface SharedLayoutBgProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  /** Recuo do destaque em relação ao item, em px. */
  inset?: number;
  pillClassName?: string;
  pillContainerClassName?: string;
}

/**
 * Destaque de hover que desliza entre os itens da lista. Fica num wrapper
 * irmão da lista (e não dentro dela) para que `ul` continue contendo só `li`.
 */
export const SharedLayoutBg = forwardRef<HTMLElement, SharedLayoutBgProps>(
  function SharedLayoutBg(
    { as: Tag = "div", children, className, inset = 0, pillClassName, pillContainerClassName, ...props },
    forwardedRef,
  ) {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const [hover, setHover] = useState<{ top: number; height: number } | null>(null);
    const reduce = useReducedMotion() ?? false;

    function track(event: PointerEvent<HTMLDivElement>) {
      if (event.pointerType === "touch") return;
      const wrapper = wrapperRef.current;
      const item = (event.target as HTMLElement).closest<HTMLElement>('[data-slot="sidebar-menu-item"]');
      const target = item?.firstElementChild as HTMLElement | null;
      if (!wrapper || !item || !target || !wrapper.contains(item)) return;
      if (item.parentElement?.closest("[data-shared-layout-bg]") !== wrapper) return;
      const wrapperBox = wrapper.getBoundingClientRect();
      const box = target.getBoundingClientRect();
      const next = { top: box.top - wrapperBox.top, height: box.height };
      setHover((current) => (current && current.top === next.top && current.height === next.height ? current : next));
    }

    return (
      <div
        ref={wrapperRef}
        data-shared-layout-bg=""
        className="relative"
        onPointerMove={track}
        onPointerLeave={() => setHover(null)}
      >
        <AnimatePresence>
          {hover ? (
            <motion.span
              aria-hidden="true"
              className={cn("pointer-events-none absolute inset-x-0 top-0", pillContainerClassName)}
              initial={{ opacity: 0, y: hover.top, height: hover.height }}
              animate={{ opacity: 1, y: hover.top, height: hover.height }}
              exit={{ opacity: 0 }}
              transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
            >
              <span className={cn("absolute", pillClassName)} style={{ inset }} />
            </motion.span>
          ) : null}
        </AnimatePresence>
        <Tag {...props} ref={forwardedRef} className={cn("relative", className)}>
          {children}
        </Tag>
      </div>
    );
  },
);
