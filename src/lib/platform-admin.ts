import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "./auth";
import { prisma } from "./prisma";

function bootstrapEmails(): Set<string> {
  return new Set(
    (process.env.PLATFORM_ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export type PlatformAdminContext = {
  userId: string;
  email: string;
  name: string;
};

/**
 * Autoriza a administração entre tenants. A lista de e-mails é apenas o
 * bootstrap inicial: no primeiro acesso ela promove o usuário no banco, e as
 * próximas requisições passam a depender do papel persistido.
 */
export async function getPlatformAdminContext(): Promise<PlatformAdminContext> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, platformRole: true },
  });
  if (!user) redirect("/login");

  if (
    user.platformRole !== "SUPER_ADMIN" &&
    !bootstrapEmails().has(user.email.toLowerCase())
  ) {
    redirect("/dashboard");
  }

  if (user.platformRole !== "SUPER_ADMIN") {
    await prisma.user.update({
      where: { id: user.id },
      data: { platformRole: "SUPER_ADMIN" },
    });
  }

  return { userId: user.id, email: user.email, name: user.name };
}

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, platformRole: true },
  });
  return Boolean(
    user &&
      (user.platformRole === "SUPER_ADMIN" ||
        bootstrapEmails().has(user.email.toLowerCase())),
  );
}
