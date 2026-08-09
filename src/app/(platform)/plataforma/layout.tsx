import Link from "next/link";
import { ArrowLeft, Building2, LayoutDashboard, ShieldCheck, WalletCards } from "lucide-react";
import { getPlatformAdminContext } from "@/lib/platform-admin";
import { isPlatformBillingEnabled } from "@/lib/platform-billing";
import { Toaster } from "@/components/ui/toast";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const admin = await getPlatformAdminContext();
  const billingEnabled = isPlatformBillingEnabled();

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold">Administração da plataforma</p>
              <p className="text-xs text-muted-foreground">{admin.name}</p>
            </div>
          </div>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Voltar ao painel
          </Link>
        </div>
      </header>
      <nav className="border-b border-border bg-background/80" aria-label="Administração global">
        <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-5 py-2">
          <PlatformNavLink href="/plataforma" label="Visão geral" icon={LayoutDashboard} />
          <PlatformNavLink href="/plataforma/solicitacoes" label="Estabelecimentos" icon={Building2} />
          {billingEnabled ? (
            <PlatformNavLink href="/plataforma/cobrancas" label="Cobranças" icon={WalletCards} />
          ) : (
            <span
              className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-sm text-muted-foreground/50"
              title="Aguardando validação da migration em homologação"
            >
              <WalletCards className="h-4 w-4" /> Cobranças em preparação
            </span>
          )}
        </div>
      </nav>
      <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
      <Toaster />
    </div>
  );
}

function PlatformNavLink({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
}) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-sm text-muted-foreground transition hover:bg-card hover:text-foreground"
    >
      <Icon className="h-4 w-4" /> {label}
    </Link>
  );
}
