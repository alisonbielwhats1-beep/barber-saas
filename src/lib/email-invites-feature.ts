export const EMAIL_INVITES_DISABLED_MESSAGE =
  "Convites por e-mail estão temporariamente indisponíveis.";

type EmailInviteEnvironment = Record<string, string | undefined>;

export function emailInvitesEnabled(
  environment: EmailInviteEnvironment = process.env,
): boolean {
  return (
    environment.EMAIL_INVITES_ENABLED === "true" &&
    Boolean(environment.RESEND_API_KEY?.trim()) &&
    Boolean(environment.EMAIL_FROM?.trim())
  );
}

export function assertEmailInvitesEnabled(
  environment?: EmailInviteEnvironment,
): void {
  if (!emailInvitesEnabled(environment)) {
    throw new Error(EMAIL_INVITES_DISABLED_MESSAGE);
  }
}
