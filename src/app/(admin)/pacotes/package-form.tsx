"use client";
import { toast } from "@/components/ui/toast";
import { useFormOperation } from "../use-form-operation";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "../form-dialog";
import { createPackage, updatePackage } from "./actions";

export type PackageEditable = {
  id: string;
  name: string;
  description: string | null;
  serviceId: string | null;
  sessions: number;
  priceCents: number;
  validityDays: number;
};

export function PackageForm({
  services,
  pkg,
  trigger,
}: {
  services: { id: string; name: string }[];
  pkg?: PackageEditable;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const editing = !!pkg;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useFormOperation();
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setError(null);
    const f = new FormData(e.currentTarget);
    const payload = {
      name: String(f.get("name")),
      description: (f.get("description") as string) || null,
      serviceId: (f.get("serviceId") as string) || null,
      sessions: Number(f.get("sessions")),
      priceCents: Math.round(Number(f.get("price")) * 100),
      validityDays: Number(f.get("validityDays")),
    };
    startTransition(async () => {
      try {
        if (editing) await updatePackage(pkg!.id, payload);
        else await createPackage(payload);
        toast("Cadastro salvo", "success");
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao salvar");
      } finally { submitting.current = false; }
    });
  }

  return (
    <Dialog pending={pending} open={open} onOpenChange={next => { setOpen(next); if (next) setError(null); }}>
      <DialogTrigger asChild>
        {trigger ?? (editing ? <Button variant="ghost" size="sm">Editar</Button> : <Button><Plus className="h-4 w-4" /> Novo pacote</Button>)}
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar pacote" : "Novo pacote"}</DialogTitle>
          <DialogDescription>Um pacote agrupa várias sessões com preço promocional.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div>
            <label htmlFor="package-form-name" className="mb-1 block text-sm font-medium">Nome</label>
            <Input id="package-form-name" name="name" defaultValue={pkg?.name} required autoFocus placeholder="Ex.: Pacote 5x Corte" />
          </div>
          <div>
            <label htmlFor="package-form-description" className="mb-1 block text-sm font-medium">Descrição</label>
            <Input id="package-form-description" name="description" defaultValue={pkg?.description ?? ""} />
          </div>
          <div>
            <label htmlFor="package-form-serviceId" className="mb-1 block text-sm font-medium">Serviço (opcional)</label>
            <select id="package-form-serviceId" name="serviceId" defaultValue={pkg?.serviceId ?? ""} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Genérico (qualquer serviço)</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="package-form-sessions" className="mb-1 block text-sm font-medium">Sessões</label>
              <Input id="package-form-sessions" name="sessions" type="number" min={1} defaultValue={pkg?.sessions ?? 5} required />
            </div>
            <div>
              <label htmlFor="package-form-price" className="mb-1 block text-sm font-medium">Preço (R$)</label>
              <Input id="package-form-price" name="price" type="number" min={0} step="0.01" defaultValue={pkg ? (pkg.priceCents / 100).toFixed(2) : ""} required />
            </div>
            <div>
              <label htmlFor="package-form-validityDays" className="mb-1 block text-sm font-medium">Validade (dias)</label>
              <Input id="package-form-validityDays" name="validityDays" type="number" min={1} defaultValue={pkg?.validityDays ?? 120} required />
            </div>
          </div>
          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" type="button">Cancelar</Button></DialogClose>
            <Button type="submit" disabled={pending}>{pending ? "Salvando…" : editing ? "Salvar" : "Criar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
