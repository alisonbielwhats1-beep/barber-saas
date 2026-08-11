"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Loader2, Minus, Package, Plus, Printer, Scissors } from "lucide-react";
import { formatMoney } from "@/lib/utils";
import { calculateComandaTotals } from "@/lib/comanda";
import { getComandaData, closeComanda } from "./actions";

type Method = "CASH" | "CREDIT_CARD" | "DEBIT_CARD" | "PIX" | "TRANSFER";

const METHODS: { value: Method; label: string; emoji: string }[] = [
  { value: "PIX", label: "Pix", emoji: "⚡" },
  { value: "CREDIT_CARD", label: "Crédito", emoji: "💳" },
  { value: "DEBIT_CARD", label: "Débito", emoji: "🏧" },
  { value: "CASH", label: "Dinheiro", emoji: "💵" },
  { value: "TRANSFER", label: "Transf.", emoji: "🔄" },
];

type ComandaData = Awaited<ReturnType<typeof getComandaData>>;

export function ComandaPanel({
  apptId,
  currency,
  onClose,
}: {
  apptId: string;
  currency?: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<ComandaData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [discountInput, setDiscountInput] = useState("");
  const [discountCents, setDiscountCents] = useState(0);
  const [method, setMethod] = useState<Method>("PIX");
  const [notes, setNotes] = useState("");
  const [productQuantities, setProductQuantities] = useState<Record<string, number>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  useEffect(() => {
    getComandaData(apptId)
      .then((d) => {
        setData(d);
        if (d.payment) {
          setDiscountCents(d.payment.discountCents);
          if (d.payment.discountCents > 0) {
            setDiscountInput(
              (d.payment.discountCents / 100).toFixed(2).replace(".", ","),
            );
          }
          setMethod(d.payment.method as Method);
          setNotes(d.payment.notes ?? "");
        }
        setProductQuantities(Object.fromEntries(d.products.map((product) => [product.productId, product.quantity])));
      })
      .catch(() => setLoadError("Não foi possível carregar a comanda."));
  }, [apptId]);

  if (loadError)
    return (
      <p className="py-8 text-center text-[13px] text-danger">{loadError}</p>
    );

  if (!data)
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );

  const selectedProducts = data.availableProducts
    .map((product) => ({ ...product, quantity: productQuantities[product.id] ?? 0 }))
    .filter((product) => product.quantity > 0);
  const totals = calculateComandaTotals({
    serviceCents: data.priceCents,
    productLines: selectedProducts.map((product) => ({ quantity: product.quantity, priceCentsUnit: product.priceCents })),
    discountCents,
  });
  const subtotal = totals.subtotalCents;
  const total = totals.totalCents;
  const expectedVersion = data.version;
  const serviceName = data.serviceItems.length > 0
    ? data.serviceItems.map((service) => service.serviceName).join(" + ")
    : data.service.name;

  function handleDiscount(v: string) {
    idempotencyKeyRef.current = null;
    setDiscountInput(v);
    const num = parseFloat(v.replace(",", "."));
    setDiscountCents(isNaN(num) || num < 0 ? 0 : Math.round(num * 100));
  }

  function changeProduct(productId: string, delta: number, stock: number) {
    idempotencyKeyRef.current = null;
    setProductQuantities((current) => ({
      ...current,
      [productId]: Math.min(stock, Math.max(0, (current[productId] ?? 0) + delta)),
    }));
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        const idempotencyKey = idempotencyKeyRef.current ?? crypto.randomUUID();
        idempotencyKeyRef.current = idempotencyKey;
        const result = await closeComanda({
          id: apptId,
          idempotencyKey,
          expectedVersion,
          discountCents,
          productLines: selectedProducts.map((product) => ({ productId: product.id, quantity: product.quantity })),
          method,
          notes: notes || null,
        });
        if ("error" in result) {
          setError(result.error);
          return;
        }
        setConfirmed(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao fechar comanda");
      }
    });
  }

  if (confirmed) {
    return (
      <div className="space-y-4 print:fixed print:inset-0 print:z-[9999] print:bg-white print:p-8 print:text-black">
        <div className="text-center">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-success/15 text-success print:hidden"><Check className="h-5 w-5" /></span>
          <h3 className="mt-2 text-lg font-semibold">Pagamento registrado</h3>
          <p className="text-[12px] text-muted-foreground print:text-neutral-600">Comprovante interno da comanda</p>
        </div>
        <div className="space-y-2 rounded-xl border border-border p-4 text-[13px]">
          <div className="flex justify-between"><span>{serviceName}</span><strong>{formatMoney(data.priceCents, currency)}</strong></div>
          {selectedProducts.map((product) => <div key={product.id} className="flex justify-between text-muted-foreground print:text-neutral-700"><span>{product.quantity}× {product.name}</span><span>{formatMoney(product.quantity * product.priceCents, currency)}</span></div>)}
          {totals.discountCents > 0 && <div className="flex justify-between text-muted-foreground print:text-neutral-700"><span>Desconto</span><span>- {formatMoney(totals.discountCents, currency)}</span></div>}
          <div className="flex justify-between border-t border-border pt-2 text-base"><span>Total</span><strong>{formatMoney(total, currency)}</strong></div>
          <div className="flex justify-between text-muted-foreground print:text-neutral-700"><span>Forma</span><span>{METHODS.find((item) => item.value === method)?.label}</span></div>
        </div>
        <div className="grid grid-cols-2 gap-2 print:hidden">
          <button onClick={() => window.print()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-3 text-[13px]"><Printer className="h-4 w-4" /> Imprimir</button>
          <button onClick={onClose} className="rounded-xl bg-primary px-4 py-3 text-[13px] font-semibold text-primary-foreground">Concluir</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Serviço */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Serviço
        </p>
        <div className="flex items-center justify-between rounded-xl bg-surface-1 px-3 py-2.5">
          <span className="flex items-center gap-2 text-[13px]">
            <Scissors className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            {serviceName}
          </span>
          <span className="text-[13px] font-medium">
            {formatMoney(data.priceCents, currency)}
          </span>
        </div>
      </div>

      {/* Produtos */}
      {data.availableProducts.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Produtos da comanda
          </p>
          <div className="space-y-1">
            {data.availableProducts.map((product) => {
              const quantity = productQuantities[product.id] ?? 0;
              return (
              <div
                key={product.id}
                className="flex items-center justify-between rounded-xl bg-surface-1 px-3 py-2.5"
              >
                <span className="flex items-center gap-2 text-[13px]">
                  <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span><span className="font-medium">{product.name}</span><span className="block text-[10px] text-muted-foreground">{formatMoney(product.priceCents, currency)} · {product.stock} em estoque</span></span>
                </span>
                <span className="flex items-center gap-1.5">
                  <button type="button" onClick={() => changeProduct(product.id, -1, product.stock)} disabled={quantity === 0} aria-label={`Remover ${product.name}`} className="grid h-8 w-8 place-items-center rounded-lg border border-border disabled:opacity-30"><Minus className="h-3.5 w-3.5" /></button>
                  <span className="w-6 text-center text-[13px] font-semibold">{quantity}</span>
                  <button type="button" onClick={() => changeProduct(product.id, 1, product.stock)} disabled={quantity >= product.stock} aria-label={`Adicionar ${product.name}`} className="grid h-8 w-8 place-items-center rounded-lg border border-border disabled:opacity-30"><Plus className="h-3.5 w-3.5" /></button>
                </span>
              </div>
            );})}
          </div>
        </div>
      )}

      {/* Totais */}
      <div className="space-y-2 rounded-xl border border-border bg-card/50 px-3.5 py-3">
        {selectedProducts.length > 0 && (
          <div className="flex justify-between text-[13px] text-muted-foreground">
            <span>Subtotal</span>
            <span>{formatMoney(subtotal, currency)}</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <label className="shrink-0 text-[13px] text-muted-foreground">
            Desconto (R$)
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={discountInput}
            onChange={(e) => handleDiscount(e.target.value)}
            placeholder="0,00"
            className="w-24 rounded-lg border border-border bg-surface-1 px-2 py-1.5 text-right text-[13px] focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex justify-between border-t border-border pt-2 text-[15px] font-bold">
          <span>Total</span>
          <span className="text-primary">{formatMoney(total, currency)}</span>
        </div>
      </div>

      {/* Forma de pagamento */}
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Forma de pagamento
        </p>
        <div className="grid grid-cols-5 gap-1.5">
          {METHODS.map((m) => (
            <button
              key={m.value}
              onClick={() => {
                idempotencyKeyRef.current = null;
                setMethod(m.value);
              }}
              className={`flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-[11px] font-medium transition ${
                method === m.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-surface-1 text-muted-foreground hover:border-primary/40"
              }`}
            >
              <span className="text-base leading-none">{m.emoji}</span>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Observação */}
      <textarea
        value={notes}
        onChange={(e) => {
          idempotencyKeyRef.current = null;
          setNotes(e.target.value);
        }}
        rows={2}
        placeholder="Observação opcional…"
        className="w-full resize-none rounded-lg border border-border bg-surface-1 px-3 py-2 text-[13px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />

      {error && (
        <p className="rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      )}

      <button
        disabled={pending}
        onClick={submit}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-[14px] font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Check className="h-4 w-4" />
        )}
        Confirmar pagamento · {formatMoney(total, currency)}
      </button>
    </div>
  );
}
