"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toggleProfessionalActive } from "./actions";

export function ToggleActiveButton({ id, active }: { id: string; active: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      className={active ? "w-full border-danger/30 bg-danger/10 text-danger hover:bg-danger/15 hover:text-danger" : "w-full"}
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
