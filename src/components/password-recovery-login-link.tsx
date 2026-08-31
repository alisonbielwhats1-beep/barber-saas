import Link from "next/link";
import { passwordRecoveryEmailEnabled } from "@/lib/password-recovery-feature";

export function PasswordRecoveryLoginLink({
  href,
  className = "text-center text-sm text-muted-foreground",
}: {
  href: string;
  className?: string;
}) {
  if (!passwordRecoveryEmailEnabled()) return null;

  return (
    <p className={className}>
      Esqueceu a senha?{" "}
      <Link href={href} className="font-medium text-primary transition hover:underline">
        Recuperar por e-mail
      </Link>
    </p>
  );
}
