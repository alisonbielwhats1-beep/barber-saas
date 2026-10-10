"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { Check, Clock, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReceiptButton } from "./receipt-button";
import { getReceiptDay, getReceiptDays, receiveBatch } from "./receipt-actions";
import { addCalendarDays } from "@/lib/time";
import { formatMoney } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type DayData = Awaited<ReturnType<typeof getReceiptDay>>;
type DayHistory = Awaited<ReturnType<typeof getReceiptDays>>;
type Edit = {
  selected: boolean;
  method: "PIX" | "CASH" | "CREDIT_CARD" | "DEBIT_CARD" | "TRANSFER";
  extraServiceIds: string[];
  surcharge: string;
  discount: string;
  reason: string;
  key: string;
};
const METHODS = [
  { id: "PIX", name: "Pix" },
  { id: "CASH", name: "Dinheiro" },
  { id: "CREDIT_CARD", name: "Crédito" },
  { id: "DEBIT_CARD", name: "Débito" },
  { id: "TRANSFER", name: "Transferência" },
] as const;
const field =
  "min-h-11 min-w-0 rounded-[10px] border border-border-strong bg-background px-3 text-base font-normal text-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 lg:min-h-10 lg:text-sm";
const money = (v: string) =>
  /^\d+(?:[,.]\d{0,2})?$/.test(v)
    ? Math.round(Number(v.replace(",", ".")) * 100)
    : v === ""
      ? 0
      : NaN;
const dateLabel = (v: string) => v.split("-").reverse().join("/");
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const weekday = (v: string) => WEEKDAYS[new Date(`${v}T12:00:00Z`).getUTCDay()];

