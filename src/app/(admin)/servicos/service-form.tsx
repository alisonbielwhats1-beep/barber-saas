"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ImageUpload } from "@/components/ui/image-upload";
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
import { listResources } from "./resource-actions";

type Props = {
  service?: {
    variantGroup?: string | null;
    variantLabel?: string | null;
    processingMin?: number;
    finishingMin?: number;
    physicalResourceId?: string | null;
    id: string;
    name: string;
    description: string | null;
    durationMin: number;
    priceCents: number;
    costCents: number;
    category: string | null;
    imageUrl: string | null;
    colorHex: string | null;
  };
  trigger?: React.ReactNode;
};

const CATEGORIES = ["Corte", "Barba", "Coloração", "Tratamento", "Finalização", "Estética", "Outros"];

export function ServiceForm({ service, trigger }: Props) {
  const editing = !!service;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState(service?.imageUrl ?? "");
  const [resources, setResources] = useState<Awaited<ReturnType<typeof listResources>>>([]);
  const [resourceId, setResourceId] = useState(service?.physicalResourceId ?? "");

  function handleOpenChange(v: boolean) {
    setOpen(v);
    if (v) setImageUrl(service?.imageUrl ?? "");
    if (v) listResources().then(setResources).catch(() => setError("Não foi possível carregar salas e equipamentos. Feche e tente novamente."));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const payload = {
      name: String(form.get("name")),
      variantGroup: String(form.get("variantGroup") || ""), variantLabel: String(form.get("variantLabel") || ""),
      processingMin: Number(form.get("processingMin") || 0), finishingMin: Number(form.get("finishingMin") || 0), physicalResourceId: resourceId || null,
      description: (form.get("description") as string) || null,
      durationMin: Number(form.get("durationMin")),
      priceCents: Math.round(Number(form.get("price")) * 100),
      costCents: Math.round(Number(form.get("cost") || 0) * 100),
      category: (form.get("category") as string) || null,
      imageUrl: imageUrl || null,
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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (editing ? (
          <Button variant="ghost" size="sm">Editar</Button>
        ) : (
          <Button>
            <Plus className="h-4 w-4" /> Novo serviço
          </Button>
        ))}
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar serviço" : "Novo serviço"}</DialogTitle>
          <DialogDescription>
            Custo é usado para calcular margem e lucro (não aparece para o cliente).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Foto do serviço (opcional)</label>
            <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
              A primeira foto cadastrada em uma categoria também representa essa categoria na vitrine.
            </p>
            <ImageUpload value={imageUrl} onChange={setImageUrl} folder="services" aspectRatio="landscape" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Nome</label>
            <Input aria-label="Nome" name="name" defaultValue={service?.name} required autoFocus />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Descrição</label>
            <Input aria-label="Descrição" name="description" defaultValue={service?.description ?? ""} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-sm">Grupo de variantes<Input name="variantGroup" defaultValue={service?.variantGroup ?? ""} placeholder="Ex.: Coloração" maxLength={100} /></label>
            <label className="text-sm">Variação<Input name="variantLabel" defaultValue={service?.variantLabel ?? ""} placeholder="Ex.: Cabelo longo" maxLength={100} /></label>
          </div>
          <fieldset className="space-y-3 rounded-xl border border-border p-3"><legend className="px-1 text-sm font-medium">Etapas do atendimento</legend><p className="text-xs text-muted-foreground">A duração total inclui execução, processamento e finalização. O profissional e o recurso ficam reservados durante todo o atendimento.</p><label className="block text-sm">Processamento (min)<Input name="processingMin" type="number" min={0} max={599} defaultValue={service?.processingMin ?? 0} /></label><label className="block text-sm">Finalização (min)<Input name="finishingMin" type="number" min={0} max={599} defaultValue={service?.finishingMin ?? 0} /></label></fieldset>
          <label className="block text-sm">Sala ou equipamento necessário<select name="physicalResourceId" value={resourceId} onChange={e => setResourceId(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3"><option value="">Nenhum</option>{resourceId && !resources.some(r => r.id === resourceId) && <option value={resourceId}>Recurso atual (carregando…)</option>}{resources.map(r => <option key={r.id} value={r.id} disabled={!r.active}>{r.name}{r.active ? "" : " (inativo)"}</option>)}</select></label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Categoria</label>
              <Input
                aria-label="Categoria" name="category"
                list="service-categories"
                defaultValue={service?.category ?? "Corte"}
                placeholder="Ex.: Barba ou Unhas"
              />
              <datalist id="service-categories">
                {CATEGORIES.map((category) => <option key={category} value={category} />)}
              </datalist>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Duração (min)</label>
              <Input aria-label="Duração (min)" name="durationMin" type="number" min={5} step={5} defaultValue={service?.durationMin ?? 60} required />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Preço (R$)</label>
              <Input aria-label="Preço (R$)" name="price" type="number" min={0} step="0.01" defaultValue={service ? (service.priceCents / 100).toFixed(2) : ""} required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Custo (R$)</label>
              <Input aria-label="Custo (R$)" name="cost" type="number" min={0} step="0.01" defaultValue={service ? (service.costCents / 100).toFixed(2) : "0.00"} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Cor</label>
            <Input aria-label="Cor" name="colorHex" type="color" defaultValue={service?.colorHex ?? "#2ECC8B"} className="h-10 w-20 cursor-pointer p-1" />
          </div>
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
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
