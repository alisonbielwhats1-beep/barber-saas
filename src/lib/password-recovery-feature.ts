type PasswordRecoveryEnvironment = Record<string, string | undefined>;

export function passwordRecoveryEmailEnabled(
  environment: PasswordRecoveryEnvironment = process.env,
): boolean {
  return Boolean(
    environment.RESEND_API_KEY?.trim() && environment.EMAIL_FROM?.trim(),
  );
}
