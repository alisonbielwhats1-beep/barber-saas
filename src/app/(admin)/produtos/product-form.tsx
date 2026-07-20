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
import { createProduct, updateProduct } from "./actions";

type Product = {
  id: string;
  name: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  priceCents: number;
  stock: number;
  imageUrl: string | null;
};

export function ProductForm({ product }: { product?: Product }) {
  const editing = !!product;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState(product?.imageUrl ?? "");

  function handleOpenChange(v: boolean) {
    setOpen(v);
    if (v) setImageUrl(product?.imageUrl ?? "");
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const payload = {
      name: String(form.get("name")),
      description: (form.get("description") as string) || null,
      brand: (form.get("brand") as string) || null,
      category: (form.get("category") as string) || null,
      priceCents: Math.round(Number(form.get("price")) * 100),
      stock: Number(form.get("stock") ?? 0),
      imageUrl: imageUrl || null,
    };
    startTransition(async () => {
      try {
        if (editing) await updateProduct(product!.id, payload);
        else await createProduct(payload);
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao salvar");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {editing ? (
          <Button variant="ghost" size="sm">Editar</Button>
        ) : (
          <Button><Plus className="h-4 w-4" /> Novo produto</Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar produto" : "Novo produto"}</DialogTitle>
          <DialogDescription>
            Faça upload da foto do produto ou arraste uma imagem.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Foto do produto</label>
            <ImageUpload
              value={imageUrl}
              onChange={setImageUrl}
              folder="products"
              aspectRatio="square"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Nome</label>
            <Input name="name" defaultValue={product?.name} required autoFocus />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Descrição</label>
            <Input name="description" defaultValue={product?.description ?? ""} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Marca</label>
              <Input name="brand" defaultValue={product?.brand ?? ""} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Categoria</label>
              <Input name="category" defaultValue={product?.category ?? ""} placeholder="pomade, oleo, shampoo…" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Preço (R$)</label>
              <Input name="price" type="number" min={0} step="0.01" defaultValue={product ? (product.priceCents / 100).toFixed(2) : ""} required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Estoque</label>
              <Input name="stock" type="number" min={0} step={1} defaultValue={product?.stock ?? 10} required />
            </div>
          </div>
          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" type="button">Cancelar</Button></DialogClose>
            <Button type="submit" disabled={pending}>{pending ? "Salvando…" : editing ? "Salvar" : "Criar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
