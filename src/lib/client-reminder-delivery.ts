import "server-only";
import type { NotificationChannel, Prisma } from "@prisma/client";
import { withApprovedSalon, withSalon, type Tx } from "./prisma-tenant";
import { clientPushEnabled, reminderEmailEnabled, sendClientPush } from "./client-push";
import { reminderCopy, reminderIsCurrent } from "./client-reminders";
import { defaultMailer } from "./mailer";

const TEMPLATES = ["appointment.reminder", "appointment.reminder.today"];
const MAX_PER_SALON = 120;

function payloadObject(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function fallbackEmail(tx: Tx, row: {
  id: string;
  salonId: string;
  eventId: string;
  appointmentId: string;
  recipientId: string | null;
  template: string;
  payload: Prisma.JsonValue | Record<string, unknown>;
}) {
  if (!reminderEmailEnabled() || !row.recipientId) return Promise.resolve();
  return tx.clientProfile.findFirst({
    where: { id: row.recipientId, salonId: row.salonId, mergedIntoId: null },
    select: { email: true, authIdentityId: true, passwordHash: true },
  }).then(async client => {
    if (!client?.email || !(client.authIdentityId || client.passwordHash)) return;
    const remaining = await tx.notificationOutbox.count({
      where: { eventId: row.eventId, salonId: row.salonId, channel: "PUSH", status: { not: "FAILED" } },
    });
    if (remaining) return;
    await tx.notificationOutbox.createMany({
      data: [{
        salonId: row.salonId,
        eventId: row.eventId,
        appointmentId: row.appointmentId,
        recipientType: "CLIENT",
        recipientId: row.recipientId,
        recipientKey: `CLIENT:${row.recipientId}:EMAIL`,
        channel: "EMAIL",
        template: row.template,
        payload: row.payload as Prisma.InputJsonValue,
        status: "PENDING",
      }],
      skipDuplicates: true,
    });
  });
}

function safeErrorCode(error: unknown, channel: NotificationChannel) {
  const status = error && typeof error === "object" && "statusCode" in error
    ? Number(error.statusCode)
    : null;
  return status && Number.isInteger(status) && status >= 400 && status <= 599
    ? `${channel}_HTTP_${status}`
    : `${channel}_DELIVERY_FAILED`;
}

async function sendOne(salonId: string, id: string, now: Date) {
  const job = await withApprovedSalon(salonId, async tx => {
    const row = await tx.notificationOutbox.findFirst({
      where: { id, salonId, channel: { in: ["PUSH", "EMAIL"] }, status: "PENDING",
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      select: {
        id: true, salonId: true, eventId: true, appointmentId: true,
        recipientId: true, channel: true, template: true, payload: true, attempts: true,
        appointment: { select: { status: true, startAt: true } },
      },
    });
    if (!row) return null;
    const payload = payloadObject(row.payload);
    if (!reminderIsCurrent({
      status: row.appointment.status,
      appointmentStartAt: row.appointment.startAt,
      payloadStartAt: payload.startAt,
      now,
      phase: row.template === "appointment.reminder.today" ? "today" : "tomorrow",
      timezone: typeof payload.timezone === "string" ? payload.timezone : undefined,
    })) {
      await tx.notificationOutbox.updateMany({ where: { id, salonId, status: "PENDING" },
        data: { status: "FAILED", lastError: "STALE_REMINDER" } });
      return null;
    }
    const claimed = await tx.notificationOutbox.updateMany({
      where: { id, salonId, status: "PENDING", attempts: row.attempts,
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + 10 * 60_000) },
    });
    if (!claimed.count) return null;
    if (row.channel === "PUSH") {
      const subscriptionId = payload.pushSubscriptionId;
      const subscription = typeof subscriptionId === "string"
        ? await tx.clientPushSubscription.findFirst({
            where: { id: subscriptionId, salonId, clientId: row.recipientId ?? "", revokedAt: null },
            select: { id: true, endpoint: true, p256dh: true, auth: true },
          })
        : null;
      if (!subscription) {
        await tx.notificationOutbox.updateMany({ where: { id, salonId },
          data: { status: "FAILED", lastError: "PUSH_SUBSCRIPTION_REVOKED" } });
        await fallbackEmail(tx, row);
        return null;
      }
      return { ...row, payload, subscription };
    }
    const client = row.recipientId ? await tx.clientProfile.findFirst({
      where: { id: row.recipientId, salonId, mergedIntoId: null },
      select: { email: true, authIdentityId: true, passwordHash: true },
    }) : null;
    if (!client?.email || !(client.authIdentityId || client.passwordHash)) {
      await tx.notificationOutbox.updateMany({ where: { id, salonId },
        data: { status: "FAILED", lastError: "EMAIL_RECIPIENT_UNAVAILABLE" } });
      return null;
    }
    return { ...row, payload, email: client.email };
  });
  if (!job) return;

  const { salonName, salonSlug, timezone } = job.payload;
  if (typeof salonName !== "string" || typeof salonSlug !== "string" || typeof timezone !== "string") {
    await withSalon(salonId, tx => tx.notificationOutbox.updateMany({ where: { id, salonId },
      data: { status: "FAILED", lastError: "REMINDER_PAYLOAD_INVALID" } }));
    return;
  }
  const phase = job.template === "appointment.reminder.today" ? "today" : "tomorrow";
  const latest = await withApprovedSalon(salonId, tx => tx.appointment.findFirst({
    where: { id: job.appointmentId, salonId }, select: { status: true, startAt: true },
  }));
  if (!latest || !reminderIsCurrent({ status: latest.status, appointmentStartAt: latest.startAt,
    payloadStartAt: job.payload.startAt, now: new Date(), phase, timezone })) {
    await withSalon(salonId, tx => tx.notificationOutbox.updateMany({ where: { id, salonId, status: "PENDING" },
      data: { status: "FAILED", lastError: "STALE_REMINDER", nextAttemptAt: null } }));
    return;
  }
  const copy = reminderCopy({ phase, salonName, timezone, startAt: latest.startAt });
  const url = `/book/${encodeURIComponent(salonSlug)}/minhas`;
  try {
    if (job.channel === "PUSH" && "subscription" in job && job.subscription) {
      await sendClientPush({ ...job.subscription, ...copy, url, tag: `appointment-reminder:${job.eventId}`,
        ttlSeconds: (latest.startAt.getTime() - Date.now()) / 1000 });
    } else if (job.channel === "EMAIL" && "email" in job && job.email && reminderEmailEnabled()) {
      const base = new URL(process.env.NEXTAUTH_URL!);
      const link = new URL(url, base).toString();
      const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
      const safeName = escapeHtml(salonName);
      await defaultMailer.send({
        to: job.email,
        subject: `${phase === "today" ? "Hoje" : "Amanhã"}: lembrete do seu horário no EverFlair`,
        text: `${copy.title}\n\n${copy.body}\n\nVeja sua reserva: ${link}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#171717"><p style="color:#8055cb;font-weight:700">EVERFLAIR · ${safeName}</p><h1>${copy.title}</h1><p>${escapeHtml(copy.body)}</p><p><a href="${link}" style="display:inline-block;padding:12px 20px;border-radius:12px;background:#8055cb;color:#fff;text-decoration:none">Ver meu agendamento</a></p></div>`,
      }, { idempotencyKey: job.id });
    } else {
      throw new Error("CHANNEL_DISABLED");
    }
    await withSalon(salonId, tx => tx.notificationOutbox.updateMany({
      where: { id, salonId, status: "PENDING" },
      data: { status: "SENT", sentAt: new Date(), nextAttemptAt: null, lastError: null },
    }));
  } catch (error) {
    const code = safeErrorCode(error, job.channel);
    const permanent = code === "PUSH_HTTP_404" || code === "PUSH_HTTP_410";
    const exhausted = job.attempts + 1 >= 3;
    await withSalon(salonId, async tx => {
      await tx.notificationOutbox.updateMany({ where: { id, salonId, status: "PENDING" },
        data: { status: permanent || exhausted ? "FAILED" : "PENDING", lastError: code,
          nextAttemptAt: permanent || exhausted ? null : new Date(Date.now() + (job.attempts + 1) * 15 * 60_000) } });
      if (permanent && "subscription" in job && job.subscription) {
        await tx.clientPushSubscription.updateMany({ where: { id: job.subscription.id, salonId },
          data: { revokedAt: new Date() } });
      }
      if ((permanent || exhausted) && job.channel === "PUSH") await fallbackEmail(tx, job);
    });
  }
}

export async function deliverPendingClientReminders(salonIds: string[], now = new Date()) {
  const channels: NotificationChannel[] = [];
  if (clientPushEnabled()) channels.push("PUSH");
  if (reminderEmailEnabled()) channels.push("EMAIL");
  if (!channels.length) return;
  for (const salonId of salonIds) {
    let processed = 0;
    while (processed < MAX_PER_SALON) {
      const pending = await withApprovedSalon(salonId, tx => tx.notificationOutbox.findMany({
        where: { salonId, channel: { in: channels }, template: { in: TEMPLATES },
          status: "PENDING", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        select: { id: true }, orderBy: { createdAt: "asc" }, take: Math.min(40, MAX_PER_SALON - processed),
      }));
      if (!pending?.length) break;
      for (let index = 0; index < pending.length; index += 8) {
        const results = await Promise.allSettled(pending.slice(index, index + 8).map(row => sendOne(salonId, row.id, now)));
        if (results.some(result => result.status === "rejected")) {
          throw new Error("CLIENT_REMINDER_DELIVERY_FAILED");
        }
      }
      processed += pending.length;
    }
  }
}
