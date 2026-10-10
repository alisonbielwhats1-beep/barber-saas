"use client";
// Adaptado de beui.dev/components/motion/animated-sidebar: Tailwind v3, links
// do Next, textos em português, alvos de toque de 44px e cores de seleção
// do tema Everflair.

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import {
  AnimatePresence,
  type HTMLMotionProps,
  motion,
  useReducedMotion,
  type Variants,
} from "motion/react";
import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  createContext,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { SharedLayoutBg } from "@/components/ui/animated-sidebar-utils/shared-layout-bg";
import {
  EASE_DRAWER,
  EASE_OUT,
  SPRING_LAYOUT,
  SPRING_PRESS,
} from "@/components/ui/animated-sidebar-utils/ease";
import { cn } from "@/lib/utils";

type SidebarState = "expanded" | "collapsed";
type SidebarSide = "left" | "right";
type SidebarVariant = "sidebar" | "floating" | "inset";
type SidebarCollapsible = "offcanvas" | "icon" | "none";

/** Acompanha o breakpoint `lg` do painel: abaixo dele a navegação vira gaveta. */
const MOBILE_QUERY = "(max-width: 1023px)";
const SIDEBAR_KEYBOARD_SHORTCUT = "b";

const MotionLink = motion.create(Link);

const PANEL_TRANSITION = {
  duration: 0.36,
  ease: EASE_DRAWER,
} as const;

// A barra para numa largura fixa: a mola é criticamente amortecida para não
// ultrapassar o limite e voltar no último quadro.
const SIDEBAR_MORPH_TRANSITION = {
  type: "spring",
  stiffness: 380,
  damping: 35,
  mass: 0.75,
} as const;

const LABEL_ENTER_TRANSITION = {
  duration: 0.2,
  delay: 0.08,
  ease: EASE_OUT,
} as const;

const LABEL_EXIT_TRANSITION = {
  duration: 0.12,
  ease: EASE_OUT,
} as const;

const SUBMENU_TRANSITION = {
  duration: 0.18,
  ease: EASE_OUT,
} as const;

const SUBMENU_VARIANTS: Variants = {
  closed: {
    opacity: 0,
    clipPath: "inset(0 0 100% 0 round 8px)",
    transition: {
      duration: 0.14,
      ease: EASE_OUT,
      staggerChildren: 0.025,
      staggerDirection: -1,
    },
  },
  open: {
    opacity: 1,
    clipPath: "inset(0 0 0% 0 round 8px)",
    transition: {
      duration: 0.2,
      delayChildren: 0.035,
      ease: EASE_OUT,
      staggerChildren: 0.045,
    },
  },
};

const SUBMENU_ITEM_VARIANTS: Variants = {
  closed: { opacity: 0, y: -6, filter: "blur(3px)" },
  open: { opacity: 1, y: 0, filter: "blur(0px)", transition: SUBMENU_TRANSITION },
};

