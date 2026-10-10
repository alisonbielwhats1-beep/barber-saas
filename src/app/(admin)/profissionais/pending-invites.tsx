"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, RotateCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  cancelProfessionalInvite,
  resendProfessionalInvite,
} from "./actions";

type PendingInvite = {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  sentAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
  deliveryStatus: "SENDING" | "SENT" | "FAILED";
};

function dateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function PendingInvites({ invites }: { invites: PendingInvite[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [inviteToCancel, setInviteToCancel] = useState<PendingInvite | null>(null);
  const now = Date.now();

  function run(action: () => Promise<void>) {
    setFeedback(null);
    startTransition(async () => {
      try {
        await action();
        router.refresh();
      } catch (error) {
        setFeedback(
          error instanceof Error ? error.message : "Não foi possível concluir.",
        );
      }
    });
  }

  if (invites.length === 0) return null;

  return (
    <section aria-label="Convites pendentes" className="flex min-w-0 flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold">Convites pendentes</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Esses profissionais ainda não aparecem na agenda nem podem receber
          agendamentos.
        </p>
      </div>
      {feedback && (
        <p role="status" className="rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
          {feedback}
        </p>
      )}
      <div className="grid min-w-0 gap-3 lg:grid-cols-2 lg:gap-4">
        {invites.map((invite) => {
          const expired = new Date(invite.expiresAt).getTime() <= now;
          const cancelled = Boolean(invite.revokedAt);
          const actionable = !expired && !cancelled;
          return (
            <article
              key={invite.id}
              aria-label={`Convite de ${invite.name}`}
              className="flex min-w-0 flex-col gap-3 rounded-[14px] border border-border bg-card p-4"
            >
              <div className="flex items-start gap-3">
                <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted text-foreground">
                  <Mail className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold">{invite.name}</p>
                  <p className="break-all text-sm text-muted-foreground">
                    {invite.email}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Profissional · criado em {dateTime(invite.createdAt)}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {cancelled ? (
                  <Badge tone="muted">Cancelado</Badge>
                ) : expired ? (
                  <Badge tone="warning">Expirado</Badge>
                ) : (
                  <Badge tone="warning">Pendente</Badge>
                )}
                {!cancelled && invite.deliveryStatus === "SENDING" && (
                  <Badge tone="info">Enviando</Badge>
                )}
                {!cancelled && invite.deliveryStatus === "SENT" && (
                  <Badge tone="muted">Enviado</Badge>
                )}
                {!cancelled && invite.deliveryStatus === "FAILED" && (
                  <Badge tone="danger">Falha no envio</Badge>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-background p-3 text-sm">
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Enviado em</dt>
                  <dd className="font-medium tabular-nums">{dateTime(invite.sentAt)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Expira em</dt>
                  <dd className="font-medium tabular-nums">{dateTime(invite.expiresAt)}</dd>
                </div>
              </dl>
              {!cancelled && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        const result = await resendProfessionalInvite(invite.id);
                        if (result.deliveryStatus !== "SENT") {
                          throw new Error(
                            "O convite foi renovado, mas o provedor não confirmou o envio.",
                          );
                        }
                        setFeedback(`Convite reenviado para ${invite.email}.`);
                      })
                    }
                  >
                    <RotateCw aria-hidden="true" className="h-4 w-4" />
                    {actionable ? "Reenviar convite" : "Enviar novo convite"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending || !actionable}
                    onClick={() => setInviteToCancel(invite)}
                  >
                    <XCircle aria-hidden="true" className="h-4 w-4" />
                    Cancelar
                  </Button>
                </div>
              )}
            </article>
          );
        })}
      </div>
      <ConfirmDialog
        open={Boolean(inviteToCancel)}
        onOpenChange={(open) => {
          if (!open) setInviteToCancel(null);
        }}
        title={`Cancelar convite de ${inviteToCancel?.name ?? "profissional"}?`}
        description="O link deixará de funcionar imediatamente e este convite não poderá ser usado para entrar no estabelecimento."
        confirmLabel="Cancelar convite"
        onConfirm={() => {
          if (!inviteToCancel) return;
          const inviteId = inviteToCancel.id;
          setInviteToCancel(null);
          run(() => cancelProfessionalInvite(inviteId));
        }}
        pending={pending}
      />
    </section>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "muted" | "warning" | "info" | "success" | "danger";
}) {
  const classes = {
    muted: "bg-muted text-muted-foreground",
    warning: "bg-warning/15 text-warning",
    info: "bg-info/15 text-info",
    success: "bg-success/15 text-success",
    danger: "bg-danger/10 text-danger",
  };
  return (
    <span className={`inline-flex min-h-[22px] items-center whitespace-nowrap rounded-full px-2.5 text-xs font-medium ${classes[tone]}`}>
      {children}
    </span>
  );
}
