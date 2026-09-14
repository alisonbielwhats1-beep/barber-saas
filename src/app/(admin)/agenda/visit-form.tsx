"use client";
import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VisitSummary } from "@/components/visit-summary";
import { SearchPicker } from "@/components/ui/search-picker";
import {
  displayMinutes,
  staffVisitTimes,
  type StaffVisitRow,
} from "@/lib/staff-visit-times";
import { isDateKey } from "@/lib/time";
import { isValidPhoneBR } from "@/lib/phone";
import type { VisitPlan } from "@/lib/visit-plan";
import { previewStaffVisit, confirmStaffVisit } from "./visit-actions";
import { searchAppointmentClients } from "./client-search-actions";
import type {
  ClientOption,
  ProOption,
  ServiceOption,
} from "./appointment-form";
const field =
  "min-h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-base";
export function StaffVisitDialog({
  open,
  onOpenChange,
  onBack,
  professionals,
  services,
  clients,
  slotStartLocal,
  canOverride,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBack: () => void;
  professionals: ProOption[];
  services: ServiceOption[];
  clients: ClientOption[];
  slotStartLocal: string;
  canOverride: boolean;
}) {
  const [date, setDate] = useState(slotStartLocal.slice(0, 10)),
    [time, setTime] = useState(slotStartLocal.slice(11, 16)),
    [rows, setRows] = useState<StaffVisitRow[]>([
      { serviceId: "", professionalId: "", time: "" },
    ]);
  const [stage, setStage] = useState<"client" | "services">("client");
  const times = staffVisitTimes(rows, time, services);
  const [clientId, setClientId] = useState(""),
    [newClient, setNewClient] = useState(false),
    [name, setName] = useState(""),
    [phone, setPhone] = useState(""),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<ClientOption[]>(clients),
    [chosen, setChosen] = useState<ClientOption | null>(null);
  const [override, setOverride] = useState(false),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [quote, setQuote] = useState<{ plan: VisitPlan; quote: string } | null>(
      null,
    );
  const lock = useRef(false),
    key = useRef<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [stage, quote]);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [error]);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      if (query.trim().length < 2) {
        setResults(clients);
        return;
      }
      void searchAppointmentClients(query)
        .then((items) => {
          if (live) setResults(items);
        })
        .catch(() => {
          if (live) setError("Não foi possível pesquisar clientes.");
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, clients]);
  function reset() {
    setQuote(null);
    setError("");
    key.current = null;
  }
  function update(i: number, values: Partial<(typeof rows)[number]>) {
    reset();
    setRows((all) =>
      all.map((row, j) => (j === i ? { ...row, ...values } : row)),
    );
  }
  function payload() {
    const starts = times.map((item) => item.start!);
    const first = Math.min(...starts);
    key.current ??= crypto.randomUUID();
    return {
      choices: rows.map((row, i) => ({
        serviceId: row.serviceId,
        professionalId: row.professionalId,
        offsetMin: starts[i]! - first,
      })),
      startLocal: `${date}T${String(Math.floor(first / 60)).padStart(2, "0")}:${String(first % 60).padStart(2, "0")}`,
      idempotencyKey: key.current,
      ...(newClient ? { clientName: name, clientPhone: phone } : { clientId }),
      ...(override ? { scheduleOverrideReason: reason } : {}),
      ...(quote ? { quote: quote.quote } : {}),
    };
  }
  async function submit() {
    if (lock.current) return;
    setError("");
    if (!isDateKey(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      setStage("client");
      setError("Escolha a data e o horário de início da visita.");
      return;
    }
    if (newClient && phone && !isValidPhoneBR(phone)) {
      setStage("client");
      setError("Confira o telefone do cliente, incluindo o DDD.");
      return;
    }
    if (stage === "client") {
      if ((!newClient && !clientId) || (newClient && name.trim().length < 2)) {
        setError("Selecione um cliente ou informe o nome do novo cliente.");
        return;
      }
      setStage("services");
      return;
    }
    const invalidTime = times.findIndex((item) => !item.valid);
    if (invalidTime !== -1 && rows.every((row) => row.serviceId)) {
      setError(
        `Serviço ${invalidTime + 1}: informe um início válido e ajuste a duração para terminar até 24:00. A visita não pode atravessar para outro dia.`,
      );
      return;
    }
    const incomplete = rows.findIndex(
      (row) => !row.serviceId || !row.professionalId,
    );
    if (incomplete !== -1) {
      setError(
        `Serviço ${incomplete + 1}: escolha ${!rows[incomplete]!.serviceId ? "o serviço" : "quem vai realizar o atendimento"} para continuar.`,
      );
      return;
    }
    if (override && reason.trim().length < 3) {
      setError(
        "Informe o motivo da exceção de jornada com pelo menos três caracteres.",
      );
      return;
    }
    lock.current = true;
    setPending(true);
    try {
      if (quote) {
        const result = await confirmStaffVisit(payload());
        if ("error" in result) {
          setError(result.error ?? "Não foi possível confirmar.");
          setQuote(null);
        } else onOpenChange(false);
      } else {
        const result = await previewStaffVisit(payload());
        if ("error" in result)
          setError(result.error ?? "Não foi possível confirmar.");
        else setQuote(result);
      }
    } catch {
      setError("Não foi possível concluir. Revise os dados e tente novamente.");
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  const options =
    chosen && !results.some((c) => c.id === chosen.id)
      ? [chosen, ...results]
      : results;
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) onOpenChange(value);
      }}
    >
      <DialogContent
        mobileSheet
        aria-label="Uma visita, vários serviços"
        aria-describedby={undefined}
        className="flex max-h-[90dvh] max-w-lg flex-col overflow-hidden p-4 pt-6 sm:p-6"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle
            ref={titleRef}
            tabIndex={-1}
            className="pr-10 outline-none"
          >
            Uma visita, vários serviços
          </DialogTitle>
          <p className="pt-2 text-sm text-muted-foreground">
            {quote
              ? "3 de 3 · Conferir e confirmar"
              : stage === "client"
                ? "1 de 3 · Cliente e início"
                : "2 de 3 · Organizar serviços"}
          </p>
        </DialogHeader>
        <div
          ref={bodyRef}
          className="min-h-0 min-w-0 overflow-y-auto overscroll-contain px-1"
          role="region"
          aria-label="Dados da visita"
        >
          <fieldset disabled={pending} className="min-w-0 space-y-4 pb-1">
            <button
              type="button"
              className="min-h-11 text-sm text-primary"
              onClick={onBack}
            >
              ← Agendamento simples ou recorrente
            </button>
            {!quote && (
              <>
                {stage === "client" ? (
                  <>
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={newClient}
                        onChange={(e) => {
                          reset();
                          setNewClient(e.target.checked);
                        }}
                      />
                      Cadastrar novo cliente
                    </label>
                    {newClient ? (
                      <>
                        <label className="grid gap-1 text-sm">
                          Nome
                          <input
                            className={field}
                            value={name}
                            onChange={(e) => {
                              reset();
                              setName(e.target.value);
                            }}
                          />
                        </label>
                        <label className="grid gap-1 text-sm">
                          Telefone
                          <input
                            className={field}
                            value={phone}
                            onChange={(e) => {
                              reset();
                              setPhone(e.target.value);
                            }}
                          />
                        </label>
                      </>
                    ) : (
                      <>
                        <label className="grid gap-1 text-sm">
                          Pesquisar cliente
                          <input
                            className={field}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Nome ou telefone"
                          />
                        </label>
                        <label className="grid gap-1 text-sm">
                          Cliente
                          <select
                            className={field}
                            value={clientId}
                            onChange={(e) => {
                              reset();
                              setClientId(e.target.value);
                              setChosen(
                                options.find((c) => c.id === e.target.value) ??
                                  null,
                              );
                            }}
                          >
                            <option value="">Selecione</option>
                            {options.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <label className="grid min-w-0 gap-1 text-sm">
                        Data
                        <input
                          className={field}
                          type="date"
                          required
                          value={date}
                          onChange={(e) => {
                            reset();
                            setDate(e.target.value);
                          }}
                        />
                      </label>
                      <label className="grid min-w-0 gap-1 text-sm">
                        Início
                        <input
                          className={field}
                          type="time"
                          required
                          step={60}
                          value={time}
                          onChange={(e) => {
                            reset();
                            setTime(e.target.value);
                          }}
                        />
                      </label>
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        reset();
                        setStage("client");
                      }}
                      className="w-full rounded-xl border border-border bg-muted/40 p-3 text-left text-sm"
                    >
                      <span className="block font-medium">
                        {newClient
                          ? name
                          : (chosen?.name ??
                            options.find((c) => c.id === clientId)?.name)}
                      </span>
                      <span className="mt-1 block text-muted-foreground">
                        {date.split("-").reverse().join("/")} · Início{" "}
                        {displayMinutes(
                          Math.min(
                            ...times.map((item) => item.start ?? Infinity),
                          ),
                        )}{" "}
                        <span className="text-primary">· Alterar</span>
                      </span>
                    </button>
                    <p className="text-sm text-muted-foreground">
                      Os horários seguem em sequência. Abra “Ajustar horário”
                      para atender ao mesmo tempo ou escolher outro início.
                    </p>
                    {rows.map((row, i) => (
                      <div
                        key={i}
                        className="min-w-0 space-y-3 rounded-2xl border border-border p-3"
                      >
                        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span>ATENDIMENTO {i + 1}</span>
                          <span>
                            {displayMinutes(times[i]!.start)} —{" "}
                            {displayMinutes(times[i]!.end)}
                          </span>
                        </div>
                        <SearchPicker
                          label={`Serviço ${i + 1}`}
                          value={row.serviceId}
                          onChange={(value) => {
                            const pros = professionals.filter((p) =>
                              p.serviceIds.includes(value),
                            );
                            update(i, {
                              serviceId: value,
                              professionalId:
                                pros.length === 1 ? pros[0]!.id : "",
                            });
                          }}
                          placeholder="Escolher serviço"
                          options={services
                            .filter((s) =>
                              professionals.some((p) =>
                                p.serviceIds.includes(s.id),
                              ),
                            )
                            .map((s) => ({
                              value: s.id,
                              label: s.name,
                              description: `${s.durationMin} min`,
                            }))}
                        />
                        <SearchPicker
                          label={`Profissional do serviço ${i + 1}`}
                          disabled={!row.serviceId}
                          value={row.professionalId}
                          onChange={(value) =>
                            update(i, { professionalId: value })
                          }
                          placeholder={
                            row.serviceId
                              ? "Escolher profissional"
                              : "Escolha primeiro o serviço"
                          }
                          options={professionals
                            .filter((p) => p.serviceIds.includes(row.serviceId))
                            .map((p) => ({ value: p.id, label: p.name }))}
                        />
                        <button
                          type="button"
                          aria-expanded={!!row.customTime}
                          onClick={() =>
                            update(i, {
                              customTime: !row.customTime,
                              time:
                                times[i]!.start !== null &&
                                times[i]!.start! < 1440
                                  ? displayMinutes(times[i]!.start)
                                  : "",
                            })
                          }
                          className="block min-h-11 text-left text-sm font-medium text-primary"
                        >
                          {row.customTime
                            ? "Usar sequência automática"
                            : "Ajustar horário"}
                        </button>
                        {row.customTime && (
                          <label className="grid min-w-0 gap-1 text-sm">
                            Início do serviço {i + 1}
                            <input
                              className={field}
                              type="time"
                              required
                              step={60}
                              value={row.time}
                              onChange={(e) =>
                                update(i, { time: e.target.value })
                              }
                            />
                            <span className="text-xs text-muted-foreground">
                              Para atender simultaneamente, use o mesmo início
                              com profissionais diferentes. A disponibilidade
                              será conferida.
                            </span>
                          </label>
                        )}
                        {rows.length > 1 && (
                          <button
                            type="button"
                            className="block min-h-11 text-left text-sm text-danger"
                            onClick={() => {
                              reset();
                              setRows((all) => all.filter((_, j) => j !== i));
                            }}
                          >
                            Remover serviço {i + 1}
                          </button>
                        )}
                      </div>
                    ))}
                    {rows.length < 10 && (
                      <button
                        type="button"
                        className={field}
                        onClick={() => {
                          reset();
                          setRows((all) => [
                            ...all,
                            { serviceId: "", professionalId: "", time: "" },
                          ]);
                        }}
                      >
                        Adicionar outro serviço
                      </button>
                    )}
                    {canOverride && (
                      <>
                        <label className="flex min-h-11 items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={override}
                            onChange={(e) => {
                              reset();
                              setOverride(e.target.checked);
                            }}
                          />
                          Agendar em folga, intervalo ou fora do expediente
                        </label>
                        {override && (
                          <label className="grid gap-1 text-sm">
                            Motivo desta exceção
                            <input
                              className={field}
                              maxLength={200}
                              value={reason}
                              onChange={(e) => {
                                reset();
                                setReason(e.target.value);
                              }}
                            />
                          </label>
                        )}
                      </>
                    )}
                  </>
                )}
              </>
            )}
            {quote && (
              <>
                <p className="text-sm">
                  {newClient
                    ? name
                    : (chosen?.name ??
                      options.find((c) => c.id === clientId)?.name)}{" "}
                  · {date.split("-").reverse().join("/")}
                </p>
                <VisitSummary plan={quote.plan} />
                {override && (
                  <p className="rounded-xl border border-warning/60 p-3 text-sm text-foreground">
                    Exceção de jornada: {reason}
                  </p>
                )}
                <button
                  type="button"
                  className={field}
                  onClick={() => setQuote(null)}
                >
                  Editar visita
                </button>
              </>
            )}
            {error && (
              <p
                ref={errorRef}
                role="alert"
                className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger"
              >
                {error}
              </p>
            )}
          </fieldset>
        </div>
        <div className="shrink-0 border-t border-border bg-card pt-3">
          <button
            type="button"
            disabled={pending}
            onClick={() => void submit()}
            className="min-h-12 w-full rounded-xl bg-primary px-4 font-semibold text-primary-foreground shadow-lg disabled:opacity-40"
          >
            {pending
              ? "Conferindo…"
              : quote
                ? "Confirmar todos os serviços"
                : stage === "client"
                  ? "Escolher serviços"
                  : "Revisar visita"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
