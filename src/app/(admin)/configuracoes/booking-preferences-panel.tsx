"use client";
import { useEffect, useState, useTransition } from "react";
import {
  loadBookingPreferences,
  saveBookingPreferences,
} from "./booking-preference-actions";
type Data = Awaited<ReturnType<typeof loadBookingPreferences>>;
const field =
  "min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm";
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
    return <p role="status">{message || "Carregando preferências…"}</p>;
  const preferences = data.preferences;
  return (
    <fieldset
      disabled={pending}
      className="space-y-5 rounded-xl border border-border bg-card p-4"
    >
      <label className="grid gap-2 text-sm font-medium">
        Sugestões de horários
        <select
          className={field}
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
      <label className="grid gap-2 text-sm font-medium">
        Intervalo de retorno padrão (dias)
        <input
          className={field}
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
      <p className="text-xs text-muted-foreground">
        O histórico de visitas concluídas orienta o retorno. Este intervalo é
        usado quando ainda não há histórico suficiente.
      </p>
      <label className="grid gap-2 text-sm font-medium">
        Configurar um serviço
        <select
          className={field}
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
          <label className="grid gap-2 text-sm">
            Intervalo de retorno deste serviço (dias)
            <input
              className={field}
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
          <fieldset className="max-h-64 overflow-y-auto rounded-lg border border-border p-3">
            <legend className="px-2 text-sm font-semibold">
              Complementos oferecidos junto deste serviço
            </legend>
            {data.services
              .filter((s) => s.id !== service)
              .map((s) => (
                <label
                  key={s.id}
                  className="flex min-h-11 items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
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
          <p className="text-xs text-muted-foreground">
            Complementos usam os preços e durações cadastrados e são escolhidos
            pelo cliente.
          </p>
          <fieldset className="max-h-64 overflow-y-auto rounded-lg border border-border p-3">
            <legend className="px-2 text-sm font-semibold">Pode ser feito ao mesmo tempo com</legend>
            <p className="mb-2 text-xs text-muted-foreground">Autoriza o cliente a combinar estes serviços simultaneamente, com profissionais diferentes e disponíveis.</p>
            {data.services.filter(s => s.id !== service).map(s => <label key={s.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={(preferences.simultaneousPairs ?? []).some(pair => pair.includes(service) && pair.includes(s.id))} onChange={e => {
              const remaining = (preferences.simultaneousPairs ?? []).filter(pair => !(pair.includes(service) && pair.includes(s.id)));
              setData({ ...data, preferences: { ...preferences, simultaneousPairs: e.target.checked ? [...remaining, [service, s.id]] : remaining } });
            }} />{s.name}</label>)}
          </fieldset>
        </>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      <button
        disabled={pending}
        className="min-h-11 rounded-lg bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-50"
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
