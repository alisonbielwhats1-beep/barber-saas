"use client";
import { useFormOperation } from "../use-form-operation";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "../form-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Plus, Check, Clock, X, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { formatMoney } from "@/lib/utils";
import { formatInTimeZone } from "date-fns-tz";
import { ptBR } from "date-fns/locale";
import { createExpense, toggleExpensePaid, deleteExpense } from "./actions";
import { formatMoneyWhole } from "../dashboard/results-ui";
import { SelectSheet } from "@/components/ui/select-sheet";

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

export function ExpenseManager({ expenses, timezone }: { expenses: ExpenseRow[]; timezone: string }) {
  const router = useRouter();
  const [pending, startTransition] = useFormOperation();
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

  const pendingCount = expenses.filter((e) => !e.paidAt).length;
  const total = expenses.reduce((sum, e) => sum + e.amountCents, 0);

  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 p-4 sm:p-5">
        <div className="min-w-0 flex-[1_1_170px]">
          <h3 className="text-sm font-semibold leading-snug">Despesas do período</h3>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
            {expenses.length ? (
              <>
                <span className="whitespace-nowrap">{expenses.length}{" "}{expenses.length === 1 ? "despesa" : "despesas"}</span>
                {" · "}<span className="whitespace-nowrap tabular-nums">{formatMoneyWhole(total)}</span>
                {pendingCount ? <>{" · "}<span className="whitespace-nowrap">{pendingCount}{" "}pendente(s)</span></> : null}
              </>
            ) : "Por vencimento"}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => { setError(null); setOpen(true); }}
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Adicionar
        </Button>
      </div>

      {expenses.length === 0 ? (
        <p className="px-4 pb-5 text-sm text-muted-foreground sm:px-5">
          Nenhuma despesa neste período. Adicione a primeira.
        </p>
      ) : (
        <div className="divide-y divide-border border-t border-border">
          {expenses.map((e) => {
            const paid = !!e.paidAt;
            return (
              <div key={e.id} className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-start gap-x-3 gap-y-1.5 px-4 py-2.5 sm:grid-cols-[44px_minmax(0,1fr)_auto_44px] sm:items-center sm:px-5">
                <IconButton
                  label={paid ? `Marcar ${e.description} como pendente` : `Marcar ${e.description} como paga`}
                  onClick={() => act(() => toggleExpensePaid(e.id))}
                  disabled={pending}
                  className={`h-11 w-11 shrink-0 rounded-full border lg:h-11 lg:w-11 lg:rounded-full ${
                    paid
                      ? "border-transparent bg-[hsl(var(--selection))] text-[hsl(var(--selection-foreground))]"
                      : "border-border-strong text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {paid ? <Check aria-hidden="true" className="h-4 w-4" /> : <Clock aria-hidden="true" className="h-4 w-4" />}
                </IconButton>
                <div className="min-w-0 sm:py-1">
                  <p className="break-words text-sm font-medium leading-snug">{e.description}</p>
                  <p className="text-sm leading-snug text-muted-foreground">
                    {e.category} · {e.kind === "FIXED" ? "Fixa" : "Variável"} · vence{" "}
                    {formatInTimeZone(new Date(e.dueDate), "UTC", "d MMM", { locale: ptBR })}
                  </p>
                </div>
                <div className="col-start-2 row-start-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 sm:col-start-3 sm:row-start-1 sm:justify-end">
                  <span
                    className={`inline-flex min-h-[22px] items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ${
                      paid ? "bg-muted text-foreground" : "bg-warning/15 text-warning"
                    }`}
                  >
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                    {paid ? "Paga" : "Pendente"}
                  </span>
                  <p className="order-first whitespace-nowrap text-sm font-semibold tabular-nums sm:order-none sm:min-w-[92px] sm:text-right">
                    {formatMoney(e.amountCents)}
                  </p>
                </div>
                <IconButton
                  label={`Excluir despesa ${e.description}`}
                  onClick={() => act(() => deleteExpense(e.id))}
                  disabled={pending}
                  className="col-start-3 row-start-1 h-11 w-11 shrink-0 rounded-full hover:bg-danger/10 hover:text-danger sm:col-start-4 lg:h-11 lg:w-11 lg:rounded-full"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </IconButton>
              </div>
            );
          })}
        </div>
      )}

      {pending && (
        <div role="status" className="flex items-center gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground sm:px-5">
          <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" /> Atualizando…
        </div>
      )}

      <Dialog pending={pending} open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova despesa</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="grid gap-4">
            <div>
              <label htmlFor="expense-description" className="mb-1 block text-sm font-medium">Descrição</label>
              <Input id="expense-description" name="description" required placeholder="Ex.: Aluguel do ponto" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="expense-amount" className="mb-1 block text-sm font-medium">Valor (R$)</label>
                <Input id="expense-amount" name="amount" required inputMode="decimal" placeholder="0,00" />
              </div>
              <div>
                <label htmlFor="expense-dueDate" className="mb-1 block text-sm font-medium">Vencimento</label>
                <Input id="expense-dueDate" name="dueDate" type="date" required defaultValue={formatInTimeZone(new Date(), timezone, "yyyy-MM-dd")} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="expense-category" className="mb-1 block text-sm font-medium">Categoria</label>
                <SelectSheet id="expense-category" name="category" title="Categoria" options={CATEGORIES.map((c) => ({ value: c, label: c }))}
                  className="flex min-h-11 w-full rounded-[10px] border border-border-strong bg-background px-3 text-base lg:min-h-10 lg:text-sm" />
              </div>
              <div>
                <label htmlFor="expense-kind" className="mb-1 block text-sm font-medium">Tipo</label>
                <SelectSheet id="expense-kind" name="kind" title="Tipo" options={[{ value: "VARIABLE", label: "Variável" }, { value: "FIXED", label: "Fixa" }]}
                  className="flex min-h-11 w-full rounded-[10px] border border-border-strong bg-background px-3 text-base lg:min-h-10 lg:text-sm" />
              </div>
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="paid" className="h-5 w-5 rounded border-border accent-[hsl(var(--selection-solid))]" />
              Já está paga
            </label>
            {error && (
              <p role="alert" className="rounded-[10px] border border-danger/35 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
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
