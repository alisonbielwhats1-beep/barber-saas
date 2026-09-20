"use client";

import { useState } from "react";
import { useFormOperation } from "../use-form-operation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deletePortfolioItem } from "./actions";

export function DeleteButton({ id }: { id: string }) {
  const [pending, startTransition] = useFormOperation();
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function remove() {
    startTransition(async () => {
      setError(null);
      try { await deletePortfolioItem(id); setConfirmOpen(false); }
      catch { setError("Não foi possível remover a foto. Tente novamente."); }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        size="icon"
        className="h-11 w-11"
        aria-label="Remover foto do portfólio"
        title="Remover foto do portfólio"
        disabled={pending}
        onClick={() => setConfirmOpen(true)}
      >
        <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Remover foto do portfólio?"
        description={error ?? "Essa foto deixará de aparecer no portfólio público. Essa ação não pode ser desfeita."}
        confirmLabel="Remover foto"
        onConfirm={remove}
        pending={pending}
      />
    </>
  );
}
