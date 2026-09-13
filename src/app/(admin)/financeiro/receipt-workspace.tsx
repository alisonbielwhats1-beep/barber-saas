"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
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
  "min-h-11 rounded-lg border border-border bg-background px-3 text-sm";
const money = (v: string) =>
  /^\d+(?:[,.]\d{0,2})?$/.test(v)
    ? Math.round(Number(v.replace(",", ".")) * 100)
    : v === ""
      ? 0
      : NaN;
const dateLabel = (v: string) => v.split("-").reverse().join("/");

export function ReceiptWorkspace({
  date,
  history = false,
}: {
  date?: string;
  history?: boolean;
}) {
  const router = useRouter();
  const [days, setDays] = useState<DayHistory | null>(null);
  const [endDate, setEndDate] = useState<string>();
  const [openDate, setOpenDate] = useState<string | null>(null);
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

  function open(day: string) {
    const id = ++request.current;
    setOpenDate(day);
    setData(null);
    setError(null);
    setSummary("");
    setMessages({});
    setFinalize(false);
    startTransition(async () => {
      try {
        const value = await getReceiptDay(day);
        if (id !== request.current) return;
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
                reason: "",
                key: crypto.randomUUID(),
              },
            ]),
          ),
        );
      } catch {
        if (id === request.current)
          setError(
            "Não foi possível carregar os recebimentos. Feche e tente novamente.",
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
      money(e?.surcharge ?? "") +
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
          (money(edits[r.id]!.surcharge) > 0 &&
            edits[r.id]!.reason.trim().length < 3),
      )
    ) {
      setError("Confira os valores e descreva os acréscimos.");
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
          `${success.size} recebimento(s) registrado(s). ${results.length - success.size} pendência(s) para revisar.`,
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
  return (
    <section id="recebimentos" className="scroll-mt-24 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">
            {history ? "Recebimentos por dia" : "Receber atendimentos"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {history
              ? "Pendências pelo dia do atendimento. O caixa considera a data do recebimento."
              : "Selecione atendimentos e registre os pagamentos de uma vez."}
          </p>
        </div>
        {date && (
          <button
            className={`${field} bg-primary text-primary-foreground`}
            onClick={() => open(date)}
          >
            Registrar recebimentos
          </button>
        )}
      </div>
      {history && (
        <>
          <div className="my-4 flex flex-wrap gap-2">
            <button
              className={field}
              disabled={pending || !days}
              onClick={() =>
                setEndDate(addCalendarDays(days!.days[30]!.date, -1))
              }
            >
              Dias anteriores
            </button>
            <button
              className={field}
              onClick={() => {
                setEndDate(undefined);
                setRefresh((v) => v + 1);
              }}
            >
              Atualizar / dias recentes
            </button>
            {endDate && days && (
              <button
                className={field}
                onClick={() =>
                  setEndDate(
                    addCalendarDays(endDate, 31) > days.today
                      ? undefined
                      : addCalendarDays(endDate, 31),
                  )
                }
              >
                Próximos dias
              </button>
            )}
          </div>
          {!days ? (
            <p role="status">Carregando dias…</p>
          ) : (
            <div className="max-h-[28rem] overflow-y-auto divide-y divide-border">
              {days.days.map((day) => (
                <button
                  key={day.date}
                  className="flex min-h-16 w-full items-center justify-between gap-3 px-2 py-3 text-left hover:bg-card-hover"
                  onClick={() => open(day.date)}
                  aria-label={`Abrir recebimentos de ${dateLabel(day.date)}`}
                >
                  <span>
                    <span
                      aria-hidden="true"
                      className={
                        day.pendingCount ? "text-warning" : "text-success"
                      }
                    >
                      {!day.count
                        ? "—"
                        : !day.pendingCount
                          ? "☑"
                          : day.pendingCount < day.count
                            ? "◐"
                            : "☐"}
                    </span>{" "}
                    <strong>{dateLabel(day.date)}</strong>
                    <span className="block text-xs text-muted-foreground">
                      {!day.count
                        ? "Sem movimento"
                        : !day.pendingCount
                          ? "Recebimentos completos"
                          : `${day.pendingCount} pendente(s)`}
                    </span>
                  </span>
                  <span className="text-right text-sm">
                    <span className="block">
                      {formatMoney(day.received)} recebido
                    </span>
                    {day.pendingCount > 0 && (
                      <span className="text-warning">
                        {formatMoney(day.pending)} pendente
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {!openDate && error && (
        <p role="alert" className="mt-3 text-danger">
          {error}
        </p>
      )}
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
              Recebimentos · {openDate && dateLabel(openDate)}
            </DialogTitle>
            <DialogDescription>
              Confira os valores e selecione apenas os atendimentos pagos.
              Desmarcar mantém a pendência.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          {summary && (
            <p role="status" className="text-sm text-success">
              {summary}
            </p>
          )}
          {!data ? (
            <p role="status">Carregando…</p>
          ) : (
            <fieldset
              disabled={pending}
              className="min-w-0 space-y-4 disabled:opacity-70"
            >
              <div className="flex flex-wrap items-end gap-3">
                <label className="grid gap-1 text-sm">
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
                <label className="grid gap-1 text-sm">
                  Forma para os selecionados
                  <select
                    defaultValue=""
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
                outro dia.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className={field}
                  onClick={() =>
                    data.rows.forEach((r) => {
                      if (r.eligible) edit(r.id, { selected: true });
                    })
                  }
                >
                  Selecionar todos
                </button>
                <button
                  type="button"
                  className={field}
                  onClick={() =>
                    data.rows.forEach((r) => edit(r.id, { selected: false }))
                  }
                >
                  Limpar seleção
                </button>
                {selected.some((r) => r.status !== "COMPLETED") && (
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
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
                  <p>Nenhum recebimento pendente neste dia.</p>
                )}
                {data.rows.map((row) => {
                  const e = edits[row.id]!;
                  return (
                    <article
                      key={row.id}
                      className="rounded-xl border border-border p-3"
                    >
                      <div className="flex items-start gap-3">
                        <input
                          className="mt-1 h-5 w-5"
                          aria-label={`Selecionar ${row.name}`}
                          type="checkbox"
                          disabled={!row.eligible}
                          checked={e.selected}
                          onChange={(event) =>
                            edit(row.id, { selected: event.target.checked })
                          }
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold">
                            {formatInTimeZone(
                              row.startAt,
                              data.timezone,
                              "HH:mm",
                            )}{" "}
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
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-end gap-2">
                        <label className="grid gap-1 text-xs">
                          Forma
                          <select
                            className={field}
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
                        <label className="grid gap-1 text-xs">
                          Acréscimo (R$)
                          <input
                            className={`${field} w-28`}
                            inputMode="decimal"
                            placeholder="0,00"
                            value={e.surcharge}
                            onChange={(event) =>
                              edit(row.id, { surcharge: event.target.value })
                            }
                          />
                        </label>
                        <strong className="pb-3">
                          Total{" "}
                          {Number.isFinite(total(row))
                            ? formatMoney(total(row), data.currency)
                            : "inválido"}
                        </strong>
                      </div>
                      {money(e.surcharge) > 0 && (
                        <input
                          className={`${field} mt-2 w-full`}
                          aria-label={`Motivo do acréscimo de ${row.name}`}
                          placeholder="Motivo do acréscimo"
                          maxLength={300}
                          value={e.reason}
                          onChange={(event) =>
                            edit(row.id, { reason: event.target.value })
                          }
                        />
                      )}
                      <details className="mt-3">
                        <summary className="cursor-pointer py-2 text-sm">
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
                            <span>
                              {data.services.find((s) => s.id === id)?.name}
                            </span>
                            <button
                              type="button"
                              className="min-h-11 px-3"
                              onClick={() =>
                                edit(row.id, {
                                  extraServiceIds: e.extraServiceIds.filter(
                                    (_, index) => index !== i,
                                  ),
                                })
                              }
                            >
                              Remover extra
                            </button>
                          </div>
                        ))}
                      </details>
                      {messages[row.id] && (
                        <p role="alert" className="mt-2 text-sm text-danger">
                          {messages[row.id]}{" "}
                          <button
                            className="underline"
                            type="button"
                            onClick={() => open(openDate!)}
                          >
                            Atualizar lista
                          </button>
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={submit}
                disabled={!selected.length || !Number.isFinite(totalCents)}
                className="min-h-12 w-full rounded-xl bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-50"
              >
                {pending
                  ? "Registrando…"
                  : `Dar baixa em ${selected.length} atendimento(s) · ${Number.isFinite(totalCents) ? formatMoney(totalCents, data.currency) : "valor inválido"}`}
              </button>
              {data.paid.length > 0 && (
                <details>
                  <summary className="min-h-11 cursor-pointer text-sm font-semibold">
                    Já recebidos neste dia de atendimento ({data.paid.length})
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
    </section>
  );
}
