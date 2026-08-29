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
import { UserPlus, Trash2, Loader2, RotateCw, XCircle } from "lucide-react";
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
const ROLE_COLOR: Record<string, string> = {
  OWNER: "#2ECC8B",
  MANAGER: "#3B9EFF",
  PROFESSIONAL: "#A855F7",
  RECEPTIONIST: "#F59E0B",
};

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
    <div className="rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between p-5 pb-3">
        <div>
          <h3 className="text-[13px] font-semibold">Acessos da equipe</h3>
          <p className="text-[11px] text-muted-foreground">Quem pode entrar no painel e com qual papel.</p>
        </div>
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
            <UserPlus className="h-3.5 w-3.5" /> Convidar
          </Button>
        )}
      </div>

      {error && <p className="mx-5 mb-3 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</p>}
      {canManage && !invitesEnabled && (
        <p className="mx-5 mb-3 rounded-lg bg-surface-1 px-3 py-2 text-[12px] text-muted-foreground">
          Convites por e-mail estão em contingência e ainda não estão disponíveis.
        </p>
      )}

      <div className="divide-y divide-border">
        {members.map((m) => (
          <div key={m.userId} className="flex items-center gap-3 px-5 py-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-black/80" style={{ background: ROLE_COLOR[m.role] ?? "#94A3B8" }}>
              {m.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">
                {m.name} {m.isSelf && <span className="text-[11px] text-muted-foreground">(você)</span>}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">{m.email}</p>
            </div>
            {canManage && !m.isSelf ? (
              <select
                value={m.role}
                disabled={pending}
                onChange={(e) => run(() => changeMemberRole(m.userId, e.target.value))}
                className="min-h-11 rounded-lg border border-border bg-background px-2 text-[12px]"
              >
                {Object.keys(ROLE_LABEL).map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
            ) : (
              <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ background: `${ROLE_COLOR[m.role]}1f`, color: ROLE_COLOR[m.role] }}>
                {ROLE_LABEL[m.role] ?? m.role}
              </span>
            )}
            {canManage && !m.isSelf && (
              <IconButton
                label={`Remover acesso de ${m.name}`}
                onClick={() => run(() => removeMember(m.userId))}
                disabled={pending}
                className="shrink-0 hover:bg-danger/10 hover:text-danger"
              >
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </IconButton>
            )}
          </div>
        ))}
      </div>

      {pendingInvites.length > 0 && (
        <div className="border-t border-border p-5">
          <p className="text-[12px] font-semibold">Convites pendentes</p>
          <div className="mt-2 space-y-2">
            {pendingInvites.map((invite) => {
              const expired = new Date(invite.expiresAt).getTime() <= Date.now();
              const cancelled = Boolean(invite.revokedAt);
              const status = cancelled
                ? "Cancelado"
                : expired
                  ? "Expirado"
                  : invite.deliveryStatus === "FAILED"
                    ? "Falha no envio"
                    : invite.deliveryStatus === "SENDING"
                      ? "Enviando"
                      : "Pendente · enviado";
              return (
                <div key={invite.id} className="rounded-xl bg-surface-1 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-medium">{invite.name}</p>
                      <p className="truncate text-[10px] text-muted-foreground">{invite.email}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {ROLE_LABEL[invite.role] ?? invite.role} · {status}
                      </p>
                    </div>
                    {canManage && !cancelled && (
                      <div className="flex">
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
                          <RotateCw className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton
                          label={`Cancelar convite de ${invite.name}`}
                          disabled={pending || expired}
                          onClick={() => setInviteToCancel(invite)}
                          className="hover:bg-danger/10 hover:text-danger"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </IconButton>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Convidar para a equipe</DialogTitle>
          </DialogHeader>
          {inviteResult ? (
            <div className="grid gap-4">
              <div className={`rounded-xl border p-4 ${
                inviteResult.status === "SENT"
                  ? "border-success/25 bg-success/5"
                  : "border-danger/25 bg-danger/5"
              }`}>
                <p className="text-sm font-medium">
                  {inviteResult.status === "SENT"
                    ? `Convite enviado para ${inviteResult.email}`
                    : "Convite salvo, mas o envio falhou"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
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
          <form onSubmit={onInvite} className="grid gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Nome</label>
              <Input name="name" required autoFocus />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Email</label>
              <Input name="email" type="email" required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Papel</label>
              <select name="role" defaultValue="RECEPTIONIST" className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm">
                {Object.keys(ROLE_LABEL).map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-muted-foreground">
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
