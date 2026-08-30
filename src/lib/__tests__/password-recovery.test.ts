import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  userUpdateMany: vi.fn(),
  clientFindFirst: vi.fn(),
  clientUpdate: vi.fn(),
  clientUpdateMany: vi.fn(),
  salonFindUnique: vi.fn(),
  withSalonBySlug: vi.fn(),
  bcryptHash: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mocks.userFindUnique,
      update: mocks.userUpdate,
      updateMany: mocks.userUpdateMany,
    },
  },
}));
vi.mock("@/lib/prisma-tenant", () => ({
  withSalonBySlug: mocks.withSalonBySlug,
}));
vi.mock("bcryptjs", () => ({ default: { hash: mocks.bcryptHash } }));

import {
  consumeAdminPasswordReset,
  consumeClientPasswordReset,
  hashPasswordResetToken,
  issueAdminPasswordReset,
  issueClientPasswordReset,
} from "@/lib/password-recovery";

const tx = {
  salon: { findUnique: mocks.salonFindUnique },
  clientProfile: {
    findFirst: mocks.clientFindFirst,
    update: mocks.clientUpdate,
    updateMany: mocks.clientUpdateMany,
  },
};

describe("serviço de recuperação de senha", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Salon <noreply@example.com>");
    vi.stubEnv("NEXTAUTH_URL", "https://app.example.com");
    mocks.userUpdate.mockResolvedValue({});
    mocks.userUpdateMany.mockResolvedValue({ count: 1 });
    mocks.clientUpdate.mockResolvedValue({});
    mocks.clientUpdateMany.mockResolvedValue({ count: 1 });
    mocks.salonFindUnique.mockResolvedValue({ name: "Studio A" });
    mocks.withSalonBySlug.mockImplementation(
      async (_slug: string, callback: (value: typeof tx, salonId: string) => unknown) =>
        callback(tx, "salon-a"),
    );
    mocks.bcryptHash.mockResolvedValue("novo-hash");
  });

  it("armazena somente o hash do token administrativo e envia o link", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "user-a", email: "owner@example.com", name: "Dona Ana" });
    const send = vi.fn().mockResolvedValue({ messageId: "message-a" });
    const now = new Date("2026-08-30T12:00:00.000Z");

    await issueAdminPasswordReset({ email: "owner@example.com", now, mailer: { send } });

    const data = mocks.userUpdate.mock.calls[0]?.[0].data;
    expect(data.passwordResetTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(data.passwordResetExpiresAt).toEqual(new Date("2026-08-30T13:00:00.000Z"));
    const text = send.mock.calls[0]?.[0].text as string;
    const token = text.match(/\/redefinir-senha\/([A-Za-z0-9_-]{43})/)?.[1];
    expect(token).toBeTruthy();
    expect(hashPasswordResetToken(token!)).toBe(data.passwordResetTokenHash);
    expect(mocks.userUpdate.mock.calls[0]?.[0]).not.toEqual(
      expect.objectContaining({ token }),
    );
  });

  it("não envia nem grava quando a conta não existe", async () => {
    mocks.userFindUnique.mockResolvedValue(null);
    const send = vi.fn();

    await issueAdminPasswordReset({ email: "missing@example.com", mailer: { send } });

    expect(send).not.toHaveBeenCalled();
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });

  it("remove o token se o provedor não confirmar o envio", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "user-a", email: "owner@example.com", name: "Dona Ana" });
    const send = vi.fn().mockRejectedValue(new Error("provider unavailable"));

    await issueAdminPasswordReset({ email: "owner@example.com", mailer: { send } });

    const tokenHash = mocks.userUpdate.mock.calls[0]?.[0].data.passwordResetTokenHash;
    expect(mocks.userUpdateMany).toHaveBeenCalledWith({
      where: { id: "user-a", passwordResetTokenHash: tokenHash },
      data: { passwordResetTokenHash: null, passwordResetExpiresAt: null },
    });
  });

  it("mantém solicitação e gravação do cliente dentro do salão resolvido", async () => {
    mocks.clientFindFirst.mockResolvedValue({
      id: "client-a",
      name: "Maria",
      email: "maria@example.com",
    });
    const send = vi.fn().mockResolvedValue({ messageId: "message-b" });

    await issueClientPasswordReset({
      salonSlug: "studio-a",
      email: "maria@example.com",
      mailer: { send },
    });

    expect(mocks.clientFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ salonId: "salon-a", email: "maria@example.com" }),
    }));
    expect(mocks.clientUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "client-a" },
    }));
    expect(send.mock.calls[0]?.[0].text).toContain("/book/studio-a/redefinir-senha/");
  });

  it("consome o token uma vez, troca o hash e revoga sessões administrativas", async () => {
    const now = new Date("2026-08-30T12:00:00.000Z");

    await expect(consumeAdminPasswordReset({ token: "token", password: "nova-senha", now }))
      .resolves.toBe(true);

    expect(mocks.userUpdateMany).toHaveBeenCalledWith({
      where: {
        passwordResetTokenHash: hashPasswordResetToken("token"),
        passwordResetExpiresAt: { gt: now },
      },
      data: {
        passwordHash: "novo-hash",
        passwordSetAt: now,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        sessionVersion: { increment: 1 },
      },
    });
  });

  it("consome token de cliente apenas no tenant da URL", async () => {
    await expect(consumeClientPasswordReset({
      salonSlug: "studio-a",
      token: "token",
      password: "nova-senha",
    })).resolves.toBe(true);

    expect(mocks.clientUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        salonId: "salon-a",
        passwordResetTokenHash: hashPasswordResetToken("token"),
      }),
      data: expect.objectContaining({ sessionVersion: { increment: 1 } }),
    }));
  });
});
