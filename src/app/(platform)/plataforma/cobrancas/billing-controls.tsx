"use client";

import { useMemo, useState, useTransition } from "react";
import { CheckCircle2, Loader2, Plus, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  createPlatformInvoice,
  markPlatformInvoicePaid,
  voidPlatformInvoice,
} from "./actions";

type SalonOption = { id: string; name: string };

export function NewInvoiceButton({ salons }: { salons: SalonOption[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        await createPlatformInvoice({
          salonId: String(form.get("salonId")),
          reference: String(form.get("reference")),
          amount: String(form.get("amount")),
          dueDate: String(form.get("dueDate")),
          notes: String(form.get("notes") ?? ""),
        });
        toast("Cobrança registrada", "success");
        setOpen(false);
      } catch (error) {
        toast(error instanceof Error ? error.message : "Não foi possível registrar", "error");
      }
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={salons.length === 0}>
        <Plus className="h-4 w-4" /> Nova cobrança
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Registrar cobrança manual</DialogTitle>
              <DialogDescription>
                Recomendado nesta fase: apenas registra o controle. Nenhum débito ou envio automático será realizado.
              </DialogDescription>
            </DialogHeader>
            <div className="my-5 grid gap-4">
              <Field label="Estabelecimento">
                <select name="salonId" required className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Selecione</option>
                  {salons.map((salon) => <option key={salon.id} value={salon.id}>{salon.name}</option>)}
                </select>
              </Field>
              <Field label="Referência" hint="Ex.: Agosto/2026">
                <Input name="reference" required maxLength={80} placeholder="Agosto/2026" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Valor (R$)">
                  <Input name="amount" inputMode="decimal" required placeholder="99,90" />
                </Field>
                <Field label="Vencimento">
                  <Input name="dueDate" type="date" required />
                </Field>
              </div>
              <Field label="Observação opcional">
                <textarea name="notes" rows={3} maxLength={500} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" />
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Voltar</Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="h-4 w-4 animate-spin" />} Registrar sem cobrar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function InvoiceActions({ invoiceId }: { invoiceId: string }) {
  const [dialog, setDialog] = useState<"paid" | "void" | null>(null);
  const [pending, startTransition] = useTransition();
  const today = useMemo(() => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }, []);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        if (dialog === "paid") {
          await markPlatformInvoicePaid({
            invoiceId,
            paidDate: String(form.get("paidDate")),
            paymentMethod: String(form.get("paymentMethod")) as "CASH" | "CREDIT_CARD" | "DEBIT_CARD" | "PIX" | "TRANSFER",
            notes: String(form.get("notes") ?? ""),
          });
          toast("Pagamento registrado", "success");
        } else {
          await voidPlatformInvoice({ invoiceId, reason: String(form.get("reason")) });
          toast("Cobrança anulada sem apagar o histórico", "success");
        }
        setDialog(null);
      } catch (error) {
        toast(error instanceof Error ? error.message : "Não foi possível atualizar", "error");
      }
    });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setDialog("paid")}>
          <CheckCircle2 className="h-4 w-4" /> Dar baixa
        </Button>
        <Button size="sm" variant="outline" onClick={() => setDialog("void")}>
          <XCircle className="h-4 w-4" /> Anular
        </Button>
      </div>
      <Dialog open={dialog !== null} onOpenChange={(value) => !value && setDialog(null)}>
        <DialogContent>
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>{dialog === "paid" ? "Confirmar recebimento" : "Anular cobrança"}</DialogTitle>
              <DialogDescription>
                {dialog === "paid"
                  ? "Use somente após confirmar que o valor foi recebido. Esta ação não movimenta dinheiro."
                  : "A cobrança não será apagada; o motivo ficará registrado no histórico."}
              </DialogDescription>
            </DialogHeader>
            <div className="my-5 grid gap-4">
              {dialog === "paid" ? (
                <>
                  <Field label="Data do recebimento"><Input name="paidDate" type="date" defaultValue={today} required /></Field>
                  <Field label="Forma de pagamento">
                    <select name="paymentMethod" defaultValue="PIX" required className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                      <option value="PIX">Pix</option><option value="TRANSFER">Transferência</option>
                      <option value="CREDIT_CARD">Cartão de crédito</option><option value="DEBIT_CARD">Cartão de débito</option>
                      <option value="CASH">Dinheiro</option>
                    </select>
                  </Field>
                  <Field label="Observação opcional"><textarea name="notes" rows={3} maxLength={500} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" /></Field>
                </>
              ) : (
                <Field label="Motivo obrigatório"><textarea name="reason" required minLength={3} rows={4} maxLength={500} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" /></Field>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDialog(null)} disabled={pending}>Voltar</Button>
              <Button type="submit" variant={dialog === "void" ? "destructive" : "default"} disabled={pending}>
                {pending && <Loader2 className="h-4 w-4 animate-spin" />} Confirmar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="grid gap-1.5 text-sm font-medium">{label}{children}{hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}</label>;
}
