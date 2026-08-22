"use client";

import { useState, useTransition } from "react";
import { Check, Crown, Loader2, RotateCcw, ShieldAlert, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { reviewSalonAccess } from "../actions";

type Props = {
  salonId: string;
  salonName: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";
  currentPlan: "FREE" | "STARTER" | "PRO" | "ENTERPRISE";
};

export function ApprovalControls({ salonId, salonName, status, currentPlan }: Props) {
  const [dialog, setDialog] = useState<"approve" | "reject" | "suspend" | null>(null);
  const [plan, setPlan] = useState<"FREE" | "STARTER" | "PRO" | "ENTERPRISE">(
    currentPlan === "STARTER" || currentPlan === "PRO" || currentPlan === "ENTERPRISE" ? currentPlan : "FREE",
  );
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!dialog) return;
    startTransition(async () => {
      try {
        if (dialog === "approve") {
          await reviewSalonAccess({ salonId, decision: "APPROVE", plan, reason });
        } else if (dialog === "reject") {
          await reviewSalonAccess({ salonId, decision: "REJECT", reason });
        } else {
          await reviewSalonAccess({ salonId, decision: "SUSPEND", reason });
        }
        toast("Acesso atualizado", "success");
        setDialog(null);
        setReason("");
      } catch (error) {
        toast(error instanceof Error ? error.message : "Não foi possível atualizar", "error");
      }
    });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {status !== "APPROVED" && (
          <Button size="sm" onClick={() => setDialog("approve")}>
            {status === "SUSPENDED" ? <RotateCcw className="h-4 w-4" /> : <Check className="h-4 w-4" />}
            {status === "SUSPENDED" ? "Reativar" : "Liberar acesso"}
          </Button>
        )}
        {status === "APPROVED" && (
          <>
            <Button size="sm" variant="outline" onClick={() => setDialog("approve")}>
              <Crown className="h-4 w-4" /> Alterar plano
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setDialog("suspend")}>
              <ShieldAlert className="h-4 w-4" /> Suspender
            </Button>
          </>
        )}
        {status === "PENDING" && (
          <Button size="sm" variant="outline" onClick={() => setDialog("reject")}>
            <XCircle className="h-4 w-4" /> Recusar
          </Button>
        )}
      </div>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {dialog === "approve"
                ? status === "SUSPENDED"
                  ? `Reativar ${salonName}`
                  : `Liberar ${salonName}`
                : dialog === "reject"
                  ? `Recusar ${salonName}`
                  : `Suspender ${salonName}`}
            </DialogTitle>
            <DialogDescription>
              {dialog === "suspend"
                ? "O acesso será bloqueado, mas agenda, clientes e histórico continuarão preservados."
                : "Revise a recomendação antes de confirmar. Toda decisão fica registrada no histórico."}
            </DialogDescription>
          </DialogHeader>

          {dialog === "approve" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <PlanOption
                active={plan === "FREE"}
                title="Grátis"
                description="Recomendado para teste inicial e negócios que ainda estão conhecendo o sistema."
                onClick={() => setPlan("FREE")}
              />
              <PlanOption
                active={plan === "STARTER"}
                title="Fundador"
                description="Até 2 agendas, com preço especial para os primeiros estabelecimentos."
                onClick={() => setPlan("STARTER")}
              />
              <PlanOption
                active={plan === "PRO"}
                title="Pro"
                description="Até 3 agendas e recursos completos para a operação."
                onClick={() => setPlan("PRO")}
              />
              <PlanOption
                active={plan === "ENTERPRISE"}
                title="Equipe"
                description="Até 10 agendas para equipes maiores."
                onClick={() => setPlan("ENTERPRISE")}
              />
            </div>
          ) : (
            <div>
              <label htmlFor="review-reason" className="mb-1.5 block text-sm font-medium">
                Motivo obrigatório
              </label>
              <textarea
                id="review-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={4}
                maxLength={500}
                placeholder="Explique o motivo para manter uma trilha clara."
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)} disabled={pending}>
              Voltar
            </Button>
            <Button
              variant={dialog === "suspend" ? "destructive" : "default"}
              onClick={submit}
              disabled={pending || (dialog !== "approve" && reason.trim().length < 3)}
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmar alteração
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PlanOption({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-2xl border p-4 text-left transition ${
        active ? "border-primary bg-primary/10 ring-2 ring-primary/20" : "border-border bg-background"
      }`}
    >
      <span className="font-semibold">Plano {title}</span>
      <span className="mt-2 block text-xs leading-relaxed text-muted-foreground">{description}</span>
    </button>
  );
}
