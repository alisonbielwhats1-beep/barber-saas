"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deletePortfolioItem } from "./actions";

export function DeleteButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="destructive"
      size="icon"
      className="h-8 w-8"
      disabled={pending}
      onClick={() => {
        if (!confirm("Remover essa foto?")) return;
        startTransition(async () => {
          await deletePortfolioItem(id);
        });
      }}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}
