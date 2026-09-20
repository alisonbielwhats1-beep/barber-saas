"use client";
import { useFormOperation } from "../use-form-operation";

import { FormSection } from "../form-section";
import { useRef, useState } from "react";
import { CheckCircle2, MailWarning, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageUpload } from "@/components/ui/image-upload";
import { Input } from "@/components/ui/input";
import { formatPhoneBR } from "@/lib/phone";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../form-dialog";
import {
  createProfessional,
  updateProfessional,
  setProfessionalServices,
} from "./actions";

type Service = { id: string; name: string; colorHex: string | null };

type EditablePro = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  bio: string | null;
  colorHex: string | null;
  avatarUrl: string | null;
  commissionPct: number;
  monthlyGoalCents: number;
  serviceIds: string[];
};

type Props = {
  services: Service[];
  invitesEnabled: boolean;
  professional?: EditablePro;
  trigger?: React.ReactNode;
};

export function ProfessionalForm({
  services,
  invitesEnabled,
  professional,
  trigger,
}: Props) {
  const [serviceSearch, setServiceSearch] = useState("");
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const visibleServices = services.filter(service => normalize(service.name).includes(normalize(serviceSearch)));
  const editing = !!professional;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useFormOperation();
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState(professional?.avatarUrl ?? "");
  const [phone, setPhone] = useState(formatPhoneBR(professional?.phone ?? ""));
  const [inviteResult, setInviteResult] = useState<{
    email: string;
    status: "SENT" | "FAILED";
  } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(professional?.serviceIds ?? services.map((s) => s.id)),
  );

  function toggleService(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setError(null);
    const form = new FormData(e.currentTarget);
    const firstName = String(form.get("firstName") ?? "").trim();
    const lastName = String(form.get("lastName") ?? "").trim();
    const commonPayload = {
      name: [firstName, lastName].filter(Boolean).join(" "),
      phone,
      bio: (form.get("bio") as string) || null,
      colorHex: (form.get("colorHex") as string) || null,
      commissionPct: Number(form.get("commissionPct") ?? 0),
      monthlyGoalCents: Math.round(Number(form.get("goal") || 0) * 100),
    };

    startTransition(async () => {
      try {
        if (editing) {
          await updateProfessional(professional!.id, { ...commonPayload, avatarUrl });
          await setProfessionalServices(professional!.id, Array.from(selected));
        } else {
          const result = await createProfessional({
            ...commonPayload,
            email: String(form.get("email")),
            avatarUrl,
            serviceIds: Array.from(selected),
          });
          setInviteResult({
            email: result.recipientEmail,
            status: result.deliveryStatus,
          });
          return;
        }
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao salvar");
      } finally { submitting.current = false; }
    });
  }

  return (
    <Dialog
      pending={pending}
      dirtyKey={JSON.stringify([avatarUrl, phone, Array.from(selected).sort()])}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setPhone(formatPhoneBR(professional?.phone ?? ""));
          setAvatarUrl(professional?.avatarUrl ?? "");
          setSelected(new Set(professional?.serviceIds ?? services.map(s => s.id)));
          setServiceSearch("");
          setInviteResult(null);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (editing ? (
          <Button variant="ghost" size="sm">Editar</Button>
        ) : (
          <Button
            className="admin-directory-create" aria-label="Adicionar"
            disabled={!invitesEnabled}
            title={
              invitesEnabled
                ? undefined
                : "Convites por e-mail temporariamente indisponíveis"
            }
          >
            <Plus className="h-5 w-5" /> <span className="hidden md:inline">Adicionar</span>
          </Button>
        ))}
      </DialogTrigger>
      <DialogContent className="admin-form-dialog professional-edit-dialog max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar profissional" : "Novo profissional"}</DialogTitle>
          <DialogDescription className="sr-only">
            {editing
              ? "Ajuste dados, comissão e quais serviços esse profissional realiza."
              : "Se o email já existe, o profissional é vinculado sem duplicar conta."}
          </DialogDescription>
        </DialogHeader>

        {inviteResult ? (
          <div className="grid gap-4">
            <div className={`rounded-xl border p-4 ${
              inviteResult.status === "SENT"
                ? "border-success/25 bg-success/5"
                : "border-destructive/25 bg-destructive/5"
            }`}>
              <p className="flex items-center gap-2 text-sm font-medium">
                {inviteResult.status === "SENT" ? (
                  <CheckCircle2 className="h-4 w-4 text-success" />
                ) : (
                  <MailWarning className="h-4 w-4 text-destructive" />
                )}
                {inviteResult.status === "SENT"
                  ? `Convite enviado para ${inviteResult.email}`
                  : "O convite foi salvo, mas o e-mail não foi enviado"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {inviteResult.status === "SENT"
                  ? "A pessoa aparecerá como convite pendente e só será ativada depois do aceite."
                  : "Confira a configuração do e-mail e use “Reenviar convite” no card pendente. Nenhum acesso foi ativado."}
              </p>
            </div>
            <DialogFooter data-form-footer>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Concluir</Button>
            </DialogFooter>
          </div>
        ) : (
        <form onSubmit={onSubmit} className="grid gap-6">
          <section aria-labelledby="professional-personal-data" className="grid gap-4 rounded-2xl border border-border bg-surface-1/50 p-4 sm:grid-cols-[9rem_1fr] sm:p-5">
            <div>
              <h3 id="professional-personal-data" className="text-sm font-semibold">Perfil</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Dados que identificam o profissional para a equipe e para os clientes.</p>
              <div className="mt-4 max-w-36">
                <ImageUpload value={avatarUrl} onChange={setAvatarUrl} folder="profiles" aspectRatio="square" />
              </div>
            </div>

            <div className="grid content-start gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="professional-first-name" className="mb-1 block text-sm font-medium">Nome <span aria-hidden="true">*</span></label>
                <Input id="professional-first-name" name="firstName" defaultValue={professional?.name.trim().split(/\s+/)[0] ?? ""} required autoFocus />
              </div>
              <div>
                <label htmlFor="professional-last-name" className="mb-1 block text-sm font-medium">Sobrenome</label>
                <Input id="professional-last-name" name="lastName" defaultValue={professional?.name.trim().split(/\s+/).slice(1).join(" ") ?? ""} />
              </div>
              <div>
                <label htmlFor="professional-email" className="mb-1 block text-sm font-medium">E-mail <span aria-hidden="true">*</span></label>
                <Input id="professional-email" name="email" type="email" defaultValue={professional?.email} disabled={editing} required={!editing} autoComplete="email" />
              </div>
              <div>
                <label htmlFor="professional-phone" className="mb-1 block text-sm font-medium">Número de telefone</label>
                <div className="flex min-h-11 overflow-hidden rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
                  <span className="grid min-w-14 place-items-center border-r border-border px-3 text-sm text-muted-foreground">+55</span>
                  <input id="professional-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(formatPhoneBR(event.target.value))} placeholder="(11) 91234-5678" className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none" />
                </div>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground sm:col-span-2">
                {editing
                  ? "O e-mail de acesso não pode ser alterado por aqui. A pessoa pode atualizar foto e telefone no próprio perfil."
                  : "O profissional receberá um link de uso único e criará a própria senha. Se a conta já existir, os dados pessoais dela serão preservados."}
              </p>
            </div>
          </section>

          <FormSection title="Trabalho no estabelecimento" description="Apresentação, comissão, agenda e serviços" defaultOpen>
            <div>
              <h3 id="professional-work-data" className="text-sm font-semibold">Trabalho no estabelecimento</h3>
              <p className="mt-1 text-xs text-muted-foreground">Defina apresentação, agenda, comissão e serviços.</p>
            </div>

          <div>
            <label htmlFor="professional-bio" className="mb-1 block text-sm font-medium">Apresentação</label>
            <Input
              id="professional-bio"
              name="bio"
              defaultValue={professional?.bio ?? ""}
              placeholder="Especialista em coloração"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="professional-commission" className="mb-1 block text-sm font-medium">Comissão (%)</label>
              <Input
                id="professional-commission"
                name="commissionPct"
                type="number"
                min={0}
                max={100}
                step={1}
                defaultValue={professional?.commissionPct ?? 40}
              />
            </div>
            <div>
              <label htmlFor="professional-calendar-color" className="mb-1 block text-sm font-medium">Cor na agenda</label>
              <Input
                id="professional-calendar-color"
                name="colorHex"
                type="color"
                defaultValue={professional?.colorHex ?? "#2ECC8B"}
                className="h-10 w-20 cursor-pointer p-1"
              />
            </div>
          </div>
          <div>
            <label htmlFor="professional-monthly-goal" className="mb-1 block text-sm font-medium">Meta mensal (R$)</label>
            <Input
              id="professional-monthly-goal"
              name="goal"
              type="number"
              min={0}
              step="100"
              defaultValue={professional ? (professional.monthlyGoalCents / 100).toFixed(2) : "7000.00"}
              placeholder="Meta de faturamento no mês"
            />
          </div>

          <div>
            <div>
              <p className="mb-2 text-sm font-medium">Serviços que realiza · {selected.size} selecionados</p>
              {services.length > 6 && <Input data-draft-ignore aria-label="Buscar serviços do profissional" type="search" value={serviceSearch} onChange={e => setServiceSearch(e.target.value)} placeholder="Buscar serviços…" />}
              {services.length > 0 && visibleServices.length === 0 && <p role="status" className="text-sm">Nenhum serviço encontrado. As seleções foram mantidas.</p>}
              <div className="grid gap-1 rounded-md border p-3 sm:grid-cols-2">
                {services.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Cadastre serviços primeiro.
                  </p>
                )}
                {visibleServices.map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 transition hover:bg-muted/60"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={selected.has(s.id)}
                      onChange={() => toggleService(s.id)}
                    />
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: s.colorHex ?? "hsl(var(--primary))" }}
                    />
                    <span className="text-sm">{s.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          </FormSection>

          {error && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter data-form-footer>
            <DialogClose asChild>
              <Button variant="outline" type="button">Cancelar</Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Enviando…" : editing ? "Salvar" : "Enviar convite"}
            </Button>
          </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
