"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Minus, Package, Plus, Printer, Scissors } from "lucide-react";
import { receiptExtras } from "@/lib/receipt-adjustments";
import { formatInTimeZone } from "date-fns-tz";
import { formatMoney } from "@/lib/utils";
import { calculateComandaTotals, reconcileReservedProduct } from "@/lib/comanda";
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
  const [extraServiceIds, setExtraServiceIds] = useState<string[]>([]);
  const [finalValues, setFinalValues] = useState<Record<number, string>>({});
  const [finalReasons, setFinalReasons] = useState<Record<number, string>>({});
  const [surcharge, setSurcharge] = useState("");
  const [reason, setReason] = useState("");
  const [receivedDate, setReceivedDate] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  async function startTransition(work: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true; setPending(true);
    try { await work(); } finally { busy.current = false; setPending(false); }
  }
  const [error, setError] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  useEffect(() => {
    getComandaData(apptId)
      .then((d) => {
        setData(d);
        setReceivedDate(d.receivedDate);
        if (d.payment) setConfirmed(true);
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
        setFinalValues(Object.fromEntries(d.serviceItems.filter(service => service.priceType === "FROM")
          .map(service => [service.position, ((service.finalPriceCents ?? service.priceCents) / 100).toFixed(2).replace(".", ",")])));
        setFinalReasons(Object.fromEntries(d.serviceItems.filter(service => service.priceType === "FROM")
          .map(service => [service.position, service.finalPriceReason ?? ""])));
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

  const displayCurrency = data.payment?.currency ?? data.currency ?? currency ?? "BRL";
  const selectedProducts = data.availableProducts
    .map((product) => {
      const quantity = productQuantities[product.id] ?? 0;
      const reservedRows = data.products.filter((row) => row.productId === product.id);
      const reconciliation = reconcileReservedProduct({
        reserved: reservedRows,
        desiredQuantity: quantity,
        currentPriceCents: product.priceCents,
        currentProductName: product.name,
      });
      return {
        ...product,
        quantity,
        pricedLines: reconciliation.pricedLines,
        totalCents: reconciliation.totalCents,
      };
    })
    .filter((product) => product.quantity > 0);
  const surchargeCents = /^\d+(?:[,.]\d{0,2})?$/.test(surcharge) ? Math.round(Number(surcharge.replace(",", ".")) * 100) : surcharge === "" ? 0 : NaN;
  const finalServicePrices = data.serviceItems.filter(service => service.priceType === "FROM")
    .map(service => {
      const raw = finalValues[service.position] ?? (service.priceCents / 100).toFixed(2);
      const finalPriceCents = /^\d+(?:[,.]\d{0,2})?$/.test(raw)
        ? Math.round(Number(raw.replace(",", ".")) * 100) : NaN;
      return { position: service.position, initialPriceCents: service.priceCents,
        finalPriceCents, reason: finalPriceCents > service.priceCents
          ? finalReasons[service.position]?.trim() ?? "" : "" };
    });
  const finalPriceDeltaCents = finalServicePrices.reduce((sum, service) =>
    sum + (Number.isFinite(service.finalPriceCents) ? service.finalPriceCents - service.initialPriceCents : 0), 0);
  const extraCents = extraServiceIds.reduce((sum, id) => sum + (data.availableServices.find(s => s.id === id)?.priceCents ?? 0), 0);
  const totals = calculateComandaTotals({
    serviceCents: data.priceCents + finalPriceDeltaCents + extraCents + (Number.isFinite(surchargeCents) ? surchargeCents : 0),
    productLines: selectedProducts.flatMap((product) => product.pricedLines),
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

  function changeProduct(productId: string, delta: number, maxQuantity: number) {
    idempotencyKeyRef.current = null;
    setProductQuantities((current) => ({
      ...current,
      [productId]: Math.min(maxQuantity, Math.max(0, (current[productId] ?? 0) + delta)),
    }));
  }

  function submit() {
    setError(null);
    if (finalServicePrices.some(service => !Number.isSafeInteger(service.finalPriceCents)
      || service.finalPriceCents < service.initialPriceCents
      || (service.finalPriceCents > service.initialPriceCents && service.reason.length < 3))) {
      setError("Confira o valor final de cada serviço e explique os reajustes."); return;
    }
    if (!Number.isSafeInteger(surchargeCents) || (surchargeCents > 0 && reason.trim().length < 3)) { setError("Confira o acréscimo e informe seu motivo."); return; }
    startTransition(async () => {
      try {
        const idempotencyKey = idempotencyKeyRef.current ?? crypto.randomUUID();
        idempotencyKeyRef.current = idempotencyKey;
        const result = await closeComanda({
          id: apptId,
          idempotencyKey,
          expectedVersion,
          extraServiceIds, surchargeCents, adjustmentReason: reason,
          finalServicePrices: finalServicePrices.map(({ position, finalPriceCents, reason: finalReason }) =>
            ({ position, finalPriceCents, reason: finalReason })),
          receivedDate: data?.canDiscount ? receivedDate : undefined, expectedTotalCents: total,
          discountCents,
          productLines: selectedProducts.map((product) => ({ productId: product.id, quantity: product.quantity })),
          method,
          notes: notes || null,
        });
        if ("error" in result) {
          setError(result.error);
          return;
        }
        const receipt = await getComandaData(apptId);
        if (!receipt.payment) {
          setError("Pagamento confirmado, mas o recibo ainda não está disponível. Reabra o atendimento.");
          return;
        }
        setData(receipt);
        setProductQuantities(Object.fromEntries(
          receipt.products.map((product) => [product.productId, product.quantity]),
        ));
        setConfirmed(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao fechar comanda");
      }
    });
  }

  if (confirmed) {
    const payment = data.payment;
    if (!payment) {
      return <p role="alert" className="py-8 text-center text-[13px] text-danger">Recibo indisponível.</p>;
    }
    const receiptServices = data.serviceItems.length > 0
      ? data.serviceItems
      : [{ serviceName: data.service.name, priceCents: data.priceCents, finalPriceCents: null,
          finalPriceReason: null, priceType: "FIXED" }];
    return (
      <div className="space-y-4 print:fixed print:inset-0 print:z-[9999] print:bg-white print:p-8 print:text-black">
        <div className="text-center">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-success/15 text-success print:hidden"><Check className="h-5 w-5" /></span>
          <h3 className="mt-2 text-lg font-semibold">Pagamento registrado</h3>
          <p className="text-[12px] text-muted-foreground print:text-neutral-600">Comprovante interno da comanda</p>
        </div>
        <div className="space-y-2 rounded-xl border border-border p-4 text-[13px]">
          {receiptServices.map((service, index) => <div key={`${service.serviceName}-${index}`} className="flex justify-between gap-3"><span>{service.serviceName}{service.finalPriceCents !== null && <small className="block text-muted-foreground">Inicial {formatMoney(service.priceCents, displayCurrency)}{service.finalPriceReason ? ` · ${service.finalPriceReason}` : ""}</small>}</span><strong>{formatMoney(service.finalPriceCents ?? service.priceCents, displayCurrency)}</strong></div>)}
          {data.products.map((product) => <div key={product.id} className="flex justify-between text-muted-foreground print:text-neutral-700"><span>{product.quantity}× {product.productName}</span><span>{formatMoney(product.quantity * product.priceCentsUnit, displayCurrency)}</span></div>)}
          {receiptExtras(payment.extraServices).map((extra, index) => <div key={`extra-${index}`} className="flex justify-between"><span>Extra · {extra.serviceName}</span><span>{formatMoney(extra.priceCents, displayCurrency)}</span></div>)}
          {payment.surchargeCents > 0 && <div className="flex justify-between gap-2"><span>Acréscimo · {payment.adjustmentReason}</span><span>{formatMoney(payment.surchargeCents, displayCurrency)}</span></div>}
          <p className="text-xs">Recebido em {formatInTimeZone(payment.paidAt, data.timezone, "dd/MM/yyyy")} · registrado em {formatInTimeZone(payment.recordedAt, data.timezone, "dd/MM/yyyy HH:mm")}</p>
          {payment.discountCents > 0 && <div className="flex justify-between text-muted-foreground print:text-neutral-700"><span>Desconto</span><span>- {formatMoney(payment.discountCents, displayCurrency)}</span></div>}
          <div className="flex justify-between border-t border-border pt-2 text-base"><span>Total recebido</span><strong>{formatMoney(payment.amountCents, displayCurrency)}</strong></div>
          <div className="flex justify-between text-muted-foreground print:text-neutral-700"><span>Forma</span><span>{METHODS.find((item) => item.value === payment.method)?.label ?? payment.method}</span></div>
          <div className="flex justify-between gap-3 text-[11px] text-muted-foreground print:text-neutral-700"><span>Pagamento</span><span className="break-all text-right">{payment.id}</span></div>
        </div>
        <div className="grid grid-cols-2 gap-2 print:hidden">
          <button onClick={() => window.print()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-3 text-[13px]"><Printer className="h-4 w-4" /> Imprimir</button>
          <button onClick={onClose} className="rounded-xl bg-primary px-4 py-3 text-[13px] font-semibold text-primary-foreground">Concluir</button>
        </div>
      </div>
    );
  }

  return (
    <fieldset disabled={pending} className="min-w-0 space-y-4">
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
            {formatMoney(data.priceCents, displayCurrency)}
          </span>
        </div>
        {data.serviceItems.filter(service => service.priceType === "FROM").map(service => (
          <div key={service.position} className="space-y-2 rounded-xl border border-violet-400/35 bg-violet-500/5 p-3">
            <p className="text-sm font-semibold">{service.serviceName} · a partir de {formatMoney(service.priceCents, displayCurrency)}</p>
            <label className="grid gap-1 text-sm">Valor final combinado (R$)
              <input inputMode="decimal" value={finalValues[service.position] ?? ""}
                disabled={!data.canDiscount} onChange={event => { idempotencyKeyRef.current = null; setFinalValues(values => ({ ...values, [service.position]: event.target.value })); }}
                className="min-h-11 rounded-lg border border-border bg-background px-3" />
            </label>
            {Number.isFinite(finalServicePrices.find(item => item.position === service.position)?.finalPriceCents)
              && (finalServicePrices.find(item => item.position === service.position)?.finalPriceCents ?? 0) > service.priceCents
              && <label className="grid gap-1 text-sm">Motivo do reajuste
                <input value={finalReasons[service.position] ?? ""} maxLength={240}
                  disabled={!data.canDiscount} onChange={event => { idempotencyKeyRef.current = null; setFinalReasons(reasons => ({ ...reasons, [service.position]: event.target.value })); }}
                  placeholder="Ex.: comprimento e volume do cabelo"
                  className="min-h-11 rounded-lg border border-border bg-background px-3" />
              </label>}
            {!data.canDiscount && <p className="text-xs text-muted-foreground">Só proprietário ou gerente pode reajustar este valor.</p>}
          </div>
        ))}
      </div>

      {data.canDiscount && <fieldset disabled={pending} className="space-y-3 rounded-xl border border-border p-3"><legend className="px-1 text-sm font-semibold">Revisar recebimento</legend><label className="grid gap-1 text-sm">Data do recebimento<input type="date" max={data.today} value={receivedDate} onChange={e => { idempotencyKeyRef.current = null; setReceivedDate(e.target.value); }} className="min-h-11 rounded-lg border border-border bg-background px-3" /></label><p className="text-xs text-muted-foreground">Começa em ontem. Altere se recebeu em outro dia.</p><label className="grid gap-1 text-sm">Adicionar serviço realizado<select value="" disabled={extraServiceIds.length >= 30} onChange={e => { if (e.target.value) { idempotencyKeyRef.current = null; setExtraServiceIds(ids => [...ids, e.target.value]); } }} className="min-h-11 rounded-lg border border-border bg-background px-3"><option value="">Escolher serviço…</option>{data.availableServices.map(s => <option key={s.id} value={s.id}>{s.name} · {formatMoney(s.priceCents, displayCurrency)}</option>)}</select></label>{extraServiceIds.map((id, i) => <div key={`${id}-${i}`} className="flex items-center justify-between text-sm"><span>{data.availableServices.find(s => s.id === id)?.name}</span><button type="button" className="min-h-11 px-3" onClick={() => { idempotencyKeyRef.current = null; setExtraServiceIds(ids => ids.filter((_, index) => index !== i)); }}>Remover extra</button></div>)}<label className="grid gap-1 text-sm">Acréscimo (R$)<input inputMode="decimal" placeholder="0,00" value={surcharge} onChange={e => { idempotencyKeyRef.current = null; setSurcharge(e.target.value); }} className="min-h-11 rounded-lg border border-border bg-background px-3" /></label>{surchargeCents > 0 && <label className="grid gap-1 text-sm">Motivo do acréscimo<input value={reason} maxLength={300} onChange={e => { idempotencyKeyRef.current = null; setReason(e.target.value); }} className="min-h-11 rounded-lg border border-border bg-background px-3" /></label>}</fieldset>}
      {/* Produtos */}
      {data.availableProducts.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Produtos da comanda
          </p>
          <div className="space-y-1">
            {data.availableProducts.map((product) => {
              const quantity = productQuantities[product.id] ?? 0;
              const maxQuantity = product.reservedQuantity + (product.active ? product.stock : 0);
              return (
              <div
                key={product.id}
                className="flex items-center justify-between rounded-xl bg-surface-1 px-3 py-2.5"
              >
                <span className="flex items-center gap-2 text-[13px]">
                  <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span><span className="font-medium">{product.name}</span><span className="block text-[10px] text-muted-foreground">{product.reservedQuantity > 0 ? `${product.reservedQuantity} reservado(s) por ${formatMoney(product.reservedValueCents, displayCurrency)}` : formatMoney(product.priceCents, displayCurrency)} · {product.active ? `${product.stock} disponíveis além da reserva` : "inativo · apenas reserva existente"}</span></span>
                </span>
                <span className="flex items-center gap-1.5">
                  <button type="button" onClick={() => changeProduct(product.id, -1, maxQuantity)} disabled={quantity === 0} aria-label={`Remover ${product.name}`} className="grid h-8 w-8 place-items-center rounded-lg border border-border disabled:opacity-30"><Minus className="h-3.5 w-3.5" /></button>
                  <span className="w-6 text-center text-[13px] font-semibold">{quantity}</span>
                  <button type="button" onClick={() => changeProduct(product.id, 1, maxQuantity)} disabled={quantity >= maxQuantity} aria-label={`Adicionar ${product.name}`} className="grid h-8 w-8 place-items-center rounded-lg border border-border disabled:opacity-30"><Plus className="h-3.5 w-3.5" /></button>
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
            <span>{formatMoney(subtotal, displayCurrency)}</span>
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
            disabled={!data.canDiscount}
            placeholder="0,00"
            title={!data.canDiscount ? "Somente proprietário ou gerente pode aplicar desconto" : undefined}
            className="w-24 rounded-lg border border-border bg-surface-1 px-2 py-1.5 text-right text-[13px] focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
        {!data.canDiscount && (
          <p className="text-right text-[10px] text-muted-foreground">
            Descontos exigem proprietário ou gerente.
          </p>
        )}
        <div className="flex justify-between border-t border-border pt-2 text-[15px] font-bold">
          <span>Total</span>
          <span className="text-primary">{formatMoney(total, displayCurrency)}</span>
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
        Confirmar pagamento · {formatMoney(total, displayCurrency)}
      </button>
    </fieldset>
  );
}
