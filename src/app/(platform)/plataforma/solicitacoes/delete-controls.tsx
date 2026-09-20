"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { archiveSalon, deleteEmptySalon, inspectEmptySalon } from "../actions";

export function DeleteSalonControl({ salonId, salonName, archived = false }: { salonId: string; salonName: string; archived?: boolean }) {
  const [open, setOpen] = useState(false);
  const [inspection, setInspection] = useState<Awaited<ReturnType<typeof inspectEmptySalon>> | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  async function inspect() {
    setOpen(true); setBusy(true); setInspection(null); setError(null); setConfirmation("");
    try { setInspection(await inspectEmptySalon(salonId)); }
    catch { setError("Não foi possível verificar os vínculos. A exclusão permanece bloqueada."); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (busy || !inspection?.eligible || confirmation !== inspection.salon.slug) return;
    setBusy(true); setError(null);
    try { await deleteEmptySalon(salonId, confirmation); setOpen(false); }
    catch { setError("Não foi possível excluir. O cadastro pode ter recebido novos dados. Feche e confira novamente; clientes e históricos são protegidos."); setInspection(null); }
    finally { setBusy(false); }
  }
  return <>
    <Button size="sm" variant="outline" disabled={busy} onClick={() => { setError(null); setArchiveOpen(true); }}>{archived ? "Restaurar à lista" : "Mover para histórico"}</Button>
    <Button size="sm" variant="outline" disabled={busy} onClick={() => void inspect()}>Excluir cadastro vazio</Button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><DialogContent>
      <DialogTitle>Excluir {salonName}?</DialogTitle>
      <DialogDescription>A exclusão é definitiva e só está disponível para cadastros suspensos ou recusados, sem clientes, histórico ou outros vínculos. Contas de usuários não serão apagadas.</DialogDescription>
      {busy && <p role="status">Verificando e processando…</p>}
      {error && <p role="alert">{error}</p>}
      {inspection && !inspection.eligible && <p role="status">Exclusão bloqueada. {inspection.blockers.length ? "Este estabelecimento possui dados vinculados. Preserve o cadastro e use a suspensão, se necessário." : "Este estabelecimento ainda está ativo ou pendente. Confira se é realmente um cadastro de teste antes de suspender."}</p>}
      {inspection?.eligible && <><p className="text-sm">Nenhum cliente, atendimento, cobrança ou vínculo operacional foi encontrado. O cadastro e seus horários de configuração serão removidos; o registro administrativo da exclusão será preservado.</p><label htmlFor={`delete-${salonId}`} className="text-sm">Digite {inspection.salon.slug} para confirmar</label><Input id={`delete-${salonId}`} autoComplete="off" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} /><Button variant="destructive" disabled={busy || confirmation !== inspection.salon.slug} onClick={() => void remove()}>Excluir definitivamente</Button></>}
      <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Voltar sem excluir</Button>
    </DialogContent></Dialog>
    <Dialog open={archiveOpen} onOpenChange={value => { if (!busy) setArchiveOpen(value); }}><DialogContent>
      <DialogTitle>{archived ? "Restaurar à lista" : "Mover para histórico"}: {salonName}</DialogTitle>
      <DialogDescription>{archived ? "O estabelecimento volta à lista principal. Isso não reativa o acesso suspenso." : "O estabelecimento sai da lista principal e continua disponível na aba Histórico. Clientes, atendimentos e dados serão preservados. Esta ação não cancela assinaturas nem cobranças. É necessário suspender o acesso antes de arquivar."}</DialogDescription>
      {error && <p role="alert">{error}</p>}
      <Button disabled={busy} onClick={async () => { setBusy(true); setError(null); try { await archiveSalon(salonId, !archived); setArchiveOpen(false); } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível atualizar."); } finally { setBusy(false); } }}>Confirmar {archived ? "restauração" : "envio para histórico"}</Button>
      <Button variant="outline" disabled={busy} onClick={() => setArchiveOpen(false)}>Voltar</Button>
    </DialogContent></Dialog>
  </>;
}