const REDUCED_TRANSITION = {
  duration: 0.16,
  ease: EASE_OUT,
} as const;

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function subscribeToMobileQuery(callback: () => void) {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function getMobileSnapshot() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

function getServerMobileSnapshot() {
  return false;
}

function useIsMobile() {
  return useSyncExternalStore(subscribeToMobileQuery, getMobileSnapshot, getServerMobileSnapshot);
}

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

interface AnimatedSidebarContextValue {
  isMobile: boolean;
  layoutId: string;
  open: boolean;
  openMobile: boolean;
  reduce: boolean;
  setOpen: (open: boolean) => void;
  setOpenMobile: (open: boolean) => void;
  state: SidebarState;
  toggleSidebar: () => void;
  triggerRef: React.MutableRefObject<HTMLButtonElement | null>;
}

const AnimatedSidebarContext = createContext<AnimatedSidebarContextValue | null>(null);

interface AnimatedSidebarPanelContextValue {
  collapsed: boolean;
  collapsible: SidebarCollapsible;
  side: SidebarSide;
}

const AnimatedSidebarPanelContext = createContext<AnimatedSidebarPanelContextValue | null>(null);

export function useAnimatedSidebar() {
  const context = useContext(AnimatedSidebarContext);
  if (!context) {
    throw new Error("useAnimatedSidebar must be used inside AnimatedSidebarProvider.");
  }
  return context;
}

export function useAnimatedSidebarPanel() {
  const context = useContext(AnimatedSidebarPanelContext);
  if (!context) {
    throw new Error("Animated Sidebar parts must be used inside AnimatedSidebar.");
  }
  return context;
}

type SidebarProviderStyle = CSSProperties & {
  "--sidebar-width"?: string;
  "--sidebar-width-icon"?: string;
};

export interface AnimatedSidebarProviderProps extends HTMLAttributes<HTMLDivElement> {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  openMobile?: boolean;
  defaultOpenMobile?: boolean;
  onOpenMobileChange?: (open: boolean) => void;
  /** Força o modo gaveta (true) ou o modo barra (false) em vez de medir a tela. */
  mobile?: boolean;
  /** Liga o atalho Ctrl/⌘+B. Desligue em providers secundários. */
  shortcut?: boolean;
  style?: SidebarProviderStyle;
}

export function AnimatedSidebarProvider({
  children,
  open,
  defaultOpen = true,
  onOpenChange,
  openMobile,
  defaultOpenMobile = false,
  onOpenMobileChange,
  mobile,
  shortcut = true,
  className,
  style,
  ...props
}: AnimatedSidebarProviderProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [internalOpenMobile, setInternalOpenMobile] = useState(defaultOpenMobile);
  const detectedMobile = useIsMobile();
  const isMobile = mobile ?? detectedMobile;
  const reduce = useReducedMotion() ?? false;
  const generatedId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const desktopOpen = open ?? internalOpen;
  const mobileOpen = openMobile ?? internalOpenMobile;

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (open === undefined) setInternalOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [onOpenChange, open],
  );

  const setOpenMobile = useCallback(
    (nextOpen: boolean) => {
      if (openMobile === undefined) setInternalOpenMobile(nextOpen);
      onOpenMobileChange?.(nextOpen);
    },
    [onOpenMobileChange, openMobile],
  );

  const toggleSidebar = useCallback(() => {
    if (isMobile) setOpenMobile(!mobileOpen);
    else setOpen(!desktopOpen);
  }, [desktopOpen, isMobile, mobileOpen, setOpen, setOpenMobile]);

  useEffect(() => {
    if (!shortcut) return;
    const handleShortcut = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        toggleSidebar();
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [shortcut, toggleSidebar]);

  return (
    <AnimatedSidebarContext.Provider
      value={{
        isMobile,
        layoutId: `${generatedId}-active`,
        open: desktopOpen,
        openMobile: mobileOpen,
        reduce,
        setOpen,
        setOpenMobile,
        state: desktopOpen ? "expanded" : "collapsed",
        toggleSidebar,
        triggerRef,
      }}
    >
      <div
        {...props}
        data-slot="sidebar-wrapper"
        data-state={desktopOpen ? "expanded" : "collapsed"}
        style={{
          "--sidebar-width": "14.25rem",
          "--sidebar-width-icon": "3.5rem",
          ...style,
        }}
        className={cn("group/sidebar-wrapper flex min-h-svh w-full min-w-0", className)}
      >
        {children}
      </div>
    </AnimatedSidebarContext.Provider>
  );
}

function MobileSidebar({
  ariaLabel,
  children,
  className,
  side,
}: {
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  side: SidebarSide;
}) {
  const context = useAnimatedSidebar();
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!context.openMobile) return;

    // O painel do admin rola dentro de <main>; travar o overflow do body basta
    // e não mexe na posição de rolagem.
    const body = document.body;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";

    // Foco síncrono: a gaveta já está montada neste commit.
    const firstFocusable = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (firstFocusable ?? panelRef.current)?.focus({ preventScroll: true });

    const trigger = context.triggerRef;
    return () => {
      body.style.overflow = previousOverflow;
      if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
    };
  }, [context.openMobile, context.triggerRef]);

  if (!mounted) return null;

  const hiddenX = side === "left" ? "-100%" : "100%";

  return createPortal(
    <AnimatePresence>
      {context.openMobile ? (
        <motion.div key="sidebar-sheet" className="fixed left-0 top-0 z-[55] size-0 lg:hidden">
          <motion.button
            type="button"
            aria-label="Fechar menu"
            tabIndex={-1}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={context.reduce ? REDUCED_TRANSITION : PANEL_TRANSITION}
            onClick={() => context.setOpenMobile(false)}
            className="fixed inset-0 bg-black/45"
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            tabIndex={-1}
            data-mobile="true"
            data-state="expanded"
            data-side={side}
            initial={context.reduce ? { opacity: 0 } : { x: hiddenX }}
            animate={context.reduce ? { opacity: 1 } : { x: "0%" }}
            exit={context.reduce ? { opacity: 0 } : { x: hiddenX }}
            transition={context.reduce ? REDUCED_TRANSITION : PANEL_TRANSITION}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                context.setOpenMobile(false);
                return;
              }

              if (event.key !== "Tab") return;
              const focusable = panelRef.current
                ? Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
                : [];

              if (focusable.length === 0) {
                event.preventDefault();
                panelRef.current?.focus();
                return;
              }

              const first = focusable[0];
              const last = focusable[focusable.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
              }
            }}
            className={cn(
              "fixed inset-y-0 flex h-dvh w-[min(20rem,88vw)] flex-col overflow-hidden outline-none",
              "border-border bg-background shadow-2xl will-change-transform",
              side === "left" ? "left-0 rounded-r-2xl border-r" : "right-0 rounded-l-2xl border-l",
              className,
            )}
          >
            <AnimatedSidebarPanelContext.Provider value={{ collapsed: false, collapsible: "none", side }}>
              {children}
            </AnimatedSidebarPanelContext.Provider>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

