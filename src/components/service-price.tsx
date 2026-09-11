import { PRICE_AGREEMENT_NOTE, priceSnapshot, type PriceDetails } from "@/lib/service-price";

export function ServicePriceNote({ service }: { service: PriceDetails }) {
  if (service.priceType !== "FROM") return null;
  return <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{priceSnapshot(service).priceNote}</span>;
}

export function VariablePriceNotice({ services }: { services: Array<PriceDetails & { name?: string; serviceName?: string }> }) {
  const variable = services.filter(service => service.priceType === "FROM");
  if (!variable.length) return null;
  return <div className="mt-3 rounded-xl border border-border bg-muted/40 p-3 text-sm leading-relaxed">
    <p className="font-medium">O valor final pode ser maior</p>
    {variable.map((service, index) => <p key={index} className="mt-1 text-xs text-muted-foreground"><strong>{service.name ?? service.serviceName}: </strong>{priceSnapshot(service).priceNote}</p>)}
    <p className="mt-2 text-xs text-muted-foreground">{PRICE_AGREEMENT_NOTE}</p>
  </div>;
}
