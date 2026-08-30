import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PasswordResetForm } from "@/components/password-reset-form";
import { withSalonBySlug } from "@/lib/prisma-tenant";

export const metadata: Metadata = {
  title: "Criar nova senha",
  robots: { index: false, follow: false },
};

export default async function ClientResetPasswordPage({
  params,
}: {
  params: Promise<{ salonSlug: string; token: string }>;
}) {
  const { salonSlug, token } = await params;
  const salon = await withSalonBySlug(salonSlug, (tx, salonId) =>
    tx.salon.findUnique({ where: { id: salonId }, select: { name: true } }),
  );
  if (!salon) notFound();

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">{salon.name}</p>
          <h1 className="mt-1 text-2xl font-semibold">Criar nova senha</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Depois da alteração, entre novamente para acessar suas reservas.
          </p>
        </div>
        <PasswordResetForm token={token} salonSlug={salonSlug} />
        <div className="text-center">
          <Link href={`/book/${salonSlug}/recuperar-senha`} className="text-xs text-muted-foreground hover:text-foreground">
            Solicitar outro link
          </Link>
        </div>
      </div>
    </main>
  );
}
