/** Shared wire contract. No client-provided price or duration authorizes a booking. */
export type VisitChoice = {
  serviceId: string;
  professionalId?: string;
  offsetMin?: number;
};
export type VisitItem = {
  serviceId: string;
  serviceName: string;
  professionalId: string;
  professionalName: string;
  startLocal: string;
  endLocal: string;
  durationMin: number;
  priceCents: number;
  priceType: string;
  priceNote: string | null;
};
export type VisitPlan = {
  items: VisitItem[];
  totalCents: number;
  startLocal: string;
  endLocal: string;
};
export type VisitService = {
  id: string;
  name: string;
  durationMin: number;
  priceCents: number;
  priceType?: string;
  priceNote?: string | null;
  professionals: { id: string; name: string }[];
};

export function groupVisitItems(items: VisitItem[]) {
  const groups: {
    professionalId: string;
    startLocal: string;
    endLocal: string;
    serviceIds: string[];
    items: VisitItem[];
  }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (
      last?.professionalId === item.professionalId &&
      last.endLocal === item.startLocal
    ) {
      last.endLocal = item.endLocal;
      last.serviceIds.push(item.serviceId);
      last.items.push(item);
    } else
      groups.push({
        professionalId: item.professionalId,
        startLocal: item.startLocal,
        endLocal: item.endLocal,
        serviceIds: [item.serviceId],
        items: [item],
      });
  }
  return groups;
}

export function visitPlan(items: VisitItem[]): VisitPlan {
  return {
    items,
    totalCents: items.reduce((sum, item) => sum + item.priceCents, 0),
    startLocal: items.map((i) => i.startLocal).sort()[0] ?? "",
    endLocal:
      items
        .map((i) => i.endLocal)
        .sort()
        .at(-1) ?? "",
  };
}