export interface AnimatedSidebarProps extends Omit<HTMLMotionProps<"aside">, "children"> {
  children?: ReactNode;
  side?: SidebarSide;
  variant?: SidebarVariant;
  collapsible?: SidebarCollapsible;
  ariaLabel?: string;
  panelClassName?: string;
}

export const AnimatedSidebar = forwardRef<HTMLElement, AnimatedSidebarProps>(function AnimatedSidebar(
  {
    side = "left",
    variant = "sidebar",
    collapsible = "icon",
    ariaLabel = "Menu",
    children,
    className,
    panelClassName,
    style,
    ...props
  },
  forwardedRef,
) {
  const context = useAnimatedSidebar();
  const collapsed = collapsible !== "none" && !context.open;
  const offcanvas = collapsed && collapsible === "offcanvas";
  const width = offcanvas ? "0px" : collapsed ? "var(--sidebar-width-icon)" : "var(--sidebar-width)";
  const detached = variant === "floating" || variant === "inset";

  if (context.isMobile) {
    return (
      <MobileSidebar ariaLabel={ariaLabel} className={panelClassName} side={side}>
        {children}
      </MobileSidebar>
    );
  }

  return (
    <motion.aside
      {...props}
      ref={forwardedRef}
      initial={false}
      aria-label={ariaLabel}
      data-slot="sidebar"
      data-state={collapsed ? "collapsed" : "expanded"}
      data-collapsible={collapsible}
      data-variant={variant}
      data-side={side}
      animate={{ width }}
      transition={context.reduce ? { duration: 0 } : SIDEBAR_MORPH_TRANSITION}
      style={style}
      className={cn(
        "group/sidebar peer relative hidden h-auto shrink-0 will-change-[width] lg:block",
        side === "right" && "order-last",
        className,
      )}
    >
      <motion.div
        initial={false}
        animate={{
          opacity: offcanvas ? 0 : 1,
          x: offcanvas ? (side === "left" ? "-100%" : "100%") : "0%",
        }}
        transition={context.reduce ? REDUCED_TRANSITION : PANEL_TRANSITION}
        className={cn(
          "sticky top-0 flex h-svh w-full flex-col overflow-hidden bg-background",
          collapsible === "offcanvas" && "w-[var(--sidebar-width)]",
          variant === "sidebar" && (side === "left" ? "border-r border-border" : "border-l border-border"),
          detached && "m-2 h-[calc(100%-1rem)] w-[calc(100%-1rem)] rounded-2xl",
          variant === "floating" && "border border-border shadow-sm",
          panelClassName,
        )}
      >
        <AnimatedSidebarPanelContext.Provider value={{ collapsed, collapsible, side }}>
          {children}
        </AnimatedSidebarPanelContext.Provider>
      </motion.div>
    </motion.aside>
  );
});

