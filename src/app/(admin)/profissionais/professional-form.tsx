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
import {
  createProfessional,
  updateProfessional,
  setProfessionalServices,
} from "./actions";

type Service = { id: string; name: string; colorHex: string | null };

type EditablePro = {
  id: string;
  name: string;
  email: string;
  bio: string | null;
  colorHex: string | null;
  commissionPct: number;
  monthlyGoalCents: number;
  serviceIds: string[];
};

type Props = {
  services: Service[];
  professional?: EditablePro;
  trigger?: React.ReactNode;
};

export function ProfessionalForm({ services, professional, trigger }: Props) {
  const editing = !!professional;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(professional?.serviceIds ?? services.map((s) => s.id)),
  );

  function toggleService(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const commonPayload = {
      name: String(form.get("name")),
      bio: (form.get("bio") as string) || null,
      colorHex: (form.get("colorHex") as string) || null,
      commissionPct: Number(form.get("commissionPct") ?? 0),
      monthlyGoalCents: Math.round(Number(form.get("goal") || 0) * 100),
    };

    startTransition(async () => {
      try {
        if (editing) {
          await updateProfessional(professional!.id, commonPayload);
          await setProfessionalServices(professional!.id, Array.from(selected));
        } else {
          await createProfessional({
            ...commonPayload,
            email: String(form.get("email")),
            password: String(form.get("password") || ""),
          });
          // Nota: para create, o pro é criado sem services vinculados. O usuário
          // pode editar em seguida pra escolher — evita passar id que ainda não
          // existe pro action.
        }
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao salvar");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (editing ? (
          <Button variant="ghost" size="sm">Editar</Button>
        ) : (
          <Button>
            <Plus className="h-4 w-4" /> Adicionar
          </Button>
        ))}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar profissional" : "Novo profissional"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Ajuste dados, comissão e quais serviços esse profissional realiza."
              : "Se o email já existe, o profissional é vinculado sem duplicar conta."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Nome</label>
            <Input name="name" defaultValue={professional?.name} required autoFocus />
          </div>

          {!editing && (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium">Email</label>
                <Input name="email" type="email" required />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Senha inicial</label>
                <Input
                  name="password"
                  type="password"
                  minLength={6}
                  placeholder="Deixe em branco para gerar 'trocar-agora'"
                />
              </div>
            </>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium">Bio</label>
            <Input
              name="bio"
              defaultValue={professional?.bio ?? ""}
              placeholder="Especialista em coloração"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Comissão (%)</label>
              <Input
                name="commissionPct"
                type="number"
                min={0}
                max={100}
                step={1}
                defaultValue={professional?.commissionPct ?? 40}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Cor na agenda</label>
              <Input
                name="colorHex"
                type="color"
                defaultValue={professional?.colorHex ?? "#2ECC8B"}
                className="h-10 w-20 cursor-pointer p-1"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Meta mensal (R$)</label>
            <Input
              name="goal"
              type="number"
              min={0}
              step="100"
              defaultValue={professional ? (professional.monthlyGoalCents / 100).toFixed(2) : "7000.00"}
              placeholder="Meta de faturamento no mês"
            />
          </div>

          {editing && (
            <div>
              <p className="mb-2 text-sm font-medium">Serviços que realiza</p>
              <div className="grid gap-1 rounded-md border p-3 sm:grid-cols-2">
                {services.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Cadastre serviços primeiro.
                  </p>
                )}
                {services.map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 transition hover:bg-muted/60"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={selected.has(s.id)}
                      onChange={() => toggleService(s.id)}
                    />
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: s.colorHex ?? "hsl(var(--primary))" }}
                    />
                    <span className="text-sm">{s.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

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
