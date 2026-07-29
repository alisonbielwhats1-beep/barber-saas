import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { checkRateLimit, clientIp } from "./rate-limit";
import { safeNextAuthRedirect } from "./safe-callback";

/**
 * NextAuth v4 — Credentials + JWT (stateless).
 *
 * Não gravamos memberships/role no JWT: eles vêm do `Membership` a cada
 * request via `getTenantContext()`. Assim, se o dono muda a role de alguém,
 * a mudança vale já na próxima requisição, sem esperar o token expirar.
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
        if (!credentials?.email || !credentials?.password) return null;
        const email = credentials.email.toLowerCase().trim();
        const limited = await checkRateLimit({
          namespace: "admin-login",
          identifier: `${clientIp(new Headers(request.headers))}:${email}`,
          limit: 8,
          windowSeconds: 15 * 60,
        });
        if (!limited.allowed) return null;

        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            name: true,
            passwordHash: true,
            passwordSetAt: true,
            avatarUrl: true,
          },
        });
        if (!user) return null;
        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) return null;
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
        };
      },
    }),
  ],
  callbacks: {
    async redirect({ url, baseUrl }) {
      return safeNextAuthRedirect(url, baseUrl);
    },
    async jwt({ token, user }) {
      if (user) token.uid = (user as { id: string }).id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.uid) {
        (session.user as { id?: string }).id = token.uid as string;
      }
      return session;
    },
  },
};