export type AnimatedSidebarTriggerProps = ButtonHTMLAttributes<HTMLButtonElement>;

export const AnimatedSidebarTrigger = forwardRef<HTMLButtonElement, AnimatedSidebarTriggerProps>(
  function AnimatedSidebarTrigger({ className, onClick, type = "button", ...props }, forwardedRef) {
    const context = useAnimatedSidebar();
    const expanded = context.isMobile ? context.openMobile : context.open;

    return (
      <button
        {...props}
        ref={(node) => {
          context.triggerRef.current = node;
          if (typeof forwardedRef === "function") forwardedRef(node);
          else if (forwardedRef) forwardedRef.current = node;
        }}
        type={type}
        aria-label={props["aria-label"] ?? (expanded ? "Recolher menu" : "Expandir menu")}
        aria-expanded={expanded}
        data-slot="sidebar-trigger"
        data-state={expanded ? "expanded" : "collapsed"}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) context.toggleSidebar();
        }}
        className={cn(
          "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      />
    );
  },
);

export type AnimatedSidebarCloseProps = ButtonHTMLAttributes<HTMLButtonElement>;

export const AnimatedSidebarClose = forwardRef<HTMLButtonElement, AnimatedSidebarCloseProps>(
  function AnimatedSidebarClose({ className, onClick, type = "button", ...props }, forwardedRef) {
    const context = useAnimatedSidebar();

    return (
      <button
        {...props}
        ref={forwardedRef}
        type={type}
        aria-label={props["aria-label"] ?? "Fechar menu"}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          if (context.isMobile) context.setOpenMobile(false);
          else context.setOpen(false);
        }}
        className={cn(
          "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      />
    );
  },
);

export type AnimatedSidebarRailProps = ButtonHTMLAttributes<HTMLButtonElement>;

export const AnimatedSidebarRail = forwardRef<HTMLButtonElement, AnimatedSidebarRailProps>(
  function AnimatedSidebarRail({ className, onClick, type = "button", ...props }, forwardedRef) {
    const context = useAnimatedSidebar();
    const panel = useAnimatedSidebarPanel();

    return (
      <button
        {...props}
        ref={forwardedRef}
        type={type}
        data-side={panel.side}
        aria-label={props["aria-label"] ?? "Alternar menu"}
        title="Alternar menu"
        tabIndex={-1}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) context.toggleSidebar();
        }}
        className={cn(
          "absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 outline-none lg:block",
          "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-transparent after:transition-colors hover:after:bg-border",
          "data-[side=left]:left-full data-[side=right]:right-0 data-[side=right]:translate-x-1/2",
          className,
        )}
      />
    );
  },
);

export type AnimatedSidebarInsetProps = HTMLMotionProps<"main">;

export const AnimatedSidebarInset = forwardRef<HTMLElement, AnimatedSidebarInsetProps>(
  function AnimatedSidebarInset({ className, ...props }, forwardedRef) {
    return (
      <motion.main
        {...props}
        ref={forwardedRef}
        data-slot="sidebar-inset"
        className={cn(
          "relative flex min-h-svh min-w-0 flex-1 flex-col bg-background",
          "lg:peer-data-[variant=inset]:m-2 lg:peer-data-[variant=inset]:ml-0 lg:peer-data-[variant=inset]:rounded-2xl lg:peer-data-[variant=inset]:shadow-sm",
          className,
        )}
      />
    );
  },
);

