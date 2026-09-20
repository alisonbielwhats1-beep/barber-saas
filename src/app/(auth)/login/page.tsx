import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { PremiumLoginShell } from "@/components/marketing/login-shell";
import { PasswordRecoveryLoginLink } from "@/components/password-recovery-login-link";

export default function LoginPage() {
  return (
    <PremiumLoginShell>
      <Suspense fallback={null}>
        <LoginForm recoveryLink={<PasswordRecoveryLoginLink href="/recuperar-senha" supportHref="/contato" className="text-sm" />} />
      </Suspense>
    </PremiumLoginShell>
  );
}
