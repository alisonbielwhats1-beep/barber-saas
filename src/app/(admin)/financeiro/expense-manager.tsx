"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Check, Clock, Trash2, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { formatMoney } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { createExpense, toggleExpensePaid, deleteExpense } from "./actions";

export type ExpenseRow = {
  id: string;
  description: string;
  category: string;
  kind: "FIXED" | "VARIABLE";
  amountCents: number;
  dueDate: string;
  paidAt: string | null;
};

const CATEGORIES = ["Aluguel", "Energia", "Água", "Produtos", "Marketing", "Software", "Salários", "Impostos", "Manutenção", "Outros"];

export function ExpenseManager({ expenses }: { expenses: ExpenseRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function act(fn: () => Promise<void>) {
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro");
      }
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    const reais = parseFloat(String(f.get("amount")).replace(",", "."));
    if (!reais || reais <= 0) return setError("Valor inválido");
    const payload = {
      description: String(f.get("description")),
      amountCents: Math.round(reais * 100),
      category: String(f.get("category")),
      kind: String(f.get("kind")) as "FIXED" | "VARIABLE",
      method: null,
      dueDate: String(f.get("dueDate")),
      paid: f.get("paid") === "on",
    };
    startTransition(async () => {
      try {
        await createExpense(payload);
        setOpen(false);
        toast("Despesa adicionada", "success");
        router.refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro ao salvar";
        setError(msg);
        toast(msg, "error");
      }
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between p-5 pb-3">
        <h3 className="text-[13px] font-semibold">Despesas do período</h3>
        <button
          onClick={() => { setError(null); setOpen(true); }}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground transition hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar
        </button>
      </div>

      {expenses.length === 0 ? (
        <p className="px-5 pb-6 text-[13px] text-muted-foreground">
          Nenhuma despesa neste período. Adicione a primeira.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {expenses.map((e) => {
            const paid = !!e.paidAt;
            return (
              <div key={e.id} className="flex items-center gap-3 px-5 py-3">
                <button
                  onClick={() => act(() => toggleExpensePaid(e.id))}
                  disabled={pending}
                  title={paid ? "Marcar como pendente" : "Marcar como paga"}
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border transition ${
                    paid
                      ? "border-transparent bg-success/15 text-success"
                      : "border-border text-muted-foreground hover:text-warning"
                  }`}
                >
                  {paid ? <Check className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{e.description}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {e.category} · {e.kind === "FIXED" ? "Fixa" : "Variável"} · vence{" "}
                    {format(new Date(e.dueDate), "d MMM", { locale: ptBR })}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    paid ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
                  }`}
                >
                  {paid ? "Paga" : "Pendente"}
                </span>
                <p className="w-24 shrink-0 text-right text-[13px] font-semibold">
                  {formatMoney(e.amountCents)}
                </p>
                <button
                  onClick={() => act(() => deleteExpense(e.id))}
                  disabled={pending}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:text-danger"
                  title="Excluir"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {pending && (
        <div className="flex items-center gap-2 border-t border-border px-5 py-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Atualizando…
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova despesa</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="grid gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Descrição</label>
              <Input name="description" required placeholder="Ex.: Aluguel do ponto" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Valor (R$)</label>
                <Input name="amount" required inputMode="decimal" placeholder="0,00" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Vencimento</label>
                <Input name="dueDate" type="date" required defaultValue={format(new Date(), "yyyy-MM-dd")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Categoria</label>
                <select name="category" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Tipo</label>
                <select name="kind" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="VARIABLE">Variável</option>
                  <option value="FIXED">Fixa</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="paid" className="h-4 w-4 rounded border-border" />
              Já está paga
            </label>
            {error && (
              <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" type="button">Cancelar</Button>
              </DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? "Salvando…" : "Adicionar despesa"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
