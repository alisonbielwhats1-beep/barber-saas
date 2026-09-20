"use client";
import { toast } from "@/components/ui/toast";
import { useFormOperation } from "../use-form-operation";

import { FormSection } from "../form-section";
import { TaskForm } from "../task-form";
import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ImageUpload } from "@/components/ui/image-upload";
import {
  Dialog, DialogContent, DialogDescription,
  DialogHeader, DialogTitle, DialogTrigger,
} from "../form-dialog";
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
  const [pending, startTransition] = useFormOperation();
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState(product?.imageUrl ?? "");

  function handleOpenChange(v: boolean) {
    setOpen(v);
    if (v) setImageUrl(product?.imageUrl ?? "");
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
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
        toast("Cadastro salvo", "success");
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao salvar");
      } finally { submitting.current = false; }
    });
  }

  return (
    <Dialog dirtyKey={imageUrl} pending={pending} open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (editing ? (
          <Button variant="ghost" size="sm">Editar</Button>
        ) : (
          <Button size="lg" className="admin-directory-create" aria-label="Novo produto"><Plus className="h-5 w-5" /> <span className="hidden md:inline">Novo produto</span></Button>
        ))}
      </DialogTrigger>
      <DialogContent className="admin-form-dialog admin-guided-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar produto" : "Novo produto"}</DialogTitle>
          <DialogDescription className="sr-only">Custo, fornecedor e estoque mínimo alimentam margem e reposição.</DialogDescription>
        </DialogHeader>

        <TaskForm onSubmit={onSubmit} pending={pending} error={error} submitLabel={editing ? "Salvar produto" : "Cadastrar produto"}>
          <div>
          <div>
            <label htmlFor="product-form-name" className="mb-1 block text-sm font-medium">Nome</label>
            <Input id="product-form-name" aria-label="Nome" name="name" defaultValue={product?.name} required autoFocus />
          </div>
          </div>
          <div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="product-form-price" className="mb-1 block text-sm font-medium">Preço venda (R$)</label>
              <Input id="product-form-price" aria-label="Preço venda (R$)" name="price" type="number" min={0} step="0.01" defaultValue={product ? (product.priceCents / 100).toFixed(2) : ""} required />
            </div>
            <div>
              <label htmlFor="product-form-cost" className="mb-1 block text-sm font-medium">Custo (R$)</label>
              <Input id="product-form-cost" aria-label="Custo (R$)" name="cost" type="number" min={0} step="0.01" defaultValue={product ? (product.costCents / 100).toFixed(2) : "0.00"} />
            </div>
          </div>
          </div>
          <div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <div>
              <label htmlFor="product-form-stock" className="mb-1 block text-sm font-medium">Estoque</label>
              <Input id="product-form-stock" aria-label="Estoque" disabled={!!product} aria-describedby={product ? "stock-help" : undefined} name="stock" type="number" min={0} step={1} defaultValue={product?.stock ?? ""} placeholder="Informe a quantidade" required />
              {product && <p id="stock-help" className="text-xs text-muted-foreground">Ajuste o saldo pela opção Movimentar estoque.</p>}
            </div>
            <div>
              <label htmlFor="product-form-minStock" className="mb-1 block text-sm font-medium">Mínimo</label>
              <Input id="product-form-minStock" aria-label="Mínimo" name="minStock" type="number" min={0} step={1} defaultValue={product?.minStock ?? 4} />
            </div>
            <div>
              <label htmlFor="product-form-expiresAt" className="mb-1 block text-sm font-medium">Validade</label>
              <Input id="product-form-expiresAt" aria-label="Validade" name="expiresAt" type="date" defaultValue={product?.expiresAt ? format(new Date(product.expiresAt), "yyyy-MM-dd") : ""} />
            </div>
          </div>
          <FormSection title="Fornecedor e identificação">          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="product-form-supplier" className="mb-1 block text-sm font-medium">Fornecedor</label>
              <Input id="product-form-supplier" aria-label="Fornecedor" name="supplier" defaultValue={product?.supplier ?? ""} />
            </div>
            <div>
              <label htmlFor="product-form-barcode" className="mb-1 block text-sm font-medium">Código de barras</label>
              <Input id="product-form-barcode" aria-label="Código de barras" name="barcode" defaultValue={product?.barcode ?? ""} />
            </div>
          </div></FormSection>
          </div>
          <FormSection title="Detalhes do produto" description="Marca, categoria, foto e descrição">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="product-form-brand" className="mb-1 block text-sm font-medium">Marca</label>
              <Input id="product-form-brand" aria-label="Marca" name="brand" defaultValue={product?.brand ?? ""} />
            </div>
            <div>
              <label htmlFor="product-form-category" className="mb-1 block text-sm font-medium">Categoria</label>
              <Input id="product-form-category" aria-label="Categoria" name="category" defaultValue={product?.category ?? ""} placeholder="Pomada, óleo…" />
            </div>
          </div>

          <div><ImageUpload value={imageUrl} onChange={setImageUrl} folder="products" aspectRatio="square" /></div>
          <label className="text-sm">Descrição<Input name="description" defaultValue={product?.description ?? ""} /></label>
          </FormSection>
        </TaskForm>
      </DialogContent>
    </Dialog>
  );
}
