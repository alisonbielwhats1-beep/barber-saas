import { Children, cloneElement, isValidElement, useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * Peças visuais comuns das seções de Configurações (protótipo v6, "cf-block"):
 * cada bloco é um cartão com título 14/600 e descrição 12 abaixo; campos com rótulo
 * 14/500 e controles de 44 px no celular e 40 px no computador.
 */

/** Same look as `Input`, for native selects and other hand-made controls. */
export const controlClass = "flex min-h-11 w-full min-w-0 max-w-full rounded-[10px] border border-border-strong bg-background px-3 text-base text-foreground ring-offset-background transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-10 lg:text-sm";
export const selectClass = cn(controlClass, "text-ellipsis");
export const textareaClass = "flex min-h-[88px] w-full min-w-0 max-w-full resize-y rounded-[10px] border border-border-strong bg-background px-3 py-2.5 text-base leading-relaxed text-foreground ring-offset-background transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 lg:text-sm";
export const labelClass = "block text-sm font-medium text-muted-foreground";
export const noteClass = "text-xs leading-relaxed text-muted-foreground";
/** Checkbox rows: 44 px touch target on the phone, 36 px on the computer. */
export const checkRowClass = "flex min-h-11 cursor-pointer items-center gap-2.5 text-sm lg:min-h-9";
export const checkboxClass = "h-5 w-5 shrink-0 accent-[hsl(var(--selection-solid))]";
/** Inner panel of a block (forms that open inside it, rules, closures). */
export const subPanelClass = "flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-background px-3.5 py-3";

/** Card of one settings block: title and action side by side, description below. */
export function SettingsBlock({ title, titleId, hint, action, children, className }: {
  title?: ReactNode;
  titleId?: string;
  hint?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-3.5 rounded-[14px] border border-border bg-card p-4", className)}>
      {(title || hint || action) && (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          {title ? <h3 id={titleId} className="min-w-0 flex-auto text-sm font-semibold [overflow-wrap:anywhere]">{title}</h3>
            : hint ? <p className={cn(noteClass, "min-w-[min(100%,260px)] flex-1")}>{hint}</p> : null}
          {action}
          {title && hint && <p className={cn(noteClass, "basis-full")}>{hint}</p>}
        </div>
      )}
      {children}
    </div>
  );
}

/** Label tied to the first child control by id; hint below. */
export function SettingsField({ label, hint, children, hideLabel = false, className }: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  hideLabel?: boolean;
  className?: string;
}) {
  const generated = useId();
  const items = Children.toArray(children);
  const first = items[0];
  const own = isValidElement<{ id?: string }>(first) ? first.props.id : undefined;
  const id = own ?? generated;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : labelClass}>{label}</label>
      {items.map((child, index) => index === 0 && !own && isValidElement<{ id?: string }>(child) ? cloneElement(child, { id }) : child)}
      {hint && <p className={noteClass}>{hint}</p>}
    </div>
  );
}
