import { after } from "next/server";
import type { NotificationChannel, Prisma } from "@prisma/client";
import { withApprovedSalon, withSalon, type Tx } from "./prisma-tenant";
import { clientPushEnabled, sendClientPush } from "./client-push";
import { queueClientReminderChannels } from "./client-reminders";
import {
  CLIENT_CHANGE_TEMPLATES,
  changeNoticeCopy,
  isClientChangeTemplate,
} from "./client-change-notice-copy";

/**
 * Aviso imediato por notificação no celular quando o estabelecimento cancela
 * ou muda o horário de um cliente. Diferente do lembrete (que espera o cron do
 * dia), este sai na hora, logo depois que a alteração foi gravada:
 *
 *  1. dentro da transação do evento, grava uma linha PENDING por aparelho do
 *     cliente (se a transação desfaz, as linhas somem junto);
 *  2. depois da resposta (`after`), entrega. Falha do provedor nunca desfaz a
 *     agenda;
 *  3. o que sobrar pendente é reentregue pelo cron diário, até 24 horas depois.
 */

const MAX_AGE_MS = 24 * 60 * 60_000;
const MAX_ATTEMPTS = 3;
const BATCH = 40;

type Payload = Record<string, unknown>;

function asObject(value: unknown): Payload {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Payload : {};
}

function asDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Enfileira o aviso do evento para cada aparelho do cliente. Devolve quantos. */
export async function queueClientChangeNotice(
  tx: Tx,
  input: {
    salonId: string;
    clientId: string;
    appointmentId: string;
    eventId: string;
    template: string;
    payload: Prisma.InputJsonValue;
  },
): Promise<number> {
  if (!clientPushEnabled() || !isClientChangeTemplate(input.template)) return 0;
  const event = asObject(input.payload);
  const startAt = asDate(event.startAt);
  if (!startAt) return 0;
  const salon = await tx.salon.findFirst({
    where: { id: input.salonId },
    select: { name: true, slug: true, timezone: true },
  });
  if (!salon) return 0;
  const timezone = typeof event.timezone === "string" ? event.timezone : salon.timezone;
  const copy = changeNoticeCopy({
    template: input.template,
    salonName: salon.name,
    timezone,
    startAt,
    previousStartAt: asDate(event.previousStartAt),
  });
  const queuedBefore = await tx.notificationOutbox.count({
    where: { eventId: input.eventId, salonId: input.salonId, channel: "PUSH" },
  });
  await queueClientReminderChannels(tx, {
    salonId: input.salonId,
    clientId: input.clientId,
    appointmentId: input.appointmentId,
    eventId: input.eventId,
    template: input.template,
    payload: {
      title: copy.title,
      body: copy.body,
      url: `/book/${encodeURIComponent(salon.slug)}/minhas`,
    },
    pushEnabled: true,
    // O e-mail de aviso não está liberado em Produção; só push.
    emailEnabled: false,
  });
  const queuedAfter = await tx.notificationOutbox.count({
    where: { eventId: input.eventId, salonId: input.salonId, channel: "PUSH" },
  });
  return queuedAfter - queuedBefore;
}

/** 4xx do provedor (exceto 429) não se resolve tentando de novo. */
function isFinalClientError(code: string) {
  return /^PUSH_HTTP_4\d\d$/.test(code) && code !== "PUSH_HTTP_429";
}

