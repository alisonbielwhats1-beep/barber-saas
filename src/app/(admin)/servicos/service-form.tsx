"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createService, updateService } from "./actions";

type Props = {
  service?: {
    id: string;
    name: string;
    description: string | null;
    durationMin: number;
    priceCents: number;
    colorHex: string | null;
  };
};

export function ServiceForm({ service }: Props) {
  const editing = !!service;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const payload = {
      name: String(form.get("name")),
      description: (form.get("description") as string) || null,
      durationMin: Number(form.get("durationMin")),
      priceCents: Math.round(Number(form.get("price")) * 100),
      colorHex: (form.get("colorHex") as string) || null,
    };

    startTransition(async () => {
      try {
        if (editing) await updateService(service!.id, payload);
        else await createService(payload);
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao salvar");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? (
          <Button variant="ghost" size="sm">Editar</Button>
        ) : (
          <Button>
            <Plus className="h-4 w-4" /> Novo serviço
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Editar serviço" : "Novo serviço"}</DialogTitle>
          <DialogDescription>
            Duração e preço aparecem para o cliente na hora de agendar.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Nome</label>
            <Input name="name" defaultValue={service?.name} required autoFocus />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Descrição</label>
            <Input name="description" defaultValue={service?.description ?? ""} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Duração (min)</label>
              <Input
                name="durationMin"
                type="number"
                min={5}
                step={5}
                defaultValue={service?.durationMin ?? 60}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Preço (R$)</label>
              <Input
                name="price"
                type="number"
                min={0}
                step="0.01"
                defaultValue={service ? (service.priceCents / 100).toFixed(2) : ""}
                required
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Cor</label>
            <Input
              name="colorHex"
              type="color"
              defaultValue={service?.colorHex ?? "#a13860"}
              className="h-10 w-20 cursor-pointer p-1"
            />
          </div>
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" type="button">Cancelar</Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : editing ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
