import { getServerSession } from "next-auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { billingEnabled } from "@/lib/billing/config";
import { BILLING_INTENT_COOKIE, rememberedBillingIntent } from "@/lib/billing/intent-cookie";
import { billingIntentHref } from "@/lib/billing/presentation";

/**
 * Destino confiável após o login. A decisão acontece no servidor e nunca
 * depende de um papel enviado pelo navegador.
 */
export default async function PostLoginPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  if (await isPlatformAdmin(session.user.id)) {
    redirect("/plataforma");
  }

  // A plan chosen before e-mail confirmation continues where it stopped; /contratar consumes it.
  const intent = billingEnabled() ? rememberedBillingIntent((await cookies()).get(BILLING_INTENT_COOKIE)?.value) : undefined;
  if (intent) redirect(billingIntentHref(intent, "/contratar"));

  redirect("/dashboard");
}
