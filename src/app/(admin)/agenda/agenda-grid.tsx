"use client";

import { useState } from "react";
import { minutesToHHMM, formatMoney } from "@/lib/utils";
import {
  AppointmentDialog,
  type ProOption,
  type ServiceOption,
  type ClientOption,
} from "./appointment-form";

const SLOT_MIN = 30;
const DAY_START = 8 * 60;
const DAY_END = 20 * 60;
const PX_PER_MIN = 1.6;

export type Appointment = {
  id: string;
  professionalId: string;
  startAt: string;
  endAt: string;
  priceCents: number;
  status: string;
  clientName: string;
  serviceName: string;
  serviceColor: string | null;
};

export type Professional = {
  id: string;
  name: string;
  colorHex: string | null;
  serviceIds: string[];
};

export function AgendaGrid({
  date,
  professionals,
  appointments,
  services,
  clients,
}: {
  date: string; // YYYY-MM-DD
  professionals: Professional[];
  appointments: Appointment[];
  services: ServiceOption[];
  clients: ClientOption[];
}) {
  const [dialog, setDialog] = useState<{
    open: boolean;
    slotStartISO: string;
    professionalId: string;
  } | null>(null);

  const slots: number[] = [];
  for (let m = DAY_START; m < DAY_END; m += SLOT_MIN) slots.push(m);

  const proOptions: ProOption[] = professionals.map((p) => ({
    id: p.id,
    name: p.name,
    serviceIds: p.serviceIds,
  }));

  function openSlot(proId: string, minutes: number) {
    const start = new Date(`${date}T00:00:00`);
    start.setHours(0, minutes, 0, 0);
    setDialog({ open: true, slotStartISO: start.toISOString(), professionalId: proId });
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <div className="flex min-w-max">
          <div className="w-16 shrink-0 border-r bg-muted/30">
            <div className="h-14 border-b" />
            {slots.map((m) => (
              <div
                key={m}
                style={{ height: SLOT_MIN * PX_PER_MIN }}
                className="border-b px-2 py-1 text-[11px] text-muted-foreground"
              >
                {minutesToHHMM(m)}
              </div>
            ))}
          </div>

          {professionals.map((pro) => {
            const proAppts = appointments.filter((a) => a.professionalId === pro.id);
            return (
              <div key={pro.id} className="relative w-48 shrink-0 border-r last:border-r-0">
                <div className="sticky top-0 flex h-14 items-center gap-2 border-b bg-background px-3">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: pro.colorHex ?? "hsl(var(--primary))" }}
                  />
                  <span className="truncate text-sm font-medium">{pro.name}</span>
                </div>

                <div className="relative">
                  {slots.map((m) => (
                    <button
                      key={m}
                      onClick={() => openSlot(pro.id, m)}
                      style={{ height: SLOT_MIN * PX_PER_MIN }}
                      className="block w-full border-b border-border/50 text-left transition hover:bg-primary/5 focus:bg-primary/10 focus:outline-none"
                      aria-label={`Agendar às ${minutesToHHMM(m)} com ${pro.name}`}
                    />
                  ))}

                  {proAppts.map((a) => {
                    const start = new Date(a.startAt);
                    const end = new Date(a.endAt);
                    const startMin = start.getHours() * 60 + start.getMinutes();
                    const endMin = end.getHours() * 60 + end.getMinutes();
                    const top = (startMin - DAY_START) * PX_PER_MIN;
                    const height = (endMin - startMin) * PX_PER_MIN;
                    if (top < 0 || top > (DAY_END - DAY_START) * PX_PER_MIN) return null;

                    return (
                      <div
                        key={a.id}
                        className="pointer-events-none absolute inset-x-1 rounded-md border p-2 text-xs shadow-sm"
                        style={{
                          top,
                          height,
                          background: `${a.serviceColor ?? "#a13860"}22`,
                          borderColor: a.serviceColor ?? "#a13860",
                        }}
                      >
                        <p className="truncate font-medium">{a.clientName}</p>
                        <p className="truncate text-muted-foreground">{a.serviceName}</p>
                        <p className="mt-1 text-[10px] font-medium">
                          {formatMoney(a.priceCents)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {professionals.length === 0 && (
            <div className="flex flex-1 items-center justify-center p-16 text-sm text-muted-foreground">
              Cadastre profissionais para ver a agenda.
            </div>
          )}
        </div>
      </div>

      {dialog && (
        <AppointmentDialog
          open={dialog.open}
          onOpenChange={(o) => setDialog((prev) => (prev ? { ...prev, open: o } : null))}
          slotStartISO={dialog.slotStartISO}
          professionalId={dialog.professionalId}
          professionals={proOptions}
          services={services}
          clients={clients}
        />
      )}
    </>
  );
}