export const AnimatedSidebarHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function AnimatedSidebarHeader({ className, ...props }, forwardedRef) {
    return <div {...props} ref={forwardedRef} data-slot="sidebar-header" className={cn("flex shrink-0 flex-col gap-2 p-3", className)} />;
  },
);

export const AnimatedSidebarContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function AnimatedSidebarContent({ className, ...props }, forwardedRef) {
    return (
      <div
        {...props}
        ref={forwardedRef}
        data-slot="sidebar-content"
        className={cn("flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden overscroll-contain px-2 py-2", className)}
      />
    );
  },
);

export const AnimatedSidebarFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function AnimatedSidebarFooter({ className, ...props }, forwardedRef) {
    return (
      <div
        {...props}
        ref={forwardedRef}
        data-slot="sidebar-footer"
        className={cn("flex shrink-0 flex-col gap-2 border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]", className)}
      />
    );
  },
);

export const AnimatedSidebarGroup = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function AnimatedSidebarGroup({ className, ...props }, forwardedRef) {
    return <div {...props} ref={forwardedRef} data-slot="sidebar-group" className={cn("flex w-full min-w-0 flex-col px-1 py-1.5", className)} />;
  },
);

export const AnimatedSidebarGroupLabel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function AnimatedSidebarGroupLabel({ children, className, ...props }, forwardedRef) {
    const { collapsed } = useAnimatedSidebarPanel();

    return (
      <div
        {...props}
        ref={forwardedRef}
        aria-hidden={collapsed}
        data-slot="sidebar-group-label"
        className={cn(
          "mb-1 h-7 overflow-hidden px-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground transition-opacity",
          collapsed ? "opacity-0" : "opacity-100",
          className,
        )}
      >
        {children}
      </div>
    );
  },
);

export const AnimatedSidebarGroupContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function AnimatedSidebarGroupContent({ className, ...props }, forwardedRef) {
    return <div {...props} ref={forwardedRef} data-slot="sidebar-group-content" className={cn("w-full min-w-0", className)} />;
  },
);

export const AnimatedSidebarMenu = forwardRef<HTMLUListElement, HTMLAttributes<HTMLUListElement>>(
  function AnimatedSidebarMenu({ children, className, ...props }, forwardedRef) {
    return (
      <SharedLayoutBg
        {...props}
        ref={forwardedRef as React.Ref<HTMLElement>}
        as="ul"
        pillClassName="rounded-xl bg-[hsl(var(--card-hover))]"
        data-slot="sidebar-menu"
        className={cn("flex w-full min-w-0 list-none flex-col gap-0.5", className)}
      >
        {children}
      </SharedLayoutBg>
    );
  },
);

export const AnimatedSidebarMenuItem = forwardRef<HTMLLIElement, HTMLMotionProps<"li">>(
  function AnimatedSidebarMenuItem({ className, ...props }, forwardedRef) {
    const context = useAnimatedSidebar();
    return (
      <motion.li
        {...props}
        ref={forwardedRef}
        layout={context.reduce ? false : "position"}
        transition={SPRING_LAYOUT}
        data-slot="sidebar-menu-item"
        className={cn("relative", className)}
      />
    );
  },
);

export interface AnimatedSidebarMenuSubProps extends Omit<HTMLMotionProps<"ul">, "children"> {
  open: boolean;
  children?: ReactNode;
}

