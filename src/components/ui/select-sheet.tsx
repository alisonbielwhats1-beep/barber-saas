"use client";

import { useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./dialog";
import { useIsMobile } from "./use-media-query";

export type SelectSheetOption = { value: string; label: string; description?: string; disabled?: boolean };

/** Lists longer than this get a search field in the sheet. */
const SEARCH_FROM = 9;

/**
 * Choice field that behaves like an app on phones: the field opens a bottom
 * sheet with large, checkable rows. From 768px up it is the same native
 * `<select>` as before (forms, labels and keyboard use stay identical).
 * On phones a hidden mirror `<select>` keeps `name` in the form data and
 * fires the same "change" event the visible select used to.
 */
export function SelectSheet({
  id,
  name,
  value,
  defaultValue,
  onValueChange,
  options,
  title,
  placeholder,
  disabled,
  required,
  className,
  ...aria
}: {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: readonly SelectSheetOption[];
  /** Sheet title on phones, normally the field label. */
  title: string;
  /** Empty choice ("Selecione…"); shown when nothing is chosen. */
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}) {
  const mobile = useIsMobile();
  const controlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue ?? (placeholder ? "" : options[0]?.value ?? ""));
  const current = controlled ? value : internal;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const mirror = useRef<HTMLSelectElement>(null);

  function choose(next: string) {
    if (!controlled) setInternal(next);
    onValueChange?.(next);
  }
  /** Phone choice: the hidden mirror select fires a real "change", so forms see the edit (unsaved-changes guards). */
  function chooseFromSheet(next: string) {
    choose(next);
    const node = mirror.current;
    if (node && node.value !== next) {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(node, next);
      node.dispatchEvent(new Event("change", { bubbles: true }));
    }
    setOpen(false);
  }

  const selected = options.find((option) => option.value === current);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{Diacritic}/gu, "");
    if (!needle) return options;
    return options.filter((option) =>
      option.label.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{Diacritic}/gu, "").includes(needle));
  }, [options, query]);

  if (!mobile) {
    return (
      <select
        id={id}
        name={name}
        {...(controlled ? { value } : { defaultValue: current })}
        onChange={(event) => choose(event.target.value)}
        disabled={disabled}
        required={required}
        className={className}
        {...aria}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
        ))}
      </select>
    );
  }

  return (
    <>
      <select ref={mirror} name={name} value={current} onChange={() => {}} hidden aria-hidden="true" tabIndex={-1}>
        {placeholder !== undefined && <option value="" />}
        {options.map((option) => <option key={option.value} value={option.value} />)}
      </select>
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setQuery(""); setOpen(true); }}
        className={cn(className, "press-row flex items-center justify-between gap-2 text-left")}
        {...aria}
      >
        <span className={cn("min-w-0 flex-1 truncate", !selected && "text-muted-foreground")}>{selected?.label ?? placeholder ?? "Selecionar"}</span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby={undefined} className="gap-3 sm:max-w-sm">
          <DialogHeader><DialogTitle className="text-[17px] leading-snug">{title}</DialogTitle></DialogHeader>
          {options.length >= SEARCH_FROM && (
            <label className="flex min-h-11 items-center gap-2 rounded-xl bg-surface-1 px-3 ring-1 ring-inset ring-border">
              <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="sr-only">Buscar em {title}</span>
              <input type="search" inputMode="search" enterKeyHint="search" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar" className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground" />
            </label>
          )}
          <div role="radiogroup" aria-label={title} className="max-h-[55dvh] overflow-y-auto overscroll-contain rounded-2xl bg-surface-1 ring-1 ring-inset ring-border">
            {placeholder !== undefined && !query && (
              <OptionRow label={placeholder} muted checked={current === ""} onSelect={() => chooseFromSheet("")} />
            )}
            {visible.map((option) => (
              <OptionRow key={option.value} label={option.label} description={option.description} disabled={option.disabled}
                checked={option.value === current} onSelect={() => chooseFromSheet(option.value)} />
            ))}
            {visible.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nada encontrado.</p>}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function OptionRow({ label, description, checked, disabled, muted, onSelect }: {
  label: string; description?: string; checked: boolean; disabled?: boolean; muted?: boolean; onSelect: () => void;
}) {
  return (
    <button type="button" role="radio" aria-checked={checked} disabled={disabled} onClick={onSelect}
      className="press-row flex min-h-[3.25rem] w-full items-center gap-3 border-b border-border px-4 py-2.5 text-left last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-45">
      <span className="min-w-0 flex-1">
        <span className={cn("block text-[15px]", checked ? "font-semibold" : "font-medium", muted && "text-muted-foreground")}>{label}</span>
        {description && <span className="mt-0.5 block text-[13px] text-muted-foreground">{description}</span>}
      </span>
      <Check aria-hidden="true" className={cn("h-5 w-5 shrink-0 text-primary", !checked && "invisible")} />
    </button>
  );
}
