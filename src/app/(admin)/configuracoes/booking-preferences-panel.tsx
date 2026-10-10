"use client";
import { useEffect, useState, useTransition } from "react";
import {
  loadBookingPreferences,
  saveBookingPreferences,
} from "./booking-preference-actions";
import { buttonVariants } from "@/components/ui/button";
import { checkboxClass, checkRowClass, controlClass, labelClass, noteClass, selectClass } from "./settings-ui";
type Data = Awaited<ReturnType<typeof loadBookingPreferences>>;
const fieldLabel = "grid gap-1.5";
const fieldText = labelClass;
export function BookingPreferencesPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [service, setService] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    let live = true;
    loadBookingPreferences()
      .then((v) => {
        if (live) setData(v);
      })
      .catch(() => {
        if (live) setMessage("Falha ao carregar configurações.");
      });
    return () => {
      live = false;
    };
  }, []);
  if (!data)
    return <p role="status" className="rounded-[14px] border border-border bg-card p-4 text-sm text-muted-foreground">{message || "Carregando preferências…"}</p>;
  const preferences = data.preferences;
  return (
    <fieldset
      disabled={pending}
      aria-label="Preferências de agendamento"
      className="flex min-w-0 flex-col gap-3.5 rounded-[14px] border border-border bg-card p-4"
    >
      <label className={fieldLabel}>
        <span className={fieldText}>Sugestões de horários</span>
        <select
          className={selectClass}
          value={preferences.slotMode}
          onChange={(e) =>
            setData({
              ...data,
              preferences: {
                ...preferences,
                slotMode: e.target.value as "ALL" | "FIT",
              },
            })
          }
        >
          <option value="ALL">Mostrar horários normalmente</option>
          <option value="FIT">
            Destacar melhores encaixes e manter demais horários
          </option>
        </select>
      </label>
      <label className={fieldLabel}>
        <span className={fieldText}>Intervalo de retorno padrão (dias)</span>
        <input
          className={`${controlClass} tabular-nums`}
          type="number"
          min={1}
          max={365}
          value={preferences.returnDays}
          onChange={(e) =>
            setData({
              ...data,
              preferences: {
                ...preferences,
                returnDays: Number(e.target.value),
              },
            })
          }
        />
      </label>
      <p className={`${noteClass} -mt-2`}>
        O histórico de visitas concluídas orienta o retorno. Este intervalo é
        usado quando ainda não há histórico suficiente.
      </p>
      <label className={fieldLabel}>
        <span className={fieldText}>Configurar um serviço</span>
        <select
          className={selectClass}
          value={service}
          onChange={(e) => setService(e.target.value)}
        >
          <option value="">Escolher serviço…</option>
          {data.services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {service && (
        <>
          <label className={fieldLabel}>
            <span className={fieldText}>Intervalo de retorno deste serviço (dias)</span>
            <input
              className={`${controlClass} tabular-nums`}
              type="number"
              min={1}
              max={365}
              value={
                preferences.serviceReturnDays[service] ?? preferences.returnDays
              }
              onChange={(e) =>
                setData({
                  ...data,
                  preferences: {
                    ...preferences,
                    serviceReturnDays: {
                      ...preferences.serviceReturnDays,
                      [service]: Number(e.target.value),
                    },
                  },
                })
              }
            />
          </label>
          <fieldset className="max-h-64 overflow-y-auto rounded-xl border border-border-strong px-3 py-2">
            <legend className="px-1.5 text-sm font-medium text-muted-foreground">
              Complementos oferecidos junto deste serviço
            </legend>
            {data.services
              .filter((s) => s.id !== service)
              .map((s) => (
                <label
                  key={s.id}
                  className={checkRowClass}
                >
                  <input
                    type="checkbox"
                    className={checkboxClass}
                    checked={(preferences.addons[service] ?? []).includes(s.id)}
                    onChange={(e) => {
                      const old = preferences.addons[service] ?? [];
                      setData({
                        ...data,
                        preferences: {
                          ...preferences,
                          addons: {
                            ...preferences.addons,
                            [service]: e.target.checked
                              ? [...old, s.id]
                              : old.filter((id) => id !== s.id),
                          },
                        },
                      });
                    }}
                  />
                  {s.name}
                </label>
              ))}
          </fieldset>
          <p className={`${noteClass} -mt-2`}>
            Complementos usam os preços e durações cadastrados e são escolhidos
            pelo cliente.
          </p>
          <fieldset className="max-h-64 overflow-y-auto rounded-xl border border-border-strong px-3 py-2">
            <legend className="px-1.5 text-sm font-medium text-muted-foreground">Pode ser feito ao mesmo tempo com</legend>
            <p className={`${noteClass} mb-1`}>Autoriza o cliente a combinar estes serviços simultaneamente, com profissionais diferentes e disponíveis.</p>
            {data.services.filter(s => s.id !== service).map(s => <label key={s.id} className={checkRowClass}><input type="checkbox" className={checkboxClass} checked={(preferences.simultaneousPairs ?? []).some(pair => pair.includes(service) && pair.includes(s.id))} onChange={e => {
              const remaining = (preferences.simultaneousPairs ?? []).filter(pair => !(pair.includes(service) && pair.includes(s.id)));
              setData({ ...data, preferences: { ...preferences, simultaneousPairs: e.target.checked ? [...remaining, [service, s.id]] : remaining } });
            }} />{s.name}</label>)}
          </fieldset>
        </>
      )}
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
      <button
        disabled={pending}
        className={`${buttonVariants()} self-start`}
        onClick={() =>
          startTransition(async () => {
            try {
              await saveBookingPreferences(preferences);
              setMessage("Preferências salvas.");
            } catch (e) {
              setMessage(
                e instanceof Error ? e.message : "Não foi possível salvar.",
              );
            }
          })
        }
      >
        {pending ? "Salvando…" : "Salvar preferências"}
      </button>
    </fieldset>
  );
}
