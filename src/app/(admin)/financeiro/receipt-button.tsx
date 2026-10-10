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
import { Button } from "@/components/ui/button";
export function ReceiptButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Ver recibo
      </Button>
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
