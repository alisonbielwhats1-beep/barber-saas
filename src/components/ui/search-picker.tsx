"use client";

import { useId, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./dialog";

export const normalizeSearch = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
export type SearchOption = {
  value: string;
  label: string;
  description?: string;
};

/** Touch-first picker; native buttons keep keyboard and screen-reader behavior predictable. */
export function SearchPicker({
  label,
  value,
  options,
  onChange,
  placeholder = "Selecionar",
  disabled = false,
}: {
  label: string;
  value: string;
  options: SearchOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const id = useId();
  const selected = options.find((option) => option.value === value);
  const matches = options.filter((option) =>
    normalizeSearch(`${option.label} ${option.description ?? ""}`).includes(
      normalizeSearch(query),
    ),
  );
  return (
    <div className="grid min-w-0 gap-1">
      <span id={id} className="text-sm">
        {label}
      </span>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setQuery("");
        }}
      >
        <DialogTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={label}
            className="flex min-h-12 w-full min-w-0 items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2 text-left text-base disabled:opacity-50"
          >
            <span className="min-w-0 break-words">
              {selected?.label ?? placeholder}
            </span>
            <ChevronDown
              aria-hidden
              className="h-4 w-4 shrink-0 text-muted-foreground"
            />
          </button>
        </DialogTrigger>
        <DialogContent
          mobileSheet
          aria-labelledby={`${id}-title`}
          className="gap-3 overflow-hidden p-4 pt-6 sm:p-6"
          onOpenAutoFocus={(event) => {
            // Opening the mobile keyboard immediately would hide most of the choices.
            if (window.matchMedia("(max-width: 767px)").matches) {
              event.preventDefault();
              document.getElementById(`${id}-title`)?.focus();
            }
          }}
        >
          <DialogTitle
            id={`${id}-title`}
            tabIndex={-1}
            className="pr-10 text-xl outline-none"
          >
            {label}
          </DialogTitle>
          <DialogDescription>
            Pesquise e toque em uma opção para selecionar.
          </DialogDescription>
          <label className="flex min-h-12 items-center gap-2 rounded-xl border border-border bg-background px-3">
            <Search
              size={18}
              aria-hidden
              className="shrink-0 text-muted-foreground"
            />
            <span className="sr-only">
              Pesquisar {label.toLocaleLowerCase("pt-BR")}
            </span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Digite para pesquisar"
              className="min-w-0 flex-1 bg-transparent py-3 text-base outline-none"
            />
          </label>
          <p role="status" className="text-xs text-muted-foreground">
            {matches.length} {matches.length === 1 ? "opção" : "opções"}
          </p>
          <div className="min-h-0 max-h-[45dvh] overflow-y-auto overscroll-contain rounded-xl border border-border">
            {matches.map((option) => (
              <button
                type="button"
                key={option.value}
                aria-pressed={value === option.value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className="flex min-h-14 w-full items-center gap-3 border-b border-border px-4 py-3 text-left last:border-0 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:bg-primary/10"
              >
                <span className="min-w-0 flex-1 break-words">
                  <span className="block text-sm font-medium">
                    {option.label}
                  </span>
                  {option.description && (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  )}
                </span>
                {value === option.value && (
                  <Check
                    size={18}
                    aria-hidden
                    className="shrink-0 text-primary"
                  />
                )}
              </button>
            ))}
            {!matches.length && (
              <p className="p-5 text-sm text-muted-foreground">
                Nenhuma opção encontrada. Tente parte do nome ou limpe a
                pesquisa.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
