import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { checkRateLimit, clientIp } from "./rate-limit";
import { safeNextAuthRedirect } from "./safe-callback";
import { bcryptPasswordSchema } from "./password";
import { z } from "zod";

const DUMMY_ADMIN_PASSWORD_HASH =
  "$2a$10$EpwUuprmRRoDuqmTMprHZO/QYoydyJx0wblP26vSqDEMK1BhV/K1K";

const adminCredentialsSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: bcryptPasswordSchema(6, "Senha inválida."),
  })
  .strict();

/**
 * NextAuth v4 — Credentials + JWT (stateless).
 *
 * Não gravamos memberships/role no JWT: eles vêm do `Membership` a cada
 * request via `getTenantContext()`. Assim, se o dono muda a role de alguém,
 * a mudança vale já na próxima requisição, sem esperar o token expirar.
 *
 * `authorize()` fica em `prisma` cru de propósito: só toca `User`, que é
 * explicitamente excluído do RLS (`01_enable_rls.sql`) — o login busca a
 * pessoa por e-mail antes de qualquer salão existir na sessão, e um usuário
 * pode ter memberships em vários salões, então não há um `salonId` único
 * que descreva a linha.
 */
export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials, request) {
        const parsed = adminCredentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        const ip = clientIp(new Headers(request.headers));
        const [ipLimit, accountLimit] = await Promise.all([
          checkRateLimit({
            namespace: "admin-login-ip",
            identifier: ip,
            limit: 30,
            windowSeconds: 15 * 60,
            failClosed: true,
          }),
          checkRateLimit({
            namespace: "admin-login-account",
            identifier: email,
            limit: 8,
            windowSeconds: 15 * 60,
            failClosed: true,
          }),
        ]);
        if (!ipLimit.allowed || !accountLimit.allowed) return null;

        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            name: true,
            passwordHash: true,
            passwordSetAt: true,
            sessionVersion: true,
            avatarUrl: true,
          },
        });
        const valid = await bcrypt.compare(
          password,
          user?.passwordHash ?? DUMMY_ADMIN_PASSWORD_HASH,
        );
        if (!user || !valid) return null;
        // Backfill seguro e gradual: uma senha só é marcada como configurada
        // depois que seu conhecimento foi comprovado por login bem-sucedido.
        if (user.passwordSetAt === null) {
          await prisma.user.update({
            where: { id: user.id },
            data: { passwordSetAt: new Date() },
          });
        }
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.avatarUrl ?? undefined,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    async redirect({ url, baseUrl }) {
      return safeNextAuthRedirect(url, baseUrl);
    },
    async jwt({ token, user }) {
      if (user) {
        token.uid = (user as { id: string }).id;
        token.sessionVersion = (user as { sessionVersion?: number }).sessionVersion ?? 0;
      } else if (token.uid) {
        try {
          const current = await prisma.user.findUnique({
            where: { id: token.uid },
            select: { sessionVersion: true },
          });
          if (!current || current.sessionVersion !== (token.sessionVersion ?? 0)) {
            token.uid = undefined;
          }
        } catch {
          // Sem banco não é possível provar que a sessão ainda não foi revogada.
          token.uid = undefined;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = typeof token.uid === "string" ? token.uid : "";
      }
      return session;
    },
  },
};