export const AnimatedSidebarMenuSub = forwardRef<HTMLUListElement, AnimatedSidebarMenuSubProps>(
  function AnimatedSidebarMenuSub({ open, children, className, ...props }, forwardedRef) {
    const context = useAnimatedSidebar();
    const panel = useAnimatedSidebarPanel();

    return (
      <AnimatePresence initial={false} mode="popLayout">
        {open && !panel.collapsed ? (
          <motion.ul
            {...props}
            ref={forwardedRef}
            key="sidebar-submenu"
            variants={context.reduce ? undefined : SUBMENU_VARIANTS}
            initial={context.reduce ? false : "closed"}
            animate={context.reduce ? { opacity: 1 } : "open"}
            exit={context.reduce ? { opacity: 0 } : "closed"}
            transition={context.reduce ? { duration: 0.12 } : undefined}
            data-slot="sidebar-menu-sub"
            className={cn("relative mb-1 ml-[15px] mt-0.5 flex min-w-0 flex-col gap-px border-l border-border pl-2", className)}
          >
            {children}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    );
  },
);

export const AnimatedSidebarMenuSubItem = forwardRef<HTMLLIElement, HTMLMotionProps<"li">>(
  function AnimatedSidebarMenuSubItem({ className, ...props }, forwardedRef) {
    return (
      <motion.li
        {...props}
        ref={forwardedRef}
        variants={SUBMENU_ITEM_VARIANTS}
        data-slot="sidebar-menu-sub-item"
        className={cn("relative min-w-0", className)}
      />
    );
  },
);

export interface AnimatedSidebarMenuSubButtonProps {
  children: ReactNode;
  icon?: ReactNode;
  href?: string;
  isActive?: boolean;
  disabled?: boolean;
  closeOnSelect?: boolean;
  onSelect?: () => void;
  className?: string;
}

export function AnimatedSidebarMenuSubButton({
  children,
  icon,
  href,
  isActive = false,
  disabled = false,
  closeOnSelect = true,
  onSelect,
  className,
}: AnimatedSidebarMenuSubButtonProps) {
  const context = useAnimatedSidebar();

  const select = (event: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    onSelect?.();
    if (context.isMobile && closeOnSelect) context.setOpenMobile(false);
  };

  const content = (
    <>
      {icon ? (
        <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </>
  );

  const interactiveClassName = cn(
    "flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm outline-none",
    "text-muted-foreground transition-colors hover:bg-[hsl(var(--card-hover))] hover:text-foreground",
    "focus-visible:ring-2 focus-visible:ring-ring",
    // No celular os toques e o texto crescem, como no resto do painel móvel.
    context.isMobile && "h-auto min-h-12",
    isActive && "bg-muted font-medium text-foreground hover:bg-muted hover:text-foreground",
    disabled && "cursor-not-allowed opacity-40",
    className,
  );

  return href ? (
    <MotionLink
      href={href}
      prefetch={false}
      aria-current={isActive ? "page" : undefined}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      onClick={select}
      whileTap={context.reduce || disabled ? undefined : { scale: 0.98 }}
      transition={SPRING_PRESS}
      className={interactiveClassName}
    >
      {content}
    </MotionLink>
  ) : (
    <motion.button
      type="button"
      disabled={disabled}
      aria-current={isActive ? "page" : undefined}
      onClick={select}
      whileTap={context.reduce || disabled ? undefined : { scale: 0.98 }}
      transition={SPRING_PRESS}
      className={interactiveClassName}
    >
      {content}
    </motion.button>
  );
}

export interface AnimatedSidebarMenuButtonProps {
  children: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  href?: string;
  isActive?: boolean;
  ariaExpanded?: boolean;
  ariaControls?: string;
  disabled?: boolean;
  closeOnSelect?: boolean;
  onSelect?: () => void;
  className?: string;
}

export function AnimatedSidebarMenuButton({
  children,
  icon,
  badge,
  href,
  isActive = false,
  ariaExpanded,
  ariaControls,
  disabled = false,
  closeOnSelect,
  onSelect,
  className,
}: AnimatedSidebarMenuButtonProps) {
  const context = useAnimatedSidebar();
  const panel = useAnimatedSidebarPanel();
  const textLabel = typeof children === "string" ? children : undefined;
  // Na barra de ícones o submenu não é renderizado: não anunciar como aberto
  // nem apontar aria-controls para um elemento inexistente.
  const expanded = ariaExpanded === undefined ? undefined : ariaExpanded && !panel.collapsed;

  const select = (event: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    onSelect?.();
    const shouldCloseOnSelect = closeOnSelect ?? ariaExpanded === undefined;
    if (context.isMobile && shouldCloseOnSelect) context.setOpenMobile(false);
    // Submenu não cabe na barra de ícones: abrir um grupo a partir dela
    // expande a barra que vai recebê-lo.
    if (ariaExpanded !== undefined && panel.collapsed && !context.isMobile) context.setOpen(true);
  };

  const content = (
    <>
      {/* Área com submenu aberto: o destaque fica no item interno (padrão do protótipo); na barra de ícones, na área. */}
      {isActive && (ariaExpanded === undefined || panel.collapsed) ? (
        <motion.span
          layoutId={context.layoutId}
          transition={context.reduce ? { duration: 0 } : SPRING_LAYOUT}
          className="absolute inset-0 rounded-md bg-muted"
        />
      ) : null}
      {icon ? (
        <span aria-hidden="true" className={cn("relative z-10 grid size-4 shrink-0 place-items-center", isActive && "text-[hsl(var(--selection-foreground))]")}>
          {icon}
        </span>
      ) : null}
      <motion.span
        initial={false}
        animate={{ opacity: panel.collapsed ? 0 : 1, x: panel.collapsed ? -4 : 0 }}
        transition={context.reduce ? REDUCED_TRANSITION : panel.collapsed ? LABEL_EXIT_TRANSITION : LABEL_ENTER_TRANSITION}
        className={cn("relative z-10 min-w-0 flex-1 truncate", panel.collapsed && "pointer-events-none absolute w-0 overflow-hidden")}
      >
        {children}
      </motion.span>
      {badge ? (
        <span className={cn("z-10 shrink-0", panel.collapsed ? "absolute -right-0.5 -top-0.5" : "relative")}>{badge}</span>
      ) : null}
      {ariaExpanded !== undefined ? (
        <motion.span
          aria-hidden="true"
          initial={false}
          animate={{ opacity: panel.collapsed ? 0 : 1, rotate: expanded ? 90 : 0, x: panel.collapsed ? 4 : 0 }}
          transition={context.reduce ? { duration: 0 } : SPRING_LAYOUT}
          className={cn("relative z-10 grid size-4 shrink-0 place-items-center text-muted-foreground", panel.collapsed && "absolute w-0 overflow-hidden")}
        >
          <ChevronRight className="size-3.5" />
        </motion.span>
      ) : null}
    </>
  );

  const interactiveClassName = cn(
    "relative flex h-8 w-full min-w-0 items-center gap-[9px] overflow-hidden rounded-md px-2 text-left text-sm outline-none",
    "text-muted-foreground transition-colors hover:bg-[hsl(var(--card-hover))] hover:text-foreground",
    "focus-visible:ring-2 focus-visible:ring-ring",
    // Barra de ícones: alvo de 40px centrado, como no protótipo.
    panel.collapsed && "mx-auto w-10 justify-center gap-0 px-0",
    context.isMobile && "h-auto min-h-12",
    isActive && "font-medium text-foreground hover:text-foreground",
    disabled && "cursor-not-allowed opacity-40",
    className,
  );

  return href ? (
    <MotionLink
      href={href}
      prefetch={false}
      aria-current={isActive ? "page" : undefined}
      aria-disabled={disabled || undefined}
      aria-label={panel.collapsed ? textLabel : undefined}
      title={panel.collapsed ? textLabel : undefined}
      tabIndex={disabled ? -1 : undefined}
      onClick={select}
      whileTap={context.reduce || disabled ? undefined : { scale: 0.98 }}
      transition={SPRING_PRESS}
      className={interactiveClassName}
    >
      {content}
    </MotionLink>
  ) : (
    <motion.button
      type="button"
      disabled={disabled}
      aria-current={isActive ? "true" : undefined}
      aria-expanded={expanded}
      aria-controls={expanded ? ariaControls : undefined}
      aria-label={panel.collapsed ? textLabel : undefined}
      title={panel.collapsed ? textLabel : undefined}
      onClick={select}
      whileTap={context.reduce || disabled ? undefined : { scale: 0.98 }}
      transition={SPRING_PRESS}
      className={interactiveClassName}
    >
      {content}
    </motion.button>
  );
}

export default AnimatedSidebar;
