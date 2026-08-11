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
    gender: "MALE" | "FEMALE" | "OTHER" | null;
    notes: string | null;
    allergies: string;
    preferences: string;
    consentGiven: boolean;
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
      gender: (form.get("gender") as "MALE" | "FEMALE" | "OTHER") || null,
      notes: (form.get("notes") as string) || null,
      allergies: (form.get("allergies") as string) || null,
      preferences: (form.get("preferences") as string) || null,
      consentGiven: form.get("consentGiven") === "on",
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
          <div className="grid grid-cols-2 gap-3">
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
              <label className="mb-1 block text-sm font-medium">Gênero</label>
              <select name="gender" defaultValue={client?.gender ?? ""} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Não informado</option>
                <option value="FEMALE">Feminino</option>
                <option value="MALE">Masculino</option>
                <option value="OTHER">Outro</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Alergias e restrições</label>
            <textarea
              name="allergies"
              defaultValue={client?.allergies ?? ""}
              rows={2}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Alergia a amônia, sensibilidade na pele…"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Preferências de atendimento</label>
            <textarea
              name="preferences"
              defaultValue={client?.preferences ?? ""}
              rows={2}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Corte baixo, água morna, atendimento silencioso…"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Observações internas</label>
            <textarea
              name="notes"
              defaultValue={client?.notes ?? ""}
              rows={2}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Informações úteis para a equipe…"
            />
          </div>
          <label className="flex items-start gap-2 rounded-lg border border-border bg-surface-1 p-3 text-sm">
            <input name="consentGiven" type="checkbox" defaultChecked={client?.consentGiven ?? false} className="mt-0.5 h-4 w-4 accent-primary" />
            <span>
              Cliente autorizou registrar estas informações para personalizar o atendimento.
              <span className="mt-0.5 block text-xs text-muted-foreground">O consentimento pode ser removido a qualquer momento.</span>
            </span>
          </label>
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
