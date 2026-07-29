"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, RotateCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    <section className="space-y-3">
      <div>
        <h2 className="text-[15px] font-semibold">Convites pendentes</h2>
        <p className="text-[11px] text-muted-foreground">
          Esses profissionais ainda não aparecem na agenda nem podem receber
          agendamentos.
        </p>
      </div>
      {feedback && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {feedback}
        </p>
      )}
      <div className="grid gap-3 xl:grid-cols-2">
        {invites.map((invite) => {
          const expired = new Date(invite.expiresAt).getTime() <= now;
          const cancelled = Boolean(invite.revokedAt);
          const actionable = !expired && !cancelled;
          return (
            <article
              key={invite.id}
              className="rounded-2xl border border-border bg-card p-4"
            >
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <Mail className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{invite.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {invite.email}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Profissional · criado em {dateTime(invite.createdAt)}
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-1">
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
                    <Badge tone="success">Enviado</Badge>
                  )}
                  {!cancelled && invite.deliveryStatus === "FAILED" && (
                    <Badge tone="danger">Falha no envio</Badge>
                  )}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-surface-1 p-3 text-[11px]">
                <div>
                  <span className="text-muted-foreground">Enviado em</span>
                  <p className="font-medium">{dateTime(invite.sentAt)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Expira em</span>
                  <p className="font-medium">{dateTime(invite.expiresAt)}</p>
                </div>
              </div>
              {!cancelled && (
                <div className="mt-3 flex gap-2">
                  <Button
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
                    <RotateCw className="h-3.5 w-3.5" />
                    {actionable ? "Reenviar convite" : "Enviar novo convite"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending || !actionable}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Cancelar o convite de ${invite.name}? O link deixará de funcionar imediatamente.`,
                        )
                      ) {
                        return;
                      }
                      run(() => cancelProfessionalInvite(invite.id));
                    }}
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Cancelar
                  </Button>
                </div>
              )}
            </article>
          );
        })}
      </div>
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
    warning: "bg-amber-500/10 text-amber-600",
    info: "bg-blue-500/10 text-blue-600",
    success: "bg-success/10 text-success",
    danger: "bg-destructive/10 text-destructive",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${classes[tone]}`}>
      {children}
    </span>
  );
}
