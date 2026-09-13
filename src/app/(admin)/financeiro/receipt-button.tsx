"use client";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ComandaPanel } from "../agenda/comanda-panel";
export function ReceiptButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 rounded-lg border border-border px-3 text-sm"
      >
        Ver recibo
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recibo do atendimento</DialogTitle>
            <DialogDescription>
              Valores registrados no recebimento.
            </DialogDescription>
          </DialogHeader>
          <ComandaPanel apptId={id} onClose={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
