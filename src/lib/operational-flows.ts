import { differenceInCalendarDays } from "date-fns";
import { isValidPhoneBR, normalizePhone } from "./phone";

type AuditLike = {
  action: string;
  createdAt: Date;
  metadata: unknown;
};

function metadataNumber(metadata: unknown, key: string): number {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return 0;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

export function deriveCashState(events: AuditLike[]) {
  const ordered = [...events].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const latestOpen = ordered.find((event) => event.action === "CASH_OPENED") ?? null;
  const latestClose = ordered.find((event) => event.action === "CASH_CLOSED") ?? null;
  const isOpen = Boolean(latestOpen && (!latestClose || latestOpen.createdAt > latestClose.createdAt));

  return {
    isOpen,
    openedAt: isOpen ? latestOpen!.createdAt : null,
    openingFloatCents: isOpen ? metadataNumber(latestOpen!.metadata, "openingFloatCents") : 0,
    lastClosedAt: latestClose?.createdAt ?? null,
  };
}

export function calculateLoyaltyBalance(input: {
  completedVisits: number;
  redeemedPoints: number;
  rewardCost: number;
}) {
  const earnedPoints = Math.max(0, Math.floor(input.completedVisits));
  const redeemedPoints = Math.min(earnedPoints, Math.max(0, Math.floor(input.redeemedPoints)));
  const rewardCost = Math.max(1, Math.floor(input.rewardCost));
  const availablePoints = earnedPoints - redeemedPoints;
  return { earnedPoints, redeemedPoints, availablePoints, canRedeem: availablePoints >= rewardCost };
}

export function validateStockAdjustment(input: { currentStock: number; delta: number }): number {
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw new Error("Informe uma quantidade inteira diferente de zero");
  }
  const next = Math.floor(input.currentStock) + input.delta;
  if (next < 0) throw new Error("Estoque insuficiente para esta saida");
  return next;
}

export function summarizeCampaignDeliveries(deliveries: Array<{
  campaignKey: string;
  clientId: string;
  status: "OPENED" | "COPIED";
}>) {
  const unique = new Map<string, (typeof deliveries)[number]>();
  for (const delivery of deliveries) {
    unique.set(`${delivery.campaignKey}:${delivery.clientId}:${delivery.status}`, delivery);
  }
  const values = [...unique.values()];
  const byCampaign: Record<string, number> = {};
  for (const delivery of values) {
    byCampaign[delivery.campaignKey] = (byCampaign[delivery.campaignKey] ?? 0) + 1;
  }
  return {
    totalInteractions: values.length,
    openedWhatsApp: values.filter((delivery) => delivery.status === "OPENED").length,
    copied: values.filter((delivery) => delivery.status === "COPIED").length,
    uniqueClients: new Set(values.map((delivery) => delivery.clientId)).size,
    byCampaign,
  };
}

export function calculateRetentionMetrics(
  clients: Array<{ visits: Date[] }>,
  now = new Date(),
  lapsedAfterDays = 60,
) {
  const returning = clients.filter((client) => client.visits.length >= 2).length;
  const intervals: number[] = [];
  let lapsedClients = 0;

  for (const client of clients) {
    const visits = [...client.visits].sort((a, b) => b.getTime() - a.getTime());
    if (visits.length > 0 && differenceInCalendarDays(now, visits[0]) > lapsedAfterDays) lapsedClients += 1;
    for (let index = 1; index < visits.length; index += 1) {
      intervals.push(Math.abs(differenceInCalendarDays(visits[index - 1], visits[index])));
    }
  }

  return {
    returningClientRatePct: clients.length === 0 ? 0 : Math.round((returning / clients.length) * 100),
    averageDaysBetweenVisits: intervals.length === 0
      ? 0
      : Math.round(intervals.reduce((sum, value) => sum + value, 0) / intervals.length),
    lapsedClients,
  };
}

export type ImportedClient = {
  name: string;
  phone: string | null;
  email: string | null;
  birthday: string | null;
};

function parseCsvLine(line: string, separator: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"' && quoted) {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === separator && !quoted) {
      values.push(value.trim());
      value = "";
    } else {
      value += char;
    }
  }
  values.push(value.trim());
  return values;
}

export function parseClientCsv(csv: string): { rows: ImportedClient[]; errors: Array<{ line: number; message: string }> } {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return { rows: [], errors: [{ line: 1, message: "Arquivo vazio" }] };
  const separator = lines[0].includes(";") ? ";" : ",";
  const header = parseCsvLine(lines[0].toLowerCase(), separator);
  const indexOf = (...names: string[]) => header.findIndex((column) => names.includes(column));
  const indexes = {
    name: indexOf("nome", "name"),
    phone: indexOf("telefone", "celular", "phone", "whatsapp"),
    email: indexOf("email", "e-mail"),
    birthday: indexOf("aniversario", "aniversário", "nascimento", "birthday"),
  };
  if (indexes.name < 0) return { rows: [], errors: [{ line: 1, message: "Coluna nome nao encontrada" }] };

  const rows: ImportedClient[] = [];
  const errors: Array<{ line: number; message: string }> = [];
  for (let index = 1; index < lines.length; index += 1) {
    const values = parseCsvLine(lines[index], separator);
    const name = values[indexes.name]?.trim() ?? "";
    if (!name) {
      errors.push({ line: index + 1, message: "Nome obrigatorio" });
      continue;
    }
    const rawBirthday = indexes.birthday >= 0 ? values[indexes.birthday]?.trim() ?? "" : "";
    const birthday = /^\d{4}-\d{2}-\d{2}$/.test(rawBirthday) ? rawBirthday : null;
    const rawPhone = indexes.phone >= 0 ? values[indexes.phone]?.trim() ?? "" : "";
    if (rawPhone && !isValidPhoneBR(rawPhone)) {
      errors.push({ line: index + 1, message: "Telefone invalido" });
      continue;
    }
    rows.push({
      name,
      phone: rawPhone ? normalizePhone(rawPhone) : null,
      email: indexes.email >= 0 ? values[indexes.email]?.trim().toLowerCase() || null : null,
      birthday,
    });
  }
  return { rows, errors };
}