function safeErrorCode(error: unknown) {
  const status = error && typeof error === "object" && "statusCode" in error
    ? Number(error.statusCode)
    : null;
  return status && Number.isInteger(status) && status >= 400 && status <= 599
    ? `PUSH_HTTP_${status}`
    : "PUSH_DELIVERY_FAILED";
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function deliverOne(salonId: string, id: string, now: Date) {
  const job = await withApprovedSalon(salonId, async tx => {
    const row = await tx.notificationOutbox.findFirst({
      where: {
        id, salonId, channel: "PUSH", status: "PENDING",
        template: { in: [...CLIENT_CHANGE_TEMPLATES] },
        createdAt: { gte: new Date(now.getTime() - MAX_AGE_MS) },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      select: { id: true, eventId: true, recipientId: true, payload: true, attempts: true },
    });
    if (!row) return null;
    const claimed = await tx.notificationOutbox.updateMany({
      where: { id, salonId, status: "PENDING", attempts: row.attempts,
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + 5 * 60_000) },
    });
    if (!claimed.count) return null;
    const payload = asObject(row.payload);
    const subscriptionId = payload.pushSubscriptionId;
    const subscription = typeof subscriptionId === "string"
      ? await tx.clientPushSubscription.findFirst({
          where: { id: subscriptionId, salonId, clientId: row.recipientId ?? "", revokedAt: null },
          select: { id: true, endpoint: true, p256dh: true, auth: true },
        })
      : null;
    if (!subscription) {
      await tx.notificationOutbox.updateMany({ where: { id, salonId },
        data: { status: "FAILED", lastError: "PUSH_SUBSCRIPTION_REVOKED", nextAttemptAt: null } });
      return null;
    }
    return { row, payload, subscription };
  });
  if (!job) return;

  const { title, body, url } = job.payload;
  if (typeof title !== "string" || typeof body !== "string" || typeof url !== "string") {
    await withSalon(salonId, tx => tx.notificationOutbox.updateMany({ where: { id, salonId },
      data: { status: "FAILED", lastError: "CHANGE_PAYLOAD_INVALID", nextAttemptAt: null } }));
    return;
  }

  // Duas tentativas rápidas (queda curta de rede, 5xx do provedor); o resto o
  // cron diário reentrega.
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await sendClientPush({
        ...job.subscription, title, body, url,
        tag: `appointment-change:${job.row.eventId}`,
        ttlSeconds: MAX_AGE_MS / 1000,
      });
      await withSalon(salonId, tx => tx.notificationOutbox.updateMany({
        where: { id, salonId, status: "PENDING" },
        data: { status: "SENT", sentAt: new Date(), nextAttemptAt: null, lastError: null },
      }));
      return;
    } catch (error) {
      lastError = error;
      const code = safeErrorCode(error);
      if (isFinalClientError(code)) break;
      await pause(attempt === 0 ? 1500 : 0);
    }
  }
  const code = safeErrorCode(lastError);
  const permanent = code === "PUSH_HTTP_404" || code === "PUSH_HTTP_410";
  const exhausted = job.row.attempts + 1 >= MAX_ATTEMPTS || isFinalClientError(code);
  await withSalon(salonId, async tx => {
    await tx.notificationOutbox.updateMany({ where: { id, salonId, status: "PENDING" },
      data: {
        status: permanent || exhausted ? "FAILED" : "PENDING",
        lastError: code,
        nextAttemptAt: permanent || exhausted ? null : new Date(Date.now() + 15 * 60_000),
      } });
    if (permanent) {
      await tx.clientPushSubscription.updateMany({ where: { id: job.subscription.id, salonId },
        data: { revokedAt: new Date() } });
    }
  });
}

/** Entrega os avisos pendentes de cancelamento e remarcação dos salões. */
export async function deliverPendingClientChangeNotices(salonIds: string[], now = new Date()) {
  if (!clientPushEnabled()) return;
  const channel: NotificationChannel = "PUSH";
  for (const salonId of salonIds) {
    const pending = await withApprovedSalon(salonId, tx => tx.notificationOutbox.findMany({
      where: {
        salonId, channel, status: "PENDING",
        template: { in: [...CLIENT_CHANGE_TEMPLATES] },
        createdAt: { gte: new Date(now.getTime() - MAX_AGE_MS) },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      select: { id: true }, orderBy: { createdAt: "asc" }, take: BATCH,
    }));
    if (!pending?.length) continue;
    for (let index = 0; index < pending.length; index += 8) {
      await Promise.allSettled(pending.slice(index, index + 8).map(row => deliverOne(salonId, row.id, now)));
    }
  }
}

/**
 * Agenda a entrega para depois da resposta da requisição. Fora de uma
 * requisição (cron, scripts, testes) não há onde agendar: o cron diário entrega.
 */
export function scheduleClientChangeDelivery(salonId: string) {
  try {
    after(async () => {
      try {
        await deliverPendingClientChangeNotices([salonId]);
      } catch (error) {
        console.error("[client-change-notice] delivery failed", {
          name: error instanceof Error ? error.name : typeof error,
        });
      }
    });
  } catch {
    /* Sem contexto de requisição. */
  }
}
