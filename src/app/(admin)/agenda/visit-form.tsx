"use client";
import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VisitSummary } from "@/components/visit-summary";
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
    [rows, setRows] = useState<
      { serviceId: string; professionalId: string; time: string }[]
    >([{ serviceId: "", professionalId: "", time: "" }]);
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
    const min = (value: string) =>
      Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
    const starts: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      starts.push(
        row.time
          ? min(row.time)
          : i === 0
            ? min(time)
            : starts[i - 1]! +
              (services.find((s) => s.id === rows[i - 1]!.serviceId)
                ?.durationMin ?? 0),
      );
    }
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
    if (
      rows.some((r) => !r.serviceId || !r.professionalId) ||
      (!newClient && !clientId) ||
      (newClient && name.trim().length < 2) ||
      (override && reason.trim().length < 3)
    ) {
      setError(
        "Preencha o cliente, cada serviço e profissional e o motivo da exceção, se necessário.",
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
        aria-label="Uma visita, vários serviços"
        aria-describedby={undefined}
        className="max-h-[90dvh] max-w-lg overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>Uma visita, vários serviços</DialogTitle>
        </DialogHeader>
        <fieldset disabled={pending} className="min-w-0 space-y-4">
          <button
            type="button"
            className="min-h-11 text-sm text-primary"
            onClick={onBack}
          >
            ← Agendamento simples ou recorrente
          </button>
          {!quote && (
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
                          options.find((c) => c.id === e.target.value) ?? null,
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
                    step={60}
                    value={time}
                    onChange={(e) => {
                      reset();
                      setTime(e.target.value);
                    }}
                  />
                </label>
              </div>
              {rows.map((row, i) => (
                <div
                  key={i}
                  className="space-y-3 rounded-xl border border-border p-3"
                >
                  <label className="grid gap-1 text-sm">
                    Serviço {i + 1}
                    <select
                      className={field}
                      value={row.serviceId}
                      onChange={(e) => {
                        const pros = professionals.filter((p) =>
                          p.serviceIds.includes(e.target.value),
                        );
                        update(i, {
                          serviceId: e.target.value,
                          professionalId: pros.length === 1 ? pros[0]!.id : "",
                        });
                      }}
                    >
                      <option value="">Selecione o serviço</option>
                      {services
                        .filter((s) =>
                          professionals.some((p) =>
                            p.serviceIds.includes(s.id),
                          ),
                        )
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} · {s.durationMin} min
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm">
                    Profissional do serviço {i + 1}
                    <select
                      className={field}
                      value={row.professionalId}
                      onChange={(e) =>
                        update(i, { professionalId: e.target.value })
                      }
                    >
                      <option value="">Selecione</option>
                      {professionals
                        .filter((p) => p.serviceIds.includes(row.serviceId))
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm">
                    Horário próprio (opcional)
                    <input
                      className={field}
                      type="time"
                      step={60}
                      value={row.time}
                      onChange={(e) => update(i, { time: e.target.value })}
                    />
                    <span className="text-xs text-muted-foreground">
                      Vazio:{" "}
                      {i === 0
                        ? "usar o início da visita"
                        : "começar após o serviço anterior"}
                      . Use o mesmo horário para serviços simultâneos.
                    </span>
                  </label>
                  {rows.length > 1 && (
                    <button
                      type="button"
                      className="min-h-11 text-sm text-destructive"
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
                <p className="text-sm text-warning">
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
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={() => void submit()}
            className="min-h-12 w-full rounded-xl bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-40"
          >
            {pending
              ? "Conferindo…"
              : quote
                ? "Confirmar todos os serviços"
                : "Revisar visita"}
          </button>
        </fieldset>
      </DialogContent>
    </Dialog>
  );
}
