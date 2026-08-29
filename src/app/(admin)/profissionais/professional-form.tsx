"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, MailWarning, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageUpload } from "@/components/ui/image-upload";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  const editing = !!professional;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState(professional?.avatarUrl ?? "");
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
    setError(null);
    const form = new FormData(e.currentTarget);
    const commonPayload = {
      name: String(form.get("name")),
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
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
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
            disabled={!invitesEnabled}
            title={
              invitesEnabled
                ? undefined
                : "Convites por e-mail temporariamente indisponíveis"
            }
          >
            <Plus className="h-4 w-4" /> Adicionar
          </Button>
        ))}
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar profissional" : "Novo profissional"}</DialogTitle>
          <DialogDescription>
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
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">Concluir</Button>
              </DialogClose>
            </DialogFooter>
          </div>
        ) : (
        <form onSubmit={onSubmit} className="grid gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Nome</label>
            <Input name="name" defaultValue={professional?.name} required autoFocus />
          </div>

          {!editing && (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium">Email</label>
                <Input name="email" type="email" required />
              </div>
              <p className="text-xs text-muted-foreground">
                O acesso será liberado por um link de uso único. Nenhuma senha
                temporária será criada ou exibida.
              </p>
            </>
          )}

          {editing ? (
            <div className="rounded-xl border border-border bg-muted/20 p-3">
              <p className="text-sm font-medium">Foto de perfil</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Aparece para os clientes ao escolher o profissional e na equipe do salão.
              </p>
              <div className="mt-3 max-w-40">
                <ImageUpload
                  value={avatarUrl}
                  onChange={setAvatarUrl}
                  folder="profiles"
                  aspectRatio="square"
                />
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Depois de aceitar o convite, o profissional também poderá adicionar a foto em Configurações &gt; Meu perfil.
            </p>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium">Bio</label>
            <Input
              name="bio"
              defaultValue={professional?.bio ?? ""}
              placeholder="Especialista em coloração"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Comissão (%)</label>
              <Input
                name="commissionPct"
                type="number"
                min={0}
                max={100}
                step={1}
                defaultValue={professional?.commissionPct ?? 40}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Cor na agenda</label>
              <Input
                name="colorHex"
                type="color"
                defaultValue={professional?.colorHex ?? "#2ECC8B"}
                className="h-10 w-20 cursor-pointer p-1"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Meta mensal (R$)</label>
            <Input
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
              <p className="mb-2 text-sm font-medium">Serviços que realiza</p>
              <div className="grid gap-1 rounded-md border p-3 sm:grid-cols-2">
                {services.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Cadastre serviços primeiro.
                  </p>
                )}
                {services.map((s) => (
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

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
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
