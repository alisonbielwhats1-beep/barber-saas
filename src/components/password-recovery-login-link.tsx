import Link from "next/link";
import { passwordRecoveryEmailEnabled } from "@/lib/password-recovery-feature";

export function PasswordRecoveryLoginLink({
  href,
  className = "text-center text-sm text-muted-foreground",
  supportHref,
}: {
  href: string;
  className?: string;
  supportHref?: string;
}) {
  if (!passwordRecoveryEmailEnabled()) return supportHref ? (
    <p className={className}><Link href={supportHref} className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4">Precisa de ajuda para entrar?</Link></p>
  ) : null;

  return (
    <p className={className}>
      <Link href={href} className="inline-flex min-h-11 items-center font-medium text-primary transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Esqueci minha senha
      </Link>
    </p>
  );
}
