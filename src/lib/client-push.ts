import webPush from "web-push";
import { z } from "zod";

const subscriptionInput = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(40).max(256),
    auth: z.string().min(12).max(128),
  }),
});

export type ClientPushSubscriptionInput = z.infer<typeof subscriptionInput>;

export function clientPushEnabled(env: Record<string, string | undefined> = process.env) {
  return env.CLIENT_PUSH_ENABLED === "true"
    && !!env.VAPID_PUBLIC_KEY
    && !!env.VAPID_PRIVATE_KEY
    && !!env.VAPID_SUBJECT
    && (env.VAPID_SUBJECT.startsWith("mailto:") || env.VAPID_SUBJECT.startsWith("https://"));
}

export function reminderEmailEnabled(env: Record<string, string | undefined> = process.env) {
  if (env.CLIENT_REMINDER_EMAIL_ENABLED !== "true"
    || !env.RESEND_API_KEY || !env.EMAIL_FROM || !env.NEXTAUTH_URL) return false;
  try {
    const url = new URL(env.NEXTAUTH_URL);
    return url.protocol === "https:" || (env.NODE_ENV !== "production" && url.protocol === "http:");
  } catch { return false; }
}

/** Browser-generated endpoints only. Never allow the subscription API to turn
 * the reminder worker into an arbitrary HTTP client. */
export function isAllowedPushEndpoint(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash) return false;
    const host = url.hostname.toLowerCase();
    return host === "fcm.googleapis.com"
      || host === "updates.push.services.mozilla.com"
      || host === "web.push.apple.com"
      || host.endsWith(".push.apple.com")
      || host.endsWith(".notify.windows.com");
  } catch { return false; }
}

export function parseClientPushSubscription(value: unknown): ClientPushSubscriptionInput {
  const subscription = subscriptionInput.parse(value);
  if (!isAllowedPushEndpoint(subscription.endpoint)) {
    throw new Error("Endpoint de notificação não permitido.");
  }
  return subscription;
}

export async function sendClientPush(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  title: string;
  body: string;
  url: string;
  tag: string;
  ttlSeconds: number;
}) {
  if (!clientPushEnabled()) throw new Error("PUSH_NOT_CONFIGURED");
  if (!isAllowedPushEndpoint(input.endpoint)) throw new Error("PUSH_ENDPOINT_INVALID");
  const subject = process.env.VAPID_SUBJECT!;
  if (!subject.startsWith("mailto:") && !subject.startsWith("https://")) {
    throw new Error("VAPID_SUBJECT_INVALID");
  }
  await webPush.sendNotification(
    { endpoint: input.endpoint, keys: { p256dh: input.p256dh, auth: input.auth } },
    JSON.stringify({
      title: input.title,
      body: input.body,
      url: input.url,
      tag: input.tag,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
    }),
    {
      vapidDetails: {
        subject,
        publicKey: process.env.VAPID_PUBLIC_KEY!,
        privateKey: process.env.VAPID_PRIVATE_KEY!,
      },
      TTL: Math.max(0, Math.min(24 * 60 * 60, Math.floor(input.ttlSeconds))),
      urgency: "normal",
    },
  );
}
