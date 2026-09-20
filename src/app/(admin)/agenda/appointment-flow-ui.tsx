"use client";

import { useId } from "react";
import { Check, Search } from "lucide-react";
import type { ClientOption } from "./appointment-form";

export function AppointmentSteps({ step }: { step: number }) {
  return <ol aria-label="Etapas do agendamento" className="appointment-steps">
    {["Cliente", "Serviços", "Revisão"].map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined} data-complete={index < step} className="appointment-step">
      <span className={`appointment-step-number grid h-7 w-7 shrink-0 place-items-center rounded-full ${index <= step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
        {index < step ? <Check size={14} aria-hidden /> : index + 1}
      </span>
      <span className={index === step ? "font-semibold" : "text-muted-foreground"}>{label}</span>
    </li>)}
  </ol>;
}

export function ClientChoice({ query, onQuery, options, selected, onSelect, searching, error }: {
  query: string; onQuery: (value: string) => void; options: ClientOption[];
  selected: string; onSelect: (client: ClientOption) => void; searching: boolean; error: string;
}) {
  const id = useId();
  return <div className="space-y-3">
    <label className="flex min-h-12 items-center gap-2 rounded-xl border border-border bg-surface-1 px-3 focus-within:ring-2 focus-within:ring-ring">
      <Search size={18} aria-hidden className="shrink-0 text-muted-foreground" />
      <span className="sr-only">Pesquisar cliente</span>
      <input type="search" maxLength={100} value={query} onChange={e => { e.stopPropagation(); onQuery(e.target.value); }} aria-describedby={id} autoComplete="off" placeholder="Buscar por nome ou telefone" className="min-w-0 flex-1 bg-transparent py-3 text-base outline-none" />
    </label>
    <p id={id} role="status" className="text-xs text-muted-foreground">{error || (searching ? "Pesquisando…" : query.trim().length >= 2 ? `${options.length} resultado(s).${options.length === 50 ? " Refine a busca para encontrar outros clientes." : ""}` : "Digite pelo menos 2 caracteres para buscar em todos os clientes disponíveis.")}</p>
    <div className="appointment-client-list overflow-y-auto rounded-xl border border-border" aria-label="Clientes encontrados">
      {options.map(client => <button key={client.id} type="button" aria-pressed={selected === client.id} onClick={() => onSelect(client)} className="flex min-h-14 w-full items-center gap-3 border-b border-border px-3 py-3 text-left last:border-0 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:bg-primary/10">
        <span className="min-w-0 flex-1 break-words"><span className="block text-sm font-medium">{client.name}</span><span className="block text-xs text-muted-foreground">{client.phone || "Sem telefone"}</span></span>
        {selected === client.id && <Check size={18} className="shrink-0 text-primary" aria-hidden />}
      </button>)}
      {!options.length && !searching && <p className="p-4 text-sm text-muted-foreground">Nenhum cliente encontrado. Tente outro nome ou cadastre um novo cliente.</p>}
    </div>
  </div>;
}

export function AppointmentSummaryRow({ label, children, onEdit, disabled = false }: {
  label: string; children: React.ReactNode; onEdit?: () => void; disabled?: boolean;
}) {
  return <section className="appointment-summary-row border-b border-border py-2 last:border-0">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</h3>
      {onEdit && <button type="button" disabled={disabled} onClick={onEdit} aria-label={`Alterar ${label.toLocaleLowerCase("pt-BR")}`} className="min-h-11 px-2 text-sm font-medium text-primary disabled:opacity-50">Alterar</button>}
    </div>
    <div className="break-words text-sm">{children}</div>
  </section>;
}
