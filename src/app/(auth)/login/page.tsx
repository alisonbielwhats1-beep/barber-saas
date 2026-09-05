import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { PremiumLoginShell } from "@/components/marketing/login-shell";
import { PasswordRecoveryLoginLink } from "@/components/password-recovery-login-link";

export default function LoginPage() {
  return (
    <PremiumLoginShell>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
      <PasswordRecoveryLoginLink
        href="/recuperar-senha"
        className="mt-4 text-center text-[12px] text-foreground/70"
      />
    </PremiumLoginShell>
  );
}
