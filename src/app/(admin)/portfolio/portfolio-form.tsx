"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ImageUpload } from "@/components/ui/image-upload";
import {
  Dialog, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { createPortfolioItem } from "./actions";

type Pro = { id: string; name: string };

export function PortfolioForm({ professionals }: { professionals: Pro[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState("");

  function handleOpenChange(v: boolean) {
    setOpen(v);
    if (v) setImageUrl("");
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!imageUrl) {
      setError("Selecione uma imagem");
      return;
    }
    setError(null);
    const form = new FormData(e.currentTarget);
    const payload = {
      imageUrl,
      caption: (form.get("caption") as string) || null,
      professionalId: (form.get("professionalId") as string) || null,
    };
    startTransition(async () => {
      try {
        await createPortfolioItem(payload);
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao salvar");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4" /> Adicionar foto</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova foto do portfolio</DialogTitle>
          <DialogDescription>Faça upload do trabalho realizado.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Foto</label>
            <ImageUpload
              value={imageUrl}
              onChange={setImageUrl}
              folder="portfolio"
              aspectRatio="portrait"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Legenda</label>
            <Input name="caption" placeholder="Corte em degradê + acabamento navalhado" autoFocus />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Feito por</label>
            <select
              name="professionalId"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Do salão (sem atribuição)</option>
              {professionals.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" type="button">Cancelar</Button></DialogClose>
            <Button type="submit" disabled={pending}>{pending ? "Enviando…" : "Publicar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
