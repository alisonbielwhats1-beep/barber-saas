import { describe, expect, it, vi } from "vitest";
import { clientPushEnabled, isAllowedPushEndpoint, parseClientPushSubscription, reminderEmailEnabled } from "@/lib/client-push";
import { queueClientReminderChannels, reminderCopy, reminderIdempotencyKey, reminderIsCurrent, reminderTemplate } from "@/lib/client-reminders";
import type { Tx } from "@/lib/prisma-tenant";

describe("lembretes do cliente", () => {
  it("separa véspera e dia sem duplicar a chave histórica", () => {
    expect(reminderIdempotencyKey("tomorrow", "2032-08-05")).toBe("reminder:2032-08-05");
    expect(reminderIdempotencyKey("today", "2032-08-05")).toBe("reminder:today:2032-08-05");
    expect(reminderTemplate("tomorrow")).toBe("appointment.reminder");
    expect(reminderTemplate("today")).toBe("appointment.reminder.today");
  });

  it("usa o fuso do salão e impede aviso de reserva remarcada ou cancelada", () => {
    const startAt = new Date("2032-08-05T13:30:00Z");
    expect(reminderCopy({ phase: "today", salonName: "Ateliê", startAt, timezone: "America/Sao_Paulo" }).body)
      .toContain("10:30");
    const current = { status: "CONFIRMED", appointmentStartAt: startAt, payloadStartAt: startAt.toISOString(), now: new Date("2032-08-05T12:00:00Z") };
    expect(reminderIsCurrent(current)).toBe(true);
    expect(reminderIsCurrent({ ...current, status: "CANCELLED" })).toBe(false);
    expect(reminderIsCurrent({ ...current, payloadStartAt: "2032-08-05T14:00:00.000Z" })).toBe(false);
    expect(reminderIsCurrent({ ...current, now: startAt })).toBe(false);
    expect(reminderIsCurrent({ ...current, phase: "tomorrow", timezone: "America/Sao_Paulo" })).toBe(false);
  });

  it("enfileira um push por aparelho e e-mail apenas se não houver aparelho", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "device-a" }, { id: "device-b" }]);
    const findFirst = vi.fn().mockResolvedValue({ email: "cliente@example.test", passwordHash: "hash", authIdentityId: null });
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const tx = { clientPushSubscription: { findMany }, clientProfile: { findFirst }, notificationOutbox: { createMany } } as unknown as Tx;
    const input = { salonId: "salon-a", clientId: "client-a", appointmentId: "appointment-a", eventId: "event-a", template: "appointment.reminder", payload: { startAt: "2032-08-05T13:30:00.000Z" }, pushEnabled: true, emailEnabled: true };
    await queueClientReminderChannels(tx, input);
    expect(createMany).toHaveBeenCalledWith({ data: expect.arrayContaining([
      expect.objectContaining({ recipientKey: "CLIENT:client-a:PUSH:device-a", channel: "PUSH" }),
      expect.objectContaining({ recipientKey: "CLIENT:client-a:PUSH:device-b", channel: "PUSH" }),
    ]), skipDuplicates: true });
    expect(createMany.mock.calls[0]![0].data).toHaveLength(2);
    expect(findFirst).not.toHaveBeenCalled();

    findMany.mockResolvedValue([]);
    await queueClientReminderChannels(tx, input);
    expect(createMany.mock.calls[1]![0].data).toEqual([expect.objectContaining({ channel: "EMAIL", recipientKey: "CLIENT:client-a:EMAIL" })]);
  });

  it("só habilita canais com flags e configuração completas", () => {
    expect(clientPushEnabled({ CLIENT_PUSH_ENABLED: "true", VAPID_PUBLIC_KEY: "public", VAPID_PRIVATE_KEY: "private", VAPID_SUBJECT: "mailto:test@example.test" })).toBe(true);
    expect(clientPushEnabled({ CLIENT_PUSH_ENABLED: "true", VAPID_PUBLIC_KEY: "public" })).toBe(false);
    expect(reminderEmailEnabled({ CLIENT_REMINDER_EMAIL_ENABLED: "true", RESEND_API_KEY: "key", EMAIL_FROM: "EverFlair <mail@example.test>", NEXTAUTH_URL: "https://example.test" })).toBe(true);
    expect(reminderEmailEnabled({ CLIENT_REMINDER_EMAIL_ENABLED: "true" })).toBe(false);
  });

  it("rejeita endpoints arbitrários que poderiam ser usados como SSRF", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/test")).toBe(true);
    expect(isAllowedPushEndpoint("https://web.push.apple.com/test")).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/test")).toBe(true);
    for (const endpoint of ["http://fcm.googleapis.com/test", "https://fcm.googleapis.com.evil.test/x", "https://127.0.0.1/x", "https://web.push.apple.com:8443/x"]) {
      expect(isAllowedPushEndpoint(endpoint)).toBe(false);
    }
    expect(() => parseClientPushSubscription({ endpoint: "https://127.0.0.1/x", keys: { p256dh: "a".repeat(50), auth: "a".repeat(20) } })).toThrow();
  });
});
