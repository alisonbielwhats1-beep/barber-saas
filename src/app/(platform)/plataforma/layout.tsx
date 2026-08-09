import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { getPlatformAdminContext } from "@/lib/platform-admin";
import { Toaster } from "@/components/ui/toast";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const admin = await getPlatformAdminContext();

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
      <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
      <Toaster />
    </div>
  );
}
