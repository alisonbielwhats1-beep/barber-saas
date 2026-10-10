"use client";
import { useState, useTransition } from "react";
import { ChevronDown, DoorOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createResource, listResources, setResourceActive } from "./resource-actions";

export function ResourcePanel() {
  const [items, setItems] = useState<Awaited<ReturnType<typeof listResources>>>([]);
  const [loaded, setLoaded] = useState(false);
  const [pending, transition] = useTransition(); const [error, setError] = useState("");
  const run = (fn: () => Promise<unknown>) => transition(async () => { setError(""); try { await fn(); setItems(await listResources()); setLoaded(true); } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível salvar."); } });
  const activeCount = items.filter(i => i.active).length;
  return (
    <details className="group overflow-hidden rounded-[14px] border border-border bg-card" onToggle={e => { if (e.currentTarget.open) run(async () => {}); }}>
      <summary className="flex min-h-[52px] cursor-pointer list-none items-center gap-3 px-3.5 py-2 transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] bg-muted text-foreground"><DoorOpen className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Salas e equipamentos</span>
          {loaded && <span className="mt-0.5 block text-sm text-muted-foreground">{activeCount} {activeCount === 1 ? "ativo" : "ativos"} de {items.length}</span>}
        </span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-3 border-t border-border p-4">
        <p className="text-xs text-muted-foreground">Cadastre cada unidade física e vincule ao serviço. Duas reservas não podem ocupar o mesmo recurso ao mesmo tempo.</p>
        <form className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end" onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); run(() => createResource({ name: String(form.get("resourceName")), kind: String(form.get("kind")) })); }}>
          <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium text-muted-foreground">Nome
            <Input required name="resourceName" minLength={2} maxLength={100} placeholder="Ex.: Sala 1, laser 1" className="text-foreground" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-foreground">Tipo
            <select name="kind" className="min-h-11 rounded-[10px] border border-border-strong bg-background px-3 text-base text-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 lg:min-h-10 lg:text-sm">
              <option value="ROOM">Sala</option><option value="EQUIPMENT">Equipamento</option>
            </select>
          </label>
          <Button type="submit" variant="outline" disabled={pending} className="lg:min-h-10">Adicionar recurso</Button>
        </form>
        {items.length > 0 && (
          <ul className="divide-y divide-border border-t border-border">
            {items.map(i => (
              <li key={i.id} className="flex min-h-[52px] items-center justify-between gap-3 text-sm">
                <span className={`min-w-0 break-words ${i.active ? "" : "text-muted-foreground"}`}>{i.name} · {i.kind === "ROOM" ? "Sala" : "Equipamento"} · {i.active ? "Ativo" : "Inativo"}</span>
                <Button type="button" variant="ghost" size="sm" disabled={pending} className="shrink-0" onClick={() => run(() => setResourceActive(i.id, !i.active))}>{i.active ? "Desativar" : "Reativar"}</Button>
              </li>
            ))}
          </ul>
        )}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </details>
  );
}
