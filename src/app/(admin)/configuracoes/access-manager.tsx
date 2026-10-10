"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconButton } from "@/components/ui/icon-button";
import { UserPlus, Trash2, Loader2, RotateCw, ShieldCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { labelClass, noteClass, selectClass } from "./settings-ui";
import {
  inviteMember,
  changeMemberRole,
  removeMember,
  resendTeamInvite,
  cancelTeamInvite,
} from "./actions";

export type Member = {
  userId: string;
  name: string;
  email: string;
  role: string;
  isSelf: boolean;
};

export type PendingTeamInvite = {
  id: string;
  name: string;
  email: string;
  role: string;
  deliveryStatus: "SENDING" | "SENT" | "FAILED";
  sentAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  OWNER: "Dono",
  MANAGER: "Gerente",
  PROFESSIONAL: "Profissional",
  RECEPTIONIST: "Recepção",
};
const initials = (name: string) => name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
const pill = "inline-flex min-h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium";
const pillTone = {
  neutral: "bg-muted text-muted-foreground",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger",
} as const;

export function AccessManager({
  members,
  canManage,
  invitesEnabled,
  pendingInvites,
}: {
  members: Member[];
  canManage: boolean;
  invitesEnabled: boolean;
  pendingInvites: PendingTeamInvite[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteToCancel, setInviteToCancel] = useState<PendingTeamInvite | null>(null);
  const [inviteResult, setInviteResult] = useState<{
    email: string;
    status: "SENT" | "FAILED";
  } | null>(null);

  function run(fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro");
      }
    });
  }

  function onInvite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const payload = { name: String(f.get("name")), email: String(f.get("email")), role: String(f.get("role")) };
    setError(null);
    startTransition(async () => {
      try {
        const result = await inviteMember(payload);
        setInviteResult({
          email: result.recipientEmail,
          status: result.deliveryStatus,
        });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao convidar");
      }
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-3.5 lg:gap-4">
      <div className="flex gap-2.5 rounded-xl border border-border-strong bg-card px-3.5 py-3 text-sm leading-relaxed">
        <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p>{canManage
          ? "Só o dono convida pessoas, troca papéis e remove acessos. O salão precisa de ao menos um dono, e ninguém remove o próprio acesso."
          : "Só o dono do salão convida pessoas, troca papéis e remove acessos. Aqui você vê quem tem acesso e com qual papel."}</p>
      </div>

    <div className="overflow-hidden rounded-[14px] border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-4 pb-3 pt-4">
        <h3 className="min-w-0 flex-auto text-sm font-semibold">Acessos da equipe</h3>
        {canManage && invitesEnabled && (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setError(null);
              setInviteResult(null);
              setOpen(true);
            }}
          >
            <UserPlus aria-hidden="true" className="h-4 w-4" /> Convidar
          </Button>
        )}
        <p className={cn(noteClass, "basis-full")}>Quem pode entrar no painel e com qual papel.</p>
      </div>

      {error && <p className="mx-4 mb-3 rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-3 text-sm">{error}</p>}
      {canManage && !invitesEnabled && (
        <p className="mx-4 mb-3 rounded-xl border border-border-strong bg-background px-3.5 py-3 text-xs text-muted-foreground">
          Convites por e-mail estão em contingência e ainda não estão disponíveis.
        </p>
      )}

      <div className="divide-y divide-border border-t border-border">
        {members.map((m) => (
          <div key={m.userId} className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-4 py-3 sm:flex-nowrap">
            <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-foreground">
              {initials(m.name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium [overflow-wrap:anywhere]">
                {m.name} {m.isSelf && <span className="text-xs font-normal text-muted-foreground">(você)</span>}
              </p>
              <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{m.email}</p>
            </div>
            {(canManage && !m.isSelf) ? (
              <div className="flex basis-full items-center gap-1.5 pl-[52px] sm:basis-auto sm:pl-0">
                <select
                  aria-label={`Papel de ${m.name}`}
                  value={m.role}
                  disabled={pending}
                  onChange={(e) => run(() => changeMemberRole(m.userId, e.target.value))}
                  className={cn(selectClass, "flex-1 sm:w-auto sm:flex-none")}
                >
                  {Object.keys(ROLE_LABEL).map((r) => (
                    <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                  ))}
                </select>
                <IconButton
                  label={`Remover acesso de ${m.name}`}
                  onClick={() => run(() => removeMember(m.userId))}
                  disabled={pending}
                  className="shrink-0 hover:bg-danger/10 hover:text-danger"
                >
                  {pending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Trash2 aria-hidden="true" className="h-4 w-4" />}
                </IconButton>
              </div>
            ) : (
              <span className={cn(pill, pillTone.neutral, "ml-[52px] sm:ml-0")}>
                {ROLE_LABEL[m.role] ?? m.role}
              </span>
            )}
          </div>
        ))}
      </div>

      {pendingInvites.length > 0 && (
        <div className="border-t border-border p-4">
          <h4 className="text-sm font-semibold">Convites pendentes</h4>
          <div className="mt-2.5 space-y-2">
            {pendingInvites.map((invite) => {
              const expired = new Date(invite.expiresAt).getTime() <= Date.now();
              const cancelled = Boolean(invite.revokedAt);
              const state = cancelled
                ? { label: "Cancelado", tone: pillTone.neutral }
                : expired
                  ? { label: "Expirado", tone: pillTone.warning }
                  : { label: "Pendente", tone: pillTone.warning };
              const delivery = cancelled
                ? null
                : invite.deliveryStatus === "FAILED"
                  ? { label: "Falha no envio", tone: pillTone.danger }
                  : invite.deliveryStatus === "SENDING"
                    ? { label: "Enviando", tone: pillTone.neutral }
                    : { label: "Enviado", tone: pillTone.neutral };
              return (
                <div key={invite.id} className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-background px-3.5 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium [overflow-wrap:anywhere]">{invite.name}</p>
                      <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{invite.email}</p>
                    </div>
                    {canManage && !cancelled && (
                      <div className="-my-1 -mr-1.5 flex shrink-0">
                        <IconButton
                          label={`Reenviar convite para ${invite.name}`}
                          disabled={pending}
                          onClick={() =>
                            run(async () => {
                              const result = await resendTeamInvite(invite.id);
                              if (result.deliveryStatus !== "SENT") {
                                throw new Error("O provedor não confirmou o reenvio.");
                              }
                            })
                          }
                        >
                          <RotateCw aria-hidden="true" className="h-4 w-4" />
                        </IconButton>
                        <IconButton
                          label={`Cancelar convite de ${invite.name}`}
                          disabled={pending || expired}
                          onClick={() => setInviteToCancel(invite)}
                          className="hover:bg-danger/10 hover:text-danger"
                        >
                          <X aria-hidden="true" className="h-4 w-4" />
                        </IconButton>
                      </div>
                    )}
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="whitespace-nowrap text-xs text-muted-foreground">{ROLE_LABEL[invite.role] ?? invite.role}</span>
                    <span className={cn(pill, state.tone)}>{state.label}</span>
                    {delivery && <span className={cn(pill, delivery.tone)}>{delivery.label}</span>}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Convidar para a equipe</DialogTitle>
          </DialogHeader>
          {inviteResult ? (
            <div className="grid gap-4">
              <div className={`rounded-xl border px-3.5 py-3 ${
                inviteResult.status === "SENT"
                  ? "border-success/30 bg-success/10"
                  : "border-danger/40 bg-danger/10"
              }`}>
                <p className="text-sm font-medium">
                  {inviteResult.status === "SENT"
                    ? `Convite enviado para ${inviteResult.email}`
                    : "Convite salvo, mas o envio falhou"}
                </p>
                <p className={cn(noteClass, "mt-1")}>
                  {inviteResult.status === "SENT"
                    ? "O acesso só será criado depois que a pessoa aceitar pelo próprio e-mail."
                    : "Use a opção de reenvio no convite pendente depois de corrigir a configuração do provedor."}
                </p>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline">Concluir</Button>
                </DialogClose>
              </DialogFooter>
            </div>
          ) : (
          <form onSubmit={onInvite} className="grid gap-3.5">
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor="invite-member-name" className={labelClass}>Nome</label>
              <Input id="invite-member-name" name="name" required autoFocus />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor="invite-member-email" className={labelClass}>Email</label>
              <Input id="invite-member-email" name="email" type="email" required />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor="invite-member-role" className={labelClass}>Papel</label>
              <select id="invite-member-role" name="role" defaultValue="RECEPTIONIST" className={selectClass}>
                {Object.keys(ROLE_LABEL).map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
            </div>
            <p className={noteClass}>
              Um e-mail de uso único será enviado. Para conta nova, a própria
              pessoa definirá a senha; contas existentes mantêm a senha atual.
            </p>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline" type="button">Cancelar</Button></DialogClose>
              <Button type="submit" disabled={pending}>{pending ? "Enviando…" : "Enviar convite"}</Button>
            </DialogFooter>
          </form>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(inviteToCancel)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setInviteToCancel(null);
        }}
        title="Cancelar convite da equipe?"
        description={inviteToCancel ? `O convite de ${inviteToCancel.name} deixará de ser válido. A pessoa poderá receber um novo convite depois.` : undefined}
        confirmLabel="Cancelar convite"
        onConfirm={() => {
          if (!inviteToCancel) return;
          const invite = inviteToCancel;
          setInviteToCancel(null);
          run(() => cancelTeamInvite(invite.id));
        }}
        pending={pending}
      />
    </div>
  );
}
