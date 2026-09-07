"use client";
import { useState, useTransition } from "react";
import { previewSeriesEdit, applySeriesEdit } from "./series-actions";

export function SeriesEditor({ appointmentId }: { appointmentId: string }) {
  const [pending, transition] = useTransition();
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<(Awaited<ReturnType<typeof previewSeriesEdit>>[number] & { requestId: string })[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<Awaited<ReturnType<typeof applySeriesEdit>>>([]);
  return <details className="rounded-xl border border-border p-3"><summary className="min-h-11 cursor-pointer text-sm font-semibold">Editar esta e as próximas ocorrências</summary><form className="space-y-3" onChange={() => { setPreview(null); setResults([]); }} onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); setError(""); transition(async () => { try { const items = await previewSeriesEdit({ appointmentId, shiftDays: Number(form.get("shift")), time: String(form.get("time")), reason }); setPreview(items.map(item => ({ ...item, requestId: crypto.randomUUID() }))); setSelected(items.filter(i => !i.conflict).map(i => i.id)); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível revisar."); } }); }}>
    <p className="text-xs text-muted-foreground">Somente ocorrências futuras. Clientes com conta recebem uma proposta para aceitar; conflitos permanecem no horário original.</p>
    <label className="block text-sm">Deslocar datas em dias<input name="shift" type="number" min={-365} max={365} defaultValue={0} required className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3" /></label>
    <label className="block text-sm">Novo horário<input name="time" type="time" required className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3" /></label>
    <label className="block text-sm">Motivo<input value={reason} onChange={e => setReason(e.target.value)} required minLength={3} maxLength={200} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3" /></label>
    <button disabled={pending} className="min-h-11 rounded-lg border border-border px-3 text-sm">Revisar ocorrências</button>
  </form>
  {preview && <div className="mt-3 space-y-2"><p className="text-sm">{preview.length} ocorrência(s) futura(s)</p>{preview.map(i => <label key={i.id} className="flex min-h-11 items-start gap-2 text-xs"><input type="checkbox" disabled={!!i.conflict || pending || results.some(r => r.id === i.id && r.success)} checked={selected.includes(i.id)} onChange={e => setSelected(e.target.checked ? [...selected, i.id] : selected.filter(id => id !== i.id))} /><span>{i.before.replace("T", " ")} → {i.startLocal.replace("T", " ")}<br />{i.conflict ?? i.name}</span></label>)}<button disabled={pending || !selected.length} className="min-h-11 rounded-lg bg-[var(--action-positive)] px-3 text-sm text-white disabled:opacity-50" onClick={() => transition(async () => { try { const result = await applySeriesEdit({ reason, items: preview.filter(i => selected.includes(i.id)) }); setResults(result); setSelected([]); } catch { setError("Não foi possível concluir. Revise antes de tentar novamente."); } })}>Aplicar em {selected.length} selecionada(s)</button></div>}
  {results.map(r => <p key={r.id} role="status" className="mt-2 text-xs">{preview?.find(i => i.id === r.id)?.before.replace("T", " ")}: {r.message}</p>)}{error && <p role="alert" className="text-sm text-danger">{error}</p>}</details>;
}
