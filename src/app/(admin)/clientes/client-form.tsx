"use client";
import { toast } from "@/components/ui/toast";
import { useFormOperation } from "../use-form-operation";

import { FormSection } from "../form-section";
import { TaskForm } from "../task-form";
import { useRef, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../form-dialog";
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
  const [pending, startTransition] = useFormOperation();
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setError(null);
    const form = new FormData(e.currentTarget);
    const payload = {
      name: String(form.get("name")),
      phone: String(form.get("phone") ?? ""),
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
        toast("Cadastro salvo", "success");
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao salvar");
      } finally { submitting.current = false; }
    });
  }

  return (
    <Dialog pending={pending} open={open} onOpenChange={next => { setOpen(next); if (next) setError(null); }}>
      <DialogTrigger asChild>
        {editing ? (
          <Button variant="ghost" size="sm"><Pencil className="h-4 w-4" aria-hidden />Editar</Button>
        ) : (
          <Button className="admin-client-create" aria-label="Novo cliente">
            <Plus className="h-5 w-5" aria-hidden /> <span className="hidden md:inline">Novo cliente</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="admin-form-dialog admin-guided-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar cliente" : "Novo cliente"}</DialogTitle>
          <DialogDescription className="sr-only">
            Nome e WhatsApp são obrigatórios. Os demais campos ajudam a personalizar o atendimento.
          </DialogDescription>
        </DialogHeader>

        <TaskForm onSubmit={onSubmit} pending={pending} error={error} submitLabel={editing ? "Salvar cliente" : "Cadastrar cliente"}>
          <div>
          <div>
            <label htmlFor="client-form-name" className="mb-1 block text-sm font-medium">Nome</label>
            <Input id="client-form-name" aria-label="Nome" name="name" autoComplete="name" defaultValue={client?.name} required autoFocus />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="client-form-phone" className="mb-1 block text-sm font-medium">WhatsApp *</label>
              <Input id="client-form-phone" aria-label="WhatsApp"
                name="phone" type="tel" autoComplete="tel"
                defaultValue={client?.phone ?? ""}
                placeholder="(11) 91234-5678"
                required
              />
            </div>
            <div>
              <label htmlFor="client-form-email" className="mb-1 block text-sm font-medium">Email</label>
              <Input id="client-form-email" aria-label="Email"
                name="email" autoComplete="email"
                type="email"
                defaultValue={client?.email ?? ""}
              />
            </div>
          </div>
          </div>
          <FormSection title="Informações complementares" description="Aniversário, preferências e observações">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="client-form-birthday" className="mb-1 block text-sm font-medium">Aniversário</label>
              <Input id="client-form-birthday" aria-label="Aniversário"
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
              <label htmlFor="client-form-gender" className="mb-1 block text-sm font-medium">Gênero</label>
              <select id="client-form-gender" aria-label="Gênero" name="gender" defaultValue={client?.gender ?? ""} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Não informado</option>
                <option value="FEMALE">Feminino</option>
                <option value="MALE">Masculino</option>
                <option value="OTHER">Outro</option>
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="client-form-allergies" className="mb-1 block text-sm font-medium">Alergias e restrições</label>
            <textarea id="client-form-allergies" aria-label="Alergias e restrições"
              name="allergies"
              defaultValue={client?.allergies ?? ""}
              rows={2}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Alergia a amônia, sensibilidade na pele…"
            />
          </div>
          <div>
            <label htmlFor="client-form-preferences" className="mb-1 block text-sm font-medium">Preferências de atendimento</label>
            <textarea id="client-form-preferences" aria-label="Preferências de atendimento"
              name="preferences"
              defaultValue={client?.preferences ?? ""}
              rows={2}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Corte baixo, água morna, atendimento silencioso…"
            />
          </div>
          <div>
            <label htmlFor="client-form-notes" className="mb-1 block text-sm font-medium">Observações internas</label>
            <textarea id="client-form-notes" aria-label="Observações internas"
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
          </FormSection>
        </TaskForm>
      </DialogContent>
    </Dialog>
  );
}
