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
import { createClient, updateClient } from "./actions";

type Props = {
  client?: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    birthday: Date | null;
    notes: string | null;
  };
};

export function ClientForm({ client }: Props) {
  const editing = !!client;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const payload = {
      name: String(form.get("name")),
      phone: (form.get("phone") as string) || null,
      email: (form.get("email") as string) || null,
      birthday: (form.get("birthday") as string) || null,
      notes: (form.get("notes") as string) || null,
    };

    startTransition(async () => {
      try {
        if (editing) await updateClient(client!.id, payload);
        else await createClient(payload);
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
            <Plus className="h-4 w-4" /> Novo cliente
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Editar cliente" : "Novo cliente"}</DialogTitle>
          <DialogDescription>
            Só o nome é obrigatório. Os demais campos ajudam a personalizar o atendimento.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Nome</label>
            <Input name="name" defaultValue={client?.name} required autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">WhatsApp</label>
              <Input
                name="phone"
                defaultValue={client?.phone ?? ""}
                placeholder="(11) 91234-5678"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Email</label>
              <Input
                name="email"
                type="email"
                defaultValue={client?.email ?? ""}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Aniversário</label>
            <Input
              name="birthday"
              type="date"
              defaultValue={
                client?.birthday
                  ? new Date(client.birthday).toISOString().slice(0, 10)
                  : ""
              }
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Notas</label>
            <Input
              name="notes"
              defaultValue={client?.notes ?? ""}
              placeholder="Alergia a amônia, prefere café sem açúcar…"
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
