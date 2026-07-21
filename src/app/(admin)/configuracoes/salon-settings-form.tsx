"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Check, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { updateSalonSettings } from "./actions";

type Salon = {
  name: string;
  address: string | null;
  phone: string | null;
  timezone: string;
  currency: string;
  openMinutes: number;
  closeMinutes: number;
  cancelPolicyHours: number;
  noShowFeeCents: number;
};

const TIMEZONES = ["America/Sao_Paulo", "America/Manaus", "America/Recife", "America/Fortaleza", "America/Cuiaba"];

function toHHMM(min: number) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
function toMin(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function SalonSettingsForm({ salon }: { salon: Salon }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const f = new FormData(e.currentTarget);
    const payload = {
      name: String(f.get("name")),
      address: (f.get("address") as string) || null,
      phone: (f.get("phone") as string) || null,
      timezone: String(f.get("timezone")),
      currency: String(f.get("currency")),
      openMinutes: toMin(String(f.get("open"))),
      closeMinutes: toMin(String(f.get("close"))),
      cancelPolicyHours: Number(f.get("cancelPolicyHours")),
      noShowFeeCents: Math.round(Number(f.get("noShowFee") || 0) * 100),
    };
    startTransition(async () => {
      try {
        await updateSalonSettings(payload);
        setSaved(true);
        toast("Configurações salvas", "success");
        router.refresh();
        setTimeout(() => setSaved(false), 2500);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro ao salvar";
        setError(msg);
        toast(msg, "error");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Section title="Identidade do salão">
        <Field label="Nome do salão">
          <Input name="name" defaultValue={salon.name} required />
        </Field>
        <Field label="Endereço">
          <Input name="address" defaultValue={salon.address ?? ""} placeholder="Rua, número — bairro, cidade" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Telefone / WhatsApp">
            <Input name="phone" defaultValue={salon.phone ?? ""} placeholder="(11) 90000-0000" />
          </Field>
          <Field label="Moeda">
            <select name="currency" defaultValue={salon.currency} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="BRL">Real (R$)</option>
              <option value="USD">Dólar (US$)</option>
              <option value="EUR">Euro (€)</option>
            </select>
          </Field>
        </div>
        <Field label="Fuso horário">
          <select name="timezone" defaultValue={salon.timezone} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="Horário de funcionamento (padrão)">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Abertura">
            <Input name="open" type="time" defaultValue={toHHMM(salon.openMinutes)} />
          </Field>
          <Field label="Fechamento">
            <Input name="close" type="time" defaultValue={toHHMM(salon.closeMinutes)} />
          </Field>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Referência do salão. A disponibilidade real vem da jornada de cada profissional (em Profissionais → Horários).
        </p>
      </Section>

      <Section title="Política de cancelamento">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Antecedência mínima (horas)">
            <Input name="cancelPolicyHours" type="number" min={0} max={168} defaultValue={salon.cancelPolicyHours} />
          </Field>
          <Field label="Taxa de no-show (R$)">
            <Input name="noShowFee" type="number" min={0} step="0.01" defaultValue={(salon.noShowFeeCents / 100).toFixed(2)} />
          </Field>
        </div>
      </Section>

      {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando…</> : "Salvar alterações"}
        </Button>
        {saved && (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-success">
            <Check className="h-4 w-4" /> Salvo
          </span>
        )}
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h3 className="mb-4 text-[13px] font-semibold">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[13px] font-medium">{label}</label>
      {children}
    </div>
  );
}