export function ReceiptWorkspace({
  date,
  history = false,
  variant = "card",
}: {
  date?: string;
  history?: boolean;
  /** "bare": só o botão "Registrar recebimentos" e a janela (atalho da linha de pendências da Hoje). */
  variant?: "card" | "bare";
}) {
  const router = useRouter();
  const [days, setDays] = useState<DayHistory | null>(null);
  const [endDate, setEndDate] = useState<string>();
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [openedDays, setOpenedDays] = useState<string[]>([]);
  const [data, setData] = useState<DayData | null>(null);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [receivedDate, setReceivedDate] = useState("");
  const [finalize, setFinalize] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  async function startTransition(work: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      await work();
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  const [refresh, setRefresh] = useState(0);
  const request = useRef(0);
  // Na versão "bare" (Hoje) não há onde mostrar o erro ao lado do botão: ele vira aviso.
  useEffect(() => {
    if (variant === "bare" && error && !openDate) toast(error, "error");
  }, [variant, error, openDate]);
  useEffect(() => {
    if (!history) return;
    let live = true;
    getReceiptDays(endDate)
      .then((value) => {
        if (live) setDays(value);
      })
      .catch(() => {
        if (live)
          setError("Não foi possível carregar os dias. Tente atualizar.");
      });
    return () => {
      live = false;
    };
  }, [history, endDate, refresh]);

  function open(day: string | string[]) {
    if (busy.current) return;
    const dates = [...new Set(typeof day === "string" ? [day] : day)].sort();
    if (!dates.length || dates.length > 31) return;
    const id = ++request.current;
    setOpenDate(dates[0]!);
    setOpenedDays(dates);
    setData(null);
    setError(null);
    setSummary("");
    setMessages({});
    setFinalize(false);
    startTransition(async () => {
      try {
        // Reuse the tenant-scoped daily query with bounded concurrency.
        const loaded: DayData[] = [];
        for (let i = 0; i < dates.length; i += 4) {
          loaded.push(...await Promise.all(dates.slice(i, i + 4).map(getReceiptDay)));
        }
        if (id !== request.current) return;
        const value: DayData = {
          ...loaded[0]!,
          rows: loaded.flatMap((entry) => entry.rows).sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id)),
          paid: loaded.flatMap((entry) => entry.paid),
        };
        setData(value);
        setReceivedDate(value.receivedDate);
        setEdits(
          Object.fromEntries(
            value.rows.map((r) => [
              r.id,
              {
                selected: r.eligible && r.status === "COMPLETED",
                method: "PIX",
                extraServiceIds: [],
                surcharge: "",
                discount: "",
                reason: "",
                key: crypto.randomUUID(),
              },
            ]),
          ),
        );
      } catch {
        if (id === request.current)
          setError(
            "Não foi possível carregar todos os dias. Nenhum recebimento foi registrado. Tente novamente.",
          );
      }
    });
  }
  function edit(id: string, patch: Partial<Edit>) {
    setEdits((current) => ({
      ...current,
      [id]: { ...current[id]!, ...patch, key: crypto.randomUUID() },
    }));
    setMessages((current) => ({ ...current, [id]: "" }));
  }
  function total(row: DayData["rows"][number]) {
    const e = edits[row.id];
    return (
      row.baseCents +
      money(e?.surcharge ?? "") -
      money(e?.discount ?? "") +
      (e?.extraServiceIds ?? []).reduce(
        (sum, id) =>
          sum + (data?.services.find((s) => s.id === id)?.priceCents ?? 0),
        0,
      )
    );
  }
  const selected = data?.rows.filter((r) => edits[r.id]?.selected) ?? [];
  const totalCents = selected.reduce((sum, r) => sum + total(r), 0);
  function submit() {
    if (!data) return;
    setError(null);
    if (!selected.length || selected.length > 100) {
      setError("Selecione de 1 a 100 atendimentos por vez.");
      return;
    }
    if (!receivedDate || receivedDate > data.today) {
      setError("Confira a data do recebimento.");
      return;
    }
    if (
      selected.some(
        (r) =>
          !Number.isSafeInteger(total(r)) ||
          total(r) < 0 ||
          total(r) > 100_000_000 ||
          ((money(edits[r.id]!.surcharge) > 0 ||
            money(edits[r.id]!.discount) > 0) &&
            edits[r.id]!.reason.trim().length < 3),
      )
    ) {
      setError("Confira os valores e descreva os acréscimos e descontos.");
      return;
    }
    startTransition(async () => {
      try {
        const results = await receiveBatch({
          receivedDate,
          finalize,
          rows: selected.map((r) => ({
            id: r.id,
            version: r.version,
            idempotencyKey: edits[r.id]!.key,
            method: edits[r.id]!.method,
            extraServiceIds: edits[r.id]!.extraServiceIds,
            surchargeCents: money(edits[r.id]!.surcharge),
            discountCents: money(edits[r.id]!.discount),
            adjustmentReason: edits[r.id]!.reason,
            expectedTotalCents: total(r),
            products: r.products,
          })),
        });
        const success = new Set(
          results.filter((r) => r.success).map((r) => r.id),
        );
        setData((current) =>
          current
            ? {
                ...current,
                rows: current.rows.filter((r) => !success.has(r.id)),
              }
            : current,
        );
        setMessages(
          Object.fromEntries(
            results.filter((r) => !r.success).map((r) => [r.id, r.message]),
          ),
        );
        setSummary(
          `${success.size} recebimento(s) registrado(s). ${results.length - success.size} falha(s) na baixa. Atendimentos não selecionados continuam pendentes.`,
        );
        setRefresh((v) => v + 1);
        router.refresh();
      } catch {
        setError(
          "Falha de conexão. Tente novamente; pagamentos já registrados não serão duplicados.",
        );
      }
    });
  }
  const dialog = (
      <Dialog
        open={Boolean(openDate)}
        onOpenChange={(value) => {
          if (!value && !pending) {
            request.current++;
            setOpenDate(null);
          }
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              Recebimentos · {openedDays.length > 1 ? `${openedDays.length} dias selecionados` : openDate && dateLabel(openDate)}
            </DialogTitle>
            <DialogDescription>
              Confira os valores e selecione apenas os atendimentos pagos.
              Desmarcar mantém a pendência. Cada atendimento pode ter sua própria forma de pagamento.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="rounded-[10px] border border-danger/35 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          {summary && (
            <p role="status" className="rounded-[10px] border border-success/35 bg-success/10 px-3 py-2 text-sm text-success">
              {summary}
            </p>
          )}
          {!data ? (
            error ? <Button type="button" variant="outline" disabled={pending} onClick={() => open(openedDays)}>Tentar novamente</Button>
              : <p role="status" className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <fieldset
              disabled={pending}
              className="min-w-0 space-y-4 disabled:opacity-70"
            >
              <div className="flex flex-wrap items-end gap-3">
                <label className="grid gap-1.5 text-sm font-medium">
                  Data do recebimento
                  <input
                    aria-label="Data do recebimento"
                    type="date"
                    max={data.today}
                    value={receivedDate}
                    onChange={(e) => {
                      setReceivedDate(e.target.value);
                      setEdits((current) =>
                        Object.fromEntries(
                          Object.entries(current).map(([id, v]) => [
                            id,
                            { ...v, key: crypto.randomUUID() },
                          ]),
                        ),
                      );
                    }}
                    className={field}
                  />
                </label>
                <label className="grid min-w-0 gap-1.5 text-sm font-medium">
                  Aplicar a mesma forma aos selecionados (opcional)
                  <select
                    value=""
                    className={field}
                    onChange={(e) => {
                      for (const row of selected)
                        edit(row.id, {
                          method: e.target.value as Edit["method"],
                        });
                    }}
                  >
                    <option value="" disabled>
                      Aplicar forma…
                    </option>
                    {METHODS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                A data começa em ontem. Altere se o dinheiro foi recebido em
                outro dia. Essa data será usada para todos os recebimentos selecionados.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    data.rows.forEach((r) => {
                      if (r.eligible) edit(r.id, { selected: true });
                    })
                  }
                >
                  Selecionar todos
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    data.rows.forEach((r) => edit(r.id, { selected: false }))
                  }
                >
                  Limpar seleção
                </Button>
                {selected.some((r) => r.status !== "COMPLETED") && (
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-5 w-5 shrink-0 accent-[hsl(var(--selection-solid))]"
                      checked={finalize}
                      onChange={(e) => setFinalize(e.target.checked)}
                    />
                    Confirmo que os selecionados foram realizados; finalizar os
                    pendentes
                  </label>
                )}
              </div>
              <div className="space-y-3 pr-1 sm:max-h-[45vh] sm:overflow-y-auto">
                {data.rows.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhum recebimento pendente nos dias escolhidos.</p>
                )}
                {data.rows.map((row) => {
                  const e = edits[row.id]!;
                  const hasSurcharge = money(e.surcharge) > 0;
                  const hasDiscount = money(e.discount) > 0;
                  const reasonLabel =
                    hasSurcharge && hasDiscount
                      ? "Motivo do acréscimo e do desconto"
                      : hasDiscount
                        ? "Motivo do desconto"
                        : "Motivo do acréscimo";
                  return (
                    <article
                      key={row.id}
                      className={`rounded-xl border p-3 transition-colors ${e.selected ? "border-[hsl(var(--selection-solid)/0.7)] bg-[hsl(var(--selection)/0.35)]" : "border-border"}`}
                    >
                      <div className="flex items-start gap-2">
                        <label className="flex min-h-11 min-w-11 shrink-0 items-center justify-center">
                        <input
                          className="h-5 w-5 accent-[hsl(var(--selection-solid))]"
                          aria-label={`Selecionar ${row.name}`}
                          type="checkbox"
                          disabled={!row.eligible}
                          checked={e.selected}
                          onChange={(event) =>
                            edit(row.id, { selected: event.target.checked })
                          }
                        />
                        </label>
                        <div className="min-w-0 flex-1 pt-2">
                          <p className="break-words text-sm font-semibold">
                            <span className="tabular-nums">{formatInTimeZone(
                              row.startAt,
                              data.timezone,
                              "dd/MM/yyyy · HH:mm",
                            )}</span>{" "}
                            · {row.name}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {row.service} · {row.professional}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {!row.eligible
                              ? "Horário ainda não iniciado"
                              : row.status !== "COMPLETED"
                                ? "Requer confirmação de finalização"
                                : "Concluído · aguardando pagamento"}
                          </p>
                          <p className="mt-1 text-xs font-medium">{e.selected ? "Selecionado para baixa" : "Fora desta baixa · permanece pendente"}</p>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-end gap-2">
                        <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
                          Forma de pagamento deste atendimento
                          <select
                            aria-label={`Forma de pagamento de ${row.name} · ${formatInTimeZone(row.startAt, data.timezone, "dd/MM/yyyy HH:mm")}`}
                            className={`${field} text-foreground`}
                            value={e.method}
                            onChange={(event) =>
                              edit(row.id, {
                                method: event.target.value as Edit["method"],
                              })
                            }
                          >
                            {METHODS.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="grid gap-1 text-xs text-muted-foreground">
                          Acréscimo (R$)
                          <input
                            className={`${field} w-28 text-foreground tabular-nums`}
                            inputMode="decimal"
                            placeholder="0,00"
                            value={e.surcharge}
                            onChange={(event) =>
                              edit(row.id, { surcharge: event.target.value })
                            }
                          />
                        </label>
                        <label className="grid gap-1 text-xs text-muted-foreground">
                          Desconto (R$)
                          <input
                            className={`${field} w-28 text-foreground tabular-nums`}
                            inputMode="decimal"
                            placeholder="0,00"
                            value={e.discount}
                            onChange={(event) =>
                              edit(row.id, { discount: event.target.value })
                            }
                          />
                        </label>
                        <strong className="ml-auto pb-3 text-sm font-semibold tabular-nums lg:pb-2.5">
                          Total{" "}
                          {Number.isFinite(total(row))
                            ? formatMoney(total(row), data.currency)
                            : "inválido"}
                        </strong>
                      </div>
                      {(hasSurcharge || hasDiscount) && (
                        <input
                          className={`${field} mt-2 w-full`}
                          aria-label={`${reasonLabel} de ${row.name}`}
                          placeholder={hasDiscount && !hasSurcharge ? "Ex.: serviço não realizado" : reasonLabel}
                          maxLength={300}
                          value={e.reason}
                          onChange={(event) =>
                            edit(row.id, { reason: event.target.value })
                          }
                        />
                      )}
                      <details className="mt-2">
                        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">
                          Adicionar serviços realizados (
                          {e.extraServiceIds.length})
                        </summary>
                        <select
                          className={`${field} w-full`}
                          value=""
                          aria-label={`Adicionar serviço para ${row.name}`}
                          onChange={(event) => {
                            if (
                              event.target.value &&
                              e.extraServiceIds.length < 30
                            )
                              edit(row.id, {
                                extraServiceIds: [
                                  ...e.extraServiceIds,
                                  event.target.value,
                                ],
                              });
                          }}
                        >
                          <option value="">Escolher serviço…</option>
                          {data.services.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name} ·{" "}
                              {formatMoney(s.priceCents, data.currency)}
                            </option>
                          ))}
                        </select>
                        {e.extraServiceIds.map((id, i) => (
                          <div
                            key={`${id}-${i}`}
                            className="flex items-center justify-between gap-2 text-sm"
                          >
                            <span className="min-w-0">
                              {data.services.find((s) => s.id === id)?.name}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                edit(row.id, {
                                  extraServiceIds: e.extraServiceIds.filter(
                                    (_, index) => index !== i,
                                  ),
                                })
                              }
                            >
                              Remover extra
                            </Button>
                          </div>
                        ))}
                      </details>
                      {messages[row.id] && (
                        <p role="alert" className="mt-2 text-sm text-danger">
                          {messages[row.id]}{" "}
                          <button
                            className="min-h-11 underline underline-offset-2 lg:min-h-0"
                            type="button"
                            onClick={() => open(openedDays)}
                          >
                            Atualizar lista
                          </button>
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
              {selected.length > 100 && <p role="alert" className="text-sm text-danger">Selecione no máximo 100 atendimentos por baixa. Desmarque os demais para continuar.</p>}
              <Button
                type="button"
                size="lg"
                onClick={submit}
                disabled={!selected.length || selected.length > 100 || !Number.isFinite(totalCents) || (selected.some(row => row.status !== "COMPLETED") && !finalize)}
                className="h-auto min-h-12 w-full whitespace-normal py-2 text-center lg:min-h-10"
              >
                {pending
                  ? "Registrando…"
                  : `Dar baixa em ${selected.length} atendimento(s) · ${Number.isFinite(totalCents) ? formatMoney(totalCents, data.currency) : "valor inválido"}`}
              </Button>
              {data.paid.length > 0 && (
                <details>
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">
                    {openedDays.length > 1 ? "Já recebidos nos dias escolhidos" : "Já recebidos neste dia de atendimento"} ({data.paid.length})
                  </summary>
                  {data.paid.map((p) => (
                    <div
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-2"
                    >
                      <span className="text-sm">
                        {p.name} · {formatMoney(p.amountCents, data.currency)} ·
                        recebido{" "}
                        {formatInTimeZone(p.paidAt, data.timezone, "dd/MM")}
                      </span>
                      <ReceiptButton id={p.id} />
                    </div>
                  ))}
                </details>
              )}
            </fieldset>
          )}
        </DialogContent>
      </Dialog>
  );
  // Hoje: só o botão e a janela; a linha de pendências da Hoje é o cartão. O erro vira aviso (não cabe na linha).
  if (variant === "bare") {
    return (
      <>
        {date && (
          <Button size="sm" onClick={() => open(date)}>
            Registrar recebimentos
          </Button>
        )}
        {dialog}
      </>
    );
  }
  return (
    <section id="recebimentos" className="scroll-mt-24 overflow-hidden rounded-[14px] border border-border bg-card">
      <div className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-[1_1_240px]">
            <h2 className="text-sm font-semibold leading-snug">
              {history ? "Recebimentos por dia" : "Receber atendimentos"}
            </h2>
            <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
              {history
                ? "Selecione um ou mais dias e confira cada atendimento antes de dar baixa. O caixa considera a data do recebimento."
                : "Selecione atendimentos e registre os pagamentos de uma vez."}
            </p>
          </div>
          {date && (
            <Button size="sm" className="max-sm:w-full" onClick={() => open(date)}>
              Registrar recebimentos
            </Button>
          )}
        </div>
        {history && (
          <>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" className="max-sm:flex-1"
                disabled={pending || !selectedDays.length} onClick={() => open(selectedDays)}>
                Conferir {selectedDays.length} dia(s) selecionado(s)
              </Button>
              {selectedDays.length > 0 && <Button type="button" variant="outline" size="sm" disabled={pending}
                onClick={() => setSelectedDays([])}>Limpar dias</Button>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending || !days}
                onClick={() =>
                  setEndDate(addCalendarDays(days!.days[days!.days.length - 1]!.date, -1))
                }
              >
                Dias anteriores
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setEndDate(undefined);
                  setRefresh((v) => v + 1);
                }}
              >
                Atualizar / dias recentes
              </Button>
              {endDate && days && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setEndDate(
                      addCalendarDays(endDate, 31) > days.today
                        ? undefined
                        : addCalendarDays(endDate, 31),
                    )
                  }
                >
                  Próximos dias
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Até 31 dias e 100 atendimentos por baixa. Selecionar um dia não registra pagamentos.</p>
          </>
        )}
      </div>
      {history && (!days ? (
        <p role="status" className="border-t border-border px-4 py-3 text-sm text-muted-foreground sm:px-5">Carregando dias…</p>
      ) : (
        <div className="max-h-[28rem] overflow-y-auto overscroll-contain border-t border-border">
          {days.days.map((day) => (
            <div key={day.date} className="flex items-stretch border-b border-border last:border-b-0">
              <label className="grid min-h-11 min-w-11 shrink-0 cursor-pointer place-items-center sm:min-w-14">
                <input type="checkbox" className="h-5 w-5 accent-[hsl(var(--selection-solid))]"
                  aria-label={`Selecionar dia ${dateLabel(day.date)}`}
                  checked={selectedDays.includes(day.date)}
                  disabled={pending || (!selectedDays.includes(day.date) && (!day.pendingCount || selectedDays.length >= 31))}
                  onChange={(event) => setSelectedDays(current => event.target.checked
                    ? [...current, day.date] : current.filter(value => value !== day.date))} />
              </label>
              <button
                type="button"
                className="grid min-h-14 min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 py-2 pr-4 text-left transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:hover:bg-transparent md:grid-cols-[170px_minmax(0,1fr)_minmax(0,170px)_minmax(0,180px)] sm:pr-5"
                onClick={() => open(day.date)}
                disabled={pending}
                aria-label={`Abrir recebimentos de ${dateLabel(day.date)}`}
              >
                <span className="col-start-1 row-start-1 flex min-w-0 items-center gap-2 text-sm font-semibold">
                  <span aria-hidden="true" className={`shrink-0 ${!day.count ? "text-muted-foreground" : day.pendingCount ? "text-warning" : "text-success"}`}>
                    {!day.count ? <Minus className="h-3.5 w-3.5" /> : !day.pendingCount ? <Check className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                  </span>
                  <span className="whitespace-nowrap tabular-nums">{dateLabel(day.date)}</span>
                  <span className="whitespace-nowrap text-xs font-normal text-muted-foreground">{weekday(day.date)}</span>
                </span>
                <span className="col-start-1 row-start-2 min-w-0 text-xs text-muted-foreground md:col-start-2 md:row-start-1">
                  {!day.count
                    ? "Sem movimento"
                    : !day.pendingCount
                      ? "Recebimentos completos"
                      : `${day.pendingCount} pendente(s)`}
                </span>
                <span className={`col-start-2 row-span-2 row-start-1 whitespace-nowrap text-right text-sm tabular-nums md:col-start-3 md:row-span-1 ${day.received ? "font-medium" : "text-muted-foreground"}`}>
                  {formatMoney(day.received)} recebido
                </span>
                {day.pendingCount > 0 ? (
                  <span className="col-span-2 col-start-1 row-start-3 mt-1 md:col-span-1 md:col-start-4 md:row-start-1 md:mt-0 md:text-right">
                    <span className="inline-flex min-h-[22px] max-w-full items-center rounded-full bg-warning/15 px-2.5 text-xs font-medium text-warning">
                      <span className="whitespace-nowrap tabular-nums">{formatMoney(day.pending)} pendente</span>
                    </span>
                  </span>
                ) : <span aria-hidden="true" className="hidden md:col-start-4 md:row-start-1 md:block" />}
              </button>
            </div>
          ))}
        </div>
      ))}
      {!openDate && error && (
        <p role="alert" className="border-t border-border px-4 py-3 text-sm text-danger sm:px-5">
          {error}
        </p>
      )}
      {dialog}
    </section>
  );
}
