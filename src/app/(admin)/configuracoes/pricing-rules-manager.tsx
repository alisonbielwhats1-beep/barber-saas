"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, Loader2, Percent, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  deletePricingRule,
  savePricingRule,
  togglePricingRule,
  type PricingRuleInput,
} from "./actions";
import { labelClass, selectClass, SettingsBlock, subPanelClass } from "./settings-ui";

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
    <SettingsBlock
      hint="Aumente o valor dos serviços em domingos, feriados ou datas de alta procura. A regra da data exata substitui a regra do dia da semana."
      action={canManage && (
        <Button type="button" size="sm" variant="outline" aria-expanded={open} className="max-lg:w-full" onClick={() => setOpen((value) => !value)}>
          <Plus aria-hidden="true" className="h-4 w-4" />
          Nova regra
        </Button>
      )}
    >
      <h3 className="sr-only">Preços especiais</h3>
      {open && canManage && (
        <form onSubmit={submit} className={cn(subPanelClass, "grid gap-3.5 sm:grid-cols-2 sm:gap-4")}>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="pricing-target-type" className={labelClass}>Aplicar em</label>
            <select
              id="pricing-target-type"
              value={targetType}
              onChange={(event) => setTargetType(event.target.value as "WEEKDAY" | "DATE")}
              className={selectClass}
            >
              <option value="WEEKDAY">Dia da semana</option>
              <option value="DATE">Data específica / feriado</option>
            </select>
          </div>
          {targetType === "WEEKDAY" ? (
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor="pricing-weekday" className={labelClass}>Dia</label>
              <select
                id="pricing-weekday"
                value={weekday}
                onChange={(event) => setWeekday(event.target.value)}
                className={selectClass}
              >
                {WEEKDAYS.map((name, index) => <option key={name} value={index}>{name}</option>)}
              </select>
            </div>
          ) : (
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor="pricing-date" className={labelClass}>Data</label>
              <Input id="pricing-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
            </div>
          )}
          <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
            <label htmlFor="pricing-label" className={labelClass}>Nome da regra</label>
            <Input id="pricing-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Ex.: Domingo premium" maxLength={80} required />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
            <label htmlFor="pricing-adjustment-type" className={labelClass}>Acréscimo</label>
            <div className="grid min-w-0 gap-2.5 sm:grid-cols-2 sm:gap-4">
              <select
                id="pricing-adjustment-type"
                value={adjustmentType}
                onChange={(event) => setAdjustmentType(event.target.value as "PERCENTAGE" | "FIXED_CENTS")}
                className={selectClass}
              >
                <option value="PERCENTAGE">Percentual</option>
                <option value="FIXED_CENTS">Valor fixo por serviço</option>
              </select>
              <div className="flex min-w-0 items-stretch overflow-hidden rounded-[10px] border border-border-strong bg-background focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25">
                {adjustmentType === "FIXED_CENTS" && <span aria-hidden="true" className="grid place-items-center border-r border-border-strong px-3 text-sm text-muted-foreground">R$</span>}
                <Input
                  type="number"
                  min={0}
                  max={adjustmentType === "PERCENTAGE" ? 100 : 1000}
                  step={adjustmentType === "PERCENTAGE" ? 1 : 0.01}
                  value={adjustmentValue}
                  onChange={(event) => setAdjustmentValue(event.target.value)}
                  aria-label={adjustmentType === "PERCENTAGE" ? "Percentual do acréscimo" : "Valor fixo do acréscimo"}
                  className="rounded-none border-0 tabular-nums focus-visible:ring-0"
                  required
                />
                {adjustmentType === "PERCENTAGE" && <span aria-hidden="true" className="grid place-items-center border-l border-border-strong px-3 text-sm text-muted-foreground">%</span>}
              </div>
            </div>
          </div>
          {error && <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p>}
          <div className="flex flex-wrap gap-2.5 sm:col-span-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Check aria-hidden="true" className="h-4 w-4" />}
              Salvar regra
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          </div>
        </form>
      )}

      {rules.length === 0 ? (
        <div className="flex flex-col items-center gap-2.5 rounded-[14px] border border-dashed border-border-strong px-4 py-5 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground"><Percent aria-hidden="true" className="h-4 w-4" /></span>
          <p className="text-sm text-muted-foreground">
            <span className="block font-medium text-foreground">Nenhuma regra cadastrada.</span>
            Sem regra, todos os serviços continuam com o preço normal.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rules.map((rule) => {
            const target = rule.targetType === "WEEKDAY"
              ? WEEKDAYS[rule.weekday ?? 0]
              : rule.date ? new Date(`${rule.date.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "Data específica";
            const value = rule.adjustmentType === "PERCENTAGE"
              ? `+${rule.adjustmentValue}%`
              : `+R$ ${(rule.adjustmentValue / 100).toFixed(2).replace(".", ",")}`;
            return (
              <li key={rule.id} className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-border bg-background px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <CalendarDays aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className={cn("text-sm font-medium [overflow-wrap:anywhere]", !rule.active && "text-muted-foreground")}>{rule.label} <span className="whitespace-nowrap font-semibold tabular-nums">{value}</span></p>
                    <p className="text-xs text-muted-foreground">{target} · {rule.active ? "Ativa" : "Desativada"}</p>
                  </div>
                </div>
                {canManage && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => run(() => togglePricingRule(rule.id, !rule.active), rule.active ? "Regra desativada" : "Regra ativada")}
                    >
                      {rule.active ? "Desativar" : "Ativar"}
                    </Button>
                    <IconButton
                      label={`Remover regra ${rule.label}`}
                      disabled={pending}
                      onClick={() => {
                        if (window.confirm("Remover esta regra de preço?")) {
                          run(() => deletePricingRule(rule.id), "Regra removida");
                        }
                      }}
                      className="hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    </IconButton>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SettingsBlock>
  );
}
