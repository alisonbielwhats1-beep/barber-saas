import { describe, expect, it, vi } from "vitest";
import {
  consumeUserInvite,
  generateInviteToken,
  hashInviteToken,
  type InviteRecord,
  type InviteRepository,
} from "@/lib/invitations";

const validToken = "valid-token-value-1234567890";

function memoryRepository(record: InviteRecord | null): InviteRepository {
  return {
    async findByTokenHash(tokenHash) {
      if (!record || tokenHash !== hashInviteToken(validToken)) return null;
      return { ...record };
    },
    async claimAndActivate(invite, now) {
      if (!record || record.id !== invite.id || record.usedAt) {
        return "UNAVAILABLE";
      }
      if (record.expiresAt.getTime() <= now.getTime()) return "UNAVAILABLE";
      record.usedAt = now;
      return "CLAIMED";
    },
  };
}

const now = new Date("2030-01-01T12:00:00.000Z");
const existingAccountInvite: InviteRecord = {
  id: "invite-a",
  salonId: "salon-a",
  email: "member@example.com",
  userId: "user-a",
  role: "RECEPTIONIST",
  emailVerificationRequired: false,
  expiresAt: new Date("2030-01-01T13:00:00.000Z"),
  usedAt: null,
};

describe("convites de uso único", () => {
  it("gera token criptograficamente imprevisível com 256 bits", () => {
    const first = generateInviteToken();
    const second = generateInviteToken();

    expect(first).not.toBe(second);
    expect(Buffer.from(first, "base64url")).toHaveLength(32);
  });

  it("token inválido não funciona", async () => {
    const result = await consumeUserInvite(
      "invalid-token-value-1234567890",
      {
        repository: memoryRepository({ ...existingAccountInvite }),
        now,
        actorUserId: "user-a",
      },
    );

    expect(result).toEqual({ ok: false, reason: "INVALID" });
  });

  it("token expirado não funciona", async () => {
    const result = await consumeUserInvite(validToken, {
      repository: memoryRepository({
        ...existingAccountInvite,
        expiresAt: new Date("2030-01-01T11:59:59.000Z"),
      }),
      now,
      actorUserId: "user-a",
    });

    expect(result).toEqual({ ok: false, reason: "EXPIRED" });
  });

  it("token já utilizado não funciona novamente", async () => {
    const result = await consumeUserInvite(validToken, {
      repository: memoryRepository({
        ...existingAccountInvite,
        usedAt: new Date(),
      }),
      now,
      actorUserId: "user-a",
    });

    expect(result).toEqual({ ok: false, reason: "USED" });
  });

  it("convite de conta nova não permite definir senha sem verificação", async () => {
    const claim = vi.fn();
    const repository: InviteRepository = {
      findByTokenHash: async () => ({
        ...existingAccountInvite,
        userId: null,
        emailVerificationRequired: true,
      }),
      claimAndActivate: claim,
    };

    const result = await consumeUserInvite(validToken, {
      repository,
      now,
      actorUserId: null,
    });

    expect(result).toEqual({
      ok: false,
      reason: "VERIFICATION_REQUIRED",
    });
    expect(claim).not.toHaveBeenCalled();
  });

  it("conta existente exige autenticação do próprio usuário", async () => {
    const repository = memoryRepository({ ...existingAccountInvite });

    const anonymous = await consumeUserInvite(validToken, {
      repository,
      now,
      actorUserId: null,
    });
    const otherUser = await consumeUserInvite(validToken, {
      repository,
      now,
      actorUserId: "attacker-user",
    });

    expect(anonymous).toEqual({ ok: false, reason: "INVALID" });
    expect(otherUser).toEqual({ ok: false, reason: "INVALID" });
  });

  it("próprio usuário autenticado aceita somente uma vez", async () => {
    const record = { ...existingAccountInvite };
    const repository = memoryRepository(record);

    const first = await consumeUserInvite(validToken, {
      repository,
      now,
      actorUserId: "user-a",
    });
    const second = await consumeUserInvite(validToken, {
      repository,
      now: new Date(now.getTime() + 1_000),
      actorUserId: "user-a",
    });

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: false, reason: "USED" });
  });
});
