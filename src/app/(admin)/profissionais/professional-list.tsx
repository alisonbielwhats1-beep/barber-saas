"use client";
import { useState, type ReactNode } from "react";
import { Search } from "lucide-react";

export function ProfessionalList({ entries }: { entries: { id: string; name: string; content: ReactNode }[] }) {
  const [search, setSearch] = useState("");
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const shown = entries.filter(entry => normalize(entry.name).includes(normalize(search.trim())));
  return <div className="min-w-0 space-y-3">
    <label className="flex min-h-12 items-center gap-2 rounded-xl border border-border bg-card px-3 focus-within:ring-2 focus-within:ring-ring md:max-w-sm"><Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" /><input aria-label="Buscar profissional" placeholder="Buscar profissional…" value={search} onChange={e => setSearch(e.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
    <p role="status" className="text-xs text-muted-foreground">{shown.length} de {entries.length} profissionais</p>
    <div aria-label="Lista de profissionais" className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">{shown.map(entry => <div className="min-w-0" key={entry.id}>{entry.content}</div>)}</div>
    {shown.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Nenhum profissional encontrado.</p>}
  </div>;
}
