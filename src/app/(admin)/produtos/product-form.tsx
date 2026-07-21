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
import { format } from "date-fns";

type Product = {
  id: string;
  name: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  supplier: string | null;
  barcode: string | null;
  priceCents: number;
  costCents: number;
  stock: number;
  minStock: number;
  expiresAt: string | null;
  imageUrl: string | null;
};

export function ProductForm({ product, trigger }: { product?: Product; trigger?: React.ReactNode }) {
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
      supplier: (form.get("supplier") as string) || null,
      barcode: (form.get("barcode") as string) || null,
      priceCents: Math.round(Number(form.get("price")) * 100),
      costCents: Math.round(Number(form.get("cost") || 0) * 100),
      stock: Number(form.get("stock") ?? 0),
      minStock: Number(form.get("minStock") ?? 0),
      expiresAt: (form.get("expiresAt") as string) || null,
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
        {trigger ?? (editing ? (
          <Button variant="ghost" size="sm">Editar</Button>
        ) : (
          <Button><Plus className="h-4 w-4" /> Novo produto</Button>
        ))}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar produto" : "Novo produto"}</DialogTitle>
          <DialogDescription>Custo, fornecedor e estoque mínimo alimentam margem e reposição.</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Foto do produto</label>
            <ImageUpload value={imageUrl} onChange={setImageUrl} folder="products" aspectRatio="square" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Nome</label>
            <Input name="name" defaultValue={product?.name} required autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Marca</label>
              <Input name="brand" defaultValue={product?.brand ?? ""} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Categoria</label>
              <Input name="category" defaultValue={product?.category ?? ""} placeholder="Pomada, óleo…" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Fornecedor</label>
              <Input name="supplier" defaultValue={product?.supplier ?? ""} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Código de barras</label>
              <Input name="barcode" defaultValue={product?.barcode ?? ""} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Preço venda (R$)</label>
              <Input name="price" type="number" min={0} step="0.01" defaultValue={product ? (product.priceCents / 100).toFixed(2) : ""} required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Custo (R$)</label>
              <Input name="cost" type="number" min={0} step="0.01" defaultValue={product ? (product.costCents / 100).toFixed(2) : "0.00"} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Estoque</label>
              <Input name="stock" type="number" min={0} step={1} defaultValue={product?.stock ?? 10} required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Mínimo</label>
              <Input name="minStock" type="number" min={0} step={1} defaultValue={product?.minStock ?? 4} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Validade</label>
              <Input name="expiresAt" type="date" defaultValue={product?.expiresAt ? format(new Date(product.expiresAt), "yyyy-MM-dd") : ""} />
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
