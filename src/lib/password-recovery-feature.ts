type PasswordRecoveryEnvironment = Record<string, string | undefined>;

export function passwordRecoveryEmailEnabled(
  environment: PasswordRecoveryEnvironment = process.env,
): boolean {
  if (environment.AUTH_PROVIDER === "supabase") {
    return Boolean(environment.SUPABASE_URL && environment.SUPABASE_AUTH_PUBLISHABLE_KEY &&
      environment.AUTH_EMAIL_ENABLED === "true");
  }
  return Boolean(
    environment.RESEND_API_KEY?.trim() && environment.EMAIL_FROM?.trim(),
  );
}
