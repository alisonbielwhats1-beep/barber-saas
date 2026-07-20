"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createAppointmentManually } from "./actions";
import { formatMoney, formatDuration } from "@/lib/utils";

export type ProOption = {
  id: string;
  name: string;
  serviceIds: string[];
};
export type ServiceOption = {
  id: string;
  name: string;
  durationMin: number;
  priceCents: number;
};
export type ClientOption = { id: string; name: string; phone: string | null };

export function AppointmentDialog({
  open,
  onOpenChange,
  slotStartISO,
  professionalId,
  professionals,
  services,
  clients,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slotStartISO: string;
  professionalId: string;
  professionals: ProOption[];
  services: ServiceOption[];
  clients: ClientOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedProId, setSelectedProId] = useState(professionalId);
  const [mode, setMode] = useState<"existing" | "new">("existing");

  const proNow = professionals.find((p) => p.id === selectedProId);
  const availableServices = services.filter((s) =>
    proNow?.serviceIds.includes(s.id),
  );

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);

    const payload =
      mode === "existing"
        ? {
            professionalId: selectedProId,
            serviceId: String(form.get("serviceId")),
            clientId: String(form.get("clientId")),
            startAt: slotStartISO,
            notes: (form.get("notes") as string) || null,
          }
        : {
            professionalId: selectedProId,
            serviceId: String(form.get("serviceId")),
            clientName: String(form.get("clientName")),
            clientPhone: (form.get("clientPhone") as string) || null,
            startAt: slotStartISO,
            notes: (form.get("notes") as string) || null,
          };

    startTransition(async () => {
      try {
        await createAppointmentManually(payload);
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao salvar");
      }
    });
  }

  const startLabel = new Date(slotStartISO).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo agendamento</DialogTitle>
          <DialogDescription>Início: {startLabel}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Profissional</label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={selectedProId}
              onChange={(e) => setSelectedProId(e.target.value)}
            >
              {professionals.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Serviço</label>
            <select
              name="serviceId"
              required
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Selecione…</option>
              {availableServices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {formatDuration(s.durationMin)} · {formatMoney(s.priceCents)}
                </option>
              ))}
            </select>
            {availableServices.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Este profissional não realiza nenhum serviço ainda. Vincule em Profissionais → Editar.
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => setMode("existing")}
              className={`rounded-md px-3 py-1 ${mode === "existing" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
            >
              Cliente existente
            </button>
            <button
              type="button"
              onClick={() => setMode("new")}
              className={`rounded-md px-3 py-1 ${mode === "new" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
            >
              Novo cliente
            </button>
          </div>

          {mode === "existing" ? (
            <div>
              <label className="mb-1 block text-sm font-medium">Cliente</label>
              <select
                name="clientId"
                required
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Selecione…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.phone ? ` — ${c.phone}` : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Nome</label>
                <Input name="clientName" required />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">WhatsApp</label>
                <Input name="clientPhone" placeholder="(11) 91234-5678" />
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium">Observações</label>
            <Input name="notes" placeholder="Ex.: cliente pediu franja curta" />
          </div>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" type="button">Cancelar</Button>
            </DialogClose>
            <Button type="submit" disabled={pending || availableServices.length === 0}>
              {pending ? "Agendando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
