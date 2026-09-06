"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { addOpening, removeOpening } from "./opening-actions";

export type Opening = { id: string; professionalId: string; dateKey: string; startMinutes: number; endMinutes: number; reason: string };
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export function OpeningPanel({ date, timezone, professionals, openings }: {
  date: string; timezone: string; professionals: { id: string; name: string }[]; openings: Opening[];
}) {
  const router = useRouter();
  const professionalFieldId = useId();
  const [open, setOpen] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const field = "mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm";
  return <section aria-label="Expediente extra" className="mb-3 rounded-xl border border-border bg-card px-3 py-2">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">Expediente extra por data</p><button type="button" onClick={() => { setRequestId(crypto.randomUUID()); setError(""); setOpen(true); }} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm"><CalendarPlus size={16} /> Liberar expediente extra</button></div>
    {openings.length > 0 && <details><summary className="min-h-11 cursor-pointer content-center text-xs">Ver {openings.length} abertura(s) extra(s) no período</summary><ul className="divide-y divide-border">{openings.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs"><span><strong>{professionals.find(p => p.id === item.professionalId)?.name}</strong> · {item.dateKey.split("-").reverse().join("/")} · {hhmm(item.startMinutes)}–{hhmm(item.endMinutes)} · {item.reason}</span><button type="button" disabled={pending} className="min-h-11 px-3 underline" onClick={() => {
      if (!window.confirm("Remover este expediente extra? As reservas existentes serão mantidas e precisarão de revisão na agenda.")) return;
      startTransition(async () => { try { await removeOpening(item.id); router.refresh(); } catch { setError("Não foi possível remover o expediente extra."); } });
    }}>Remover expediente extra</button></li>)}</ul></details>}
    {error && !open && <p role="alert" className="text-sm text-danger">{error}</p>}
    <Dialog open={open} onOpenChange={value => { if (!pending) setOpen(value); }}><DialogContent><DialogHeader><DialogTitle>Liberar expediente extra</DialogTitle></DialogHeader>
      <form className="space-y-4" onSubmit={event => {
        event.preventDefault(); setError("");
        const form = new FormData(event.currentTarget);
        const minutes = (name: string) => { const parts = String(form.get(name)).split(":").map(Number); return parts[0]! * 60 + parts[1]!; };
        const input = { id: requestId, professionalId: String(form.get("professionalId")), dateKey: String(form.get("dateKey")), startMinutes: minutes("start"), endMinutes: minutes("end"), reason: String(form.get("reason")) };
        startTransition(async () => { try {
          const result = await addOpening(input);
          if (result.error) setError(result.error);
          else { setOpen(false); router.refresh(); }
        } catch { setError("Não foi possível liberar o expediente. Tente novamente."); } });
      }}><fieldset disabled={pending} className="space-y-3">
        <div><label htmlFor={professionalFieldId} className="block text-sm">Profissional</label><select id={professionalFieldId} required name="professionalId" className={field}>{professionals.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></div>
        <label className="block text-sm">Data<input required type="date" name="dateKey" defaultValue={date} className={field} /></label>
        <div className="grid grid-cols-2 gap-3"><label className="text-sm">Das<input required type="time" name="start" defaultValue="18:00" className={field} /></label><label className="text-sm">Até<input required type="time" name="end" defaultValue="20:00" className={field} /></label></div>
        <label className="block text-sm">Motivo<input required minLength={3} maxLength={200} name="reason" placeholder="Ex.: atendimento especial de sábado" className={field} /></label>
      </fieldset><p className="text-xs text-muted-foreground">Fuso {timezone}. Amplia o expediente apenas nesta data. Bloqueios e fechamentos continuam valendo; remova-os separadamente se desejar reabrir esses períodos.</p>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button disabled={pending || !professionals.length} className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">{pending ? "Salvando…" : "Salvar expediente extra"}</button>
      </form>
    </DialogContent></Dialog>
  </section>;
}
