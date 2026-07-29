export type MailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type MailResult = {
  messageId: string;
};

export interface Mailer {
  send(message: MailMessage): Promise<MailResult>;
}

export class MailerConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailerConfigurationError";
  }
}

export class MailDeliveryError extends Error {
  readonly code: string;

  constructor(code: string) {
    super("O provedor de e-mail não confirmou o envio.");
    this.name = "MailDeliveryError";
    this.code = code;
  }
}

export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey = process.env.RESEND_API_KEY,
    private readonly from = process.env.EMAIL_FROM,
  ) {}

  async send(message: MailMessage): Promise<MailResult> {
    if (!this.apiKey || !this.from) {
      throw new MailerConfigurationError(
        "RESEND_API_KEY e EMAIL_FROM precisam estar configurados.",
      );
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new MailDeliveryError(`RESEND_HTTP_${response.status}`);
    }

    const payload = (await response.json()) as { id?: unknown };
    if (typeof payload.id !== "string" || payload.id.length === 0) {
      throw new MailDeliveryError("RESEND_INVALID_RESPONSE");
    }
    return { messageId: payload.id };
  }
}

export const defaultMailer: Mailer = new ResendMailer();

