"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, Loader2, Percent, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  deletePricingRule,
  savePricingRule,
  togglePricingRule,
  type PricingRuleInput,
} from "./actions";

const WEEKDAYS = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
] as const;

type Rule = {
  id: string;
  targetType: "WEEKDAY" | "DATE";
  weekday: number | null;
  date: string | null;
  label: string;
  adjustmentType: "PERCENTAGE" | "FIXED_CENTS";
  adjustmentValue: number;
  active: boolean;
};

export function PricingRulesManager({ rules, canManage }: { rules: Rule[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetType, setTargetType] = useState<"WEEKDAY" | "DATE">("WEEKDAY");
  const [weekday, setWeekday] = useState("0");
  const [date, setDate] = useState("");
  const [label, setLabel] = useState("Preço especial");
  const [adjustmentType, setAdjustmentType] = useState<"PERCENTAGE" | "FIXED_CENTS">("PERCENTAGE");
  const [adjustmentValue, setAdjustmentValue] = useState("20");

  function run(action: () => Promise<void>, successMessage: string) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
        toast(successMessage, "success");
        router.refresh();
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Não foi possível salvar";
        setError(message);
        toast(message, "error");
      }
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: PricingRuleInput = {
      targetType,
      weekday: targetType === "WEEKDAY" ? Number(weekday) : null,
      date: targetType === "DATE" ? date : null,
      label,
      adjustmentType,
      adjustmentValue: adjustmentType === "PERCENTAGE"
        ? Number(adjustmentValue)
        : Math.round(Number(adjustmentValue.replace(",", ".")) * 100),
    };
    run(async () => {
      await savePricingRule(input);
      setOpen(false);
    }, "Regra de preço salva");
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-warning/10 text-warning">
            <Percent aria-hidden="true" className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-[13px] font-semibold">Preços especiais</h3>
            <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-muted-foreground">
              Aumente o valor dos serviços em domingos, feriados ou datas de alta procura. A regra da data exata substitui a regra do dia da semana.
            </p>
          </div>
        </div>
        {canManage && (
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen((value) => !value)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Nova regra
          </Button>
        )}
      </div>

      {open && canManage && (
        <form onSubmit={submit} className="mt-4 grid gap-3 rounded-xl border border-border bg-surface-1 p-4 sm:grid-cols-2">
          <div>
            <label htmlFor="pricing-target-type" className="mb-1 block text-[12px] font-medium">Aplicar em</label>
            <select
              id="pricing-target-type"
              value={targetType}
              onChange={(event) => setTargetType(event.target.value as "WEEKDAY" | "DATE")}
              className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="WEEKDAY">Dia da semana</option>
              <option value="DATE">Data específica / feriado</option>
            </select>
          </div>
          {targetType === "WEEKDAY" ? (
            <div>
              <label htmlFor="pricing-weekday" className="mb-1 block text-[12px] font-medium">Dia</label>
              <select
                id="pricing-weekday"
                value={weekday}
                onChange={(event) => setWeekday(event.target.value)}
                className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {WEEKDAYS.map((name, index) => <option key={name} value={index}>{name}</option>)}
              </select>
            </div>
          ) : (
            <div>
              <label htmlFor="pricing-date" className="mb-1 block text-[12px] font-medium">Data</label>
              <Input id="pricing-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
            </div>
          )}
          <div>
            <label htmlFor="pricing-label" className="mb-1 block text-[12px] font-medium">Nome da regra</label>
            <Input id="pricing-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Ex.: Domingo premium" maxLength={80} required />
          </div>
          <div>
            <label htmlFor="pricing-adjustment-type" className="mb-1 block text-[12px] font-medium">Acréscimo</label>
            <div className="flex gap-2">
              <select
                id="pricing-adjustment-type"
                value={adjustmentType}
                onChange={(event) => setAdjustmentType(event.target.value as "PERCENTAGE" | "FIXED_CENTS")}
                className="min-h-11 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="PERCENTAGE">Percentual</option>
                <option value="FIXED_CENTS">Valor fixo por serviço</option>
              </select>
              <Input
                type="number"
                min={0}
                max={adjustmentType === "PERCENTAGE" ? 100 : 1000}
                step={adjustmentType === "PERCENTAGE" ? 1 : 0.01}
                value={adjustmentValue}
                onChange={(event) => setAdjustmentValue(event.target.value)}
                aria-label={adjustmentType === "PERCENTAGE" ? "Percentual do acréscimo" : "Valor fixo do acréscimo"}
                required
              />
              <span className="flex min-h-11 items-center text-sm text-muted-foreground">
                {adjustmentType === "PERCENTAGE" ? "%" : "R$"}
              </span>
            </div>
          </div>
          {error && <p className="text-[12px] text-destructive sm:col-span-2">{error}</p>}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Salvar regra
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          </div>
        </form>
      )}

      {rules.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-border p-4 text-[12px] text-muted-foreground">
          Nenhuma regra cadastrada. Sem regra, todos os serviços continuam com o preço normal.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rules.map((rule) => {
            const target = rule.targetType === "WEEKDAY"
              ? WEEKDAYS[rule.weekday ?? 0]
              : rule.date ? new Date(`${rule.date.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "Data específica";
            const value = rule.adjustmentType === "PERCENTAGE"
              ? `+${rule.adjustmentValue}%`
              : `+R$ ${(rule.adjustmentValue / 100).toFixed(2).replace(".", ",")}`;
            return (
              <li key={rule.id} className={`flex flex-col gap-3 rounded-xl border px-3 py-3 sm:flex-row sm:items-center sm:justify-between ${rule.active ? "border-border bg-surface-1" : "border-border/60 bg-muted/20 opacity-60"}`}>
                <div className="flex min-w-0 items-start gap-3">
                  <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{rule.label} <span className="font-semibold text-primary">{value}</span></p>
                    <p className="text-[11px] text-muted-foreground">{target} · {rule.active ? "Ativa" : "Desativada"}</p>
                  </div>
                </div>
                {canManage && (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => togglePricingRule(rule.id, !rule.active), rule.active ? "Regra desativada" : "Regra ativada")}
                      className="min-h-11 rounded-lg px-3 text-[11px] font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
                    >
                      {rule.active ? "Desativar" : "Ativar"}
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        if (window.confirm("Remover esta regra de preço?")) {
                          run(() => deletePricingRule(rule.id), "Regra removida");
                        }
                      }}
                      aria-label={`Remover regra ${rule.label}`}
                      className="grid min-h-11 min-w-11 place-items-center rounded-lg text-muted-foreground hover:bg-danger/10 hover:text-danger disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
