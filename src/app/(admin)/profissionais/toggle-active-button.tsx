"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toggleProfessionalActive } from "./actions";

export function ToggleActiveButton({ id, active }: { id: string; active: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await toggleProfessionalActive(id);
        })
      }
    >
      {active ? "Desativar" : "Ativar"}
    </Button>
  );
}
