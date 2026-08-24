"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deletePortfolioItem } from "./actions";

export function DeleteButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  function remove() {
    startTransition(async () => {
      await deletePortfolioItem(id);
      setConfirmOpen(false);
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
        description="Essa foto deixará de aparecer no portfólio público. Essa ação não pode ser desfeita."
        confirmLabel="Remover foto"
        onConfirm={remove}
        pending={pending}
      />
    </>
  );
}
