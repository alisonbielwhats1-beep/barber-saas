"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { createPlan, updatePlan } from "./actions";

export type PlanEditable = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  interval: "MONTHLY" | "ANNUAL";
  discountPct: number;
  benefits: string | null;
};

export function PlanForm({ plan, trigger }: { plan?: PlanEditable; trigger?: React.ReactNode }) {
  const router = useRouter();
  const editing = !!plan;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    const payload = {
      name: String(f.get("name")),
      description: (f.get("description") as string) || null,
      priceCents: Math.round(Number(f.get("price")) * 100),
      interval: String(f.get("interval")) as "MONTHLY" | "ANNUAL",
      discountPct: Number(f.get("discountPct") || 0),
      benefits: (f.get("benefits") as string) || null,
    };
    startTransition(async () => {
      try {
        if (editing) await updatePlan(plan!.id, payload);
        else await createPlan(payload);
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao salvar");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (editing ? <Button variant="ghost" size="sm">Editar</Button> : <Button><Plus className="h-4 w-4" /> Novo plano</Button>)}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar plano" : "Novo plano"}</DialogTitle>
          <DialogDescription>Assinatura recorrente com benefícios para o cliente.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Nome</label>
            <Input name="name" defaultValue={plan?.name} required autoFocus placeholder="Ex.: Clube VIP Mensal" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Descrição</label>
            <Input name="description" defaultValue={plan?.description ?? ""} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Preço (R$)</label>
              <Input name="price" type="number" min={0} step="0.01" defaultValue={plan ? (plan.priceCents / 100).toFixed(2) : ""} required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Cobrança</label>
              <select name="interval" defaultValue={plan?.interval ?? "MONTHLY"} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="MONTHLY">Mensal</option>
                <option value="ANNUAL">Anual</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Desconto (%)</label>
              <Input name="discountPct" type="number" min={0} max={100} defaultValue={plan?.discountPct ?? 0} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Benefícios</label>
            <Input name="benefits" defaultValue={plan?.benefits ?? ""} placeholder="Cortes ilimitados; 10% off produtos…" />
          </div>
          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" type="button">Cancelar</Button></DialogClose>
            <Button type="submit" disabled={pending}>{pending ? "Salvando…" : editing ? "Salvar" : "Criar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
