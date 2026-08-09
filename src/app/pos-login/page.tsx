import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform-admin";

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

  redirect("/dashboard");
}
