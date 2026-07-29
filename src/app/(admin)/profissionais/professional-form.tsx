"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  commissionPct: number;
  monthlyGoalCents: number;
  serviceIds: string[];
};

type Props = {
  services: Service[];
  professional?: EditablePro;
  trigger?: React.ReactNode;
};

export function ProfessionalForm({ services, professional, trigger }: Props) {
  const editing = !!professional;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [invitePath, setInvitePath] = useState<string | null>(null);
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(professional?.serviceIds ?? services.map((s) => s.id)),
  );

  function toggleService(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
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
          await updateProfessional(professional!.id, commonPayload);
          await setProfessionalServices(professional!.id, Array.from(selected));
        } else {
          const result = await createProfessional({
            ...commonPayload,
            email: String(form.get("email")),
          });
          setInvitePath(result.invitePath);
          setVerificationRequired(result.requiresEmailVerification);
          return;
        }
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao salvar");
      }
    });
  }

  async function copyInvite() {
    if (!invitePath) return;
    await navigator.clipboard.writeText(`${window.location.origin}${invitePath}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setInvitePath(null);
          setVerificationRequired(false);
          setCopied(false);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (editing ? (
          <Button variant="ghost" size="sm">Editar</Button>
        ) : (
          <Button>
            <Plus className="h-4 w-4" /> Adicionar
          </Button>
        ))}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar profissional" : "Novo profissional"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Ajuste dados, comissão e quais serviços esse profissional realiza."
              : "Se o email já existe, o profissional é vinculado sem duplicar conta."}
          </DialogDescription>
        </DialogHeader>

        {invitePath ? (
          <div className="grid gap-4">
            <div className="rounded-xl border border-success/25 bg-success/5 p-4">
              <p className="text-sm font-medium">
                {verificationRequired
                  ? "Cadastro aguardando verificação de e-mail"
                  : "Profissional criado, acesso pendente"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {verificationRequired
                  ? "A conta ainda não existe. Nenhum User, Membership ou Professional foi criado; o convite permanece bloqueado até existir verificação real de e-mail."
                  : "Copie o link agora. O profissional precisará entrar na própria conta para aceitar e só então será ativado."}
              </p>
            </div>
            {!verificationRequired && (
              <Button type="button" onClick={copyInvite} className="w-full gap-2">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Link copiado" : "Copiar link de uso único"}
              </Button>
            )}
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

          <div>
            <label className="mb-1 block text-sm font-medium">Bio</label>
            <Input
              name="bio"
              defaultValue={professional?.bio ?? ""}
              placeholder="Especialista em coloração"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
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

          {editing && (
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
          )}

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
              {pending ? "Salvando…" : editing ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
