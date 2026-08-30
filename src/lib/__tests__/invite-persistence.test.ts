import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

type State = {
  salons: Array<{ id: string; name: string }>;
  users: Array<Record<string, any>>;
  memberships: Array<Record<string, any>>;
  services: Array<Record<string, any>>;
  professionals: Array<Record<string, any>>;
  professionalServices: Array<Record<string, any>>;
  invites: Array<Record<string, any>>;
  events: Array<Record<string, any>>;
};

const initialState = (): State => ({
  salons: [{ id: "salon-a", name: "Barbearia Teste" }, { id: "salon-b", name: "Outro Salão" }],
  users: [{ id: "owner-a", email: "owner@example.com", name: "Owner", passwordHash: "owner-hash" }],
  memberships: [{ id: "membership-owner", userId: "owner-a", salonId: "salon-a", role: "OWNER" }],
  services: [
    { id: "service-a", salonId: "salon-a", active: true },
    { id: "service-b", salonId: "salon-a", active: true },
    { id: "service-other", salonId: "salon-b", active: true },
  ],
  professionals: [],
  professionalServices: [],
  invites: [],
  events: [],
});

let state = initialState();
let nextId = 1;
let transactionTail = Promise.resolve();

function uniqueError() {
  return Object.assign(new Error("unique"), { code: "P2002" });
}

function matchesInvite(row: Record<string, any>, where: Record<string, any>) {
  if (where.id && typeof where.id === "string" && row.id !== where.id) return false;
  if (where.id?.in && !where.id.in.includes(row.id)) return false;
  if (where.salonId && row.salonId !== where.salonId) return false;
  if (where.userId !== undefined && row.userId !== where.userId) return false;
  if (where.emailVerificationRequired !== undefined && row.emailVerificationRequired !== where.emailVerificationRequired) return false;
  if (where.tokenHash !== undefined && row.tokenHash !== where.tokenHash) return false;
  if (where.sendAttempts !== undefined && row.sendAttempts !== where.sendAttempts) return false;
  if (where.deliveryStatus !== undefined && row.deliveryStatus !== where.deliveryStatus) return false;
  if (where.usedAt === null && row.usedAt !== null) return false;
  if (where.revokedAt === null && row.revokedAt !== null) return false;
  if (where.expiresAt?.gt && row.expiresAt <= where.expiresAt.gt) return false;
  if (where.email?.equals && row.email.toLowerCase() !== where.email.equals.toLowerCase()) return false;
  return true;
}

const fakePrisma: any = {
  $queryRaw: vi.fn(async () => [{ locked: 1 }]),
  // createUserInvite/resendUserInvite/revokeUserInvite agora chamam
  // setSalonGuc(tx, ...) logo no início de cada transação — como o
  // $transaction abaixo devolve o próprio fakePrisma como tx, um mock aqui
  // cobre todo mundo.
  $executeRaw: vi.fn(async () => undefined),
  $transaction(arg: any) {
    if (Array.isArray(arg)) return Promise.all(arg);
    const run = transactionTail.then(async () => {
      const snapshot = structuredClone(state);
      try {
        return await arg(fakePrisma);
      } catch (error) {
        state = snapshot;
        throw error;
      }
    });
    transactionTail = run.then(() => undefined, () => undefined);
    return run;
  },
  salon: {
    findUnique: vi.fn(async ({ where }: any) => state.salons.find((row) => row.id === where.id) ?? null),
  },
  membership: {
    findUnique: vi.fn(async ({ where }: any) => {
      const key = where.userId_salonId;
      return state.memberships.find((row) => row.userId === key.userId && row.salonId === key.salonId) ?? null;
    }),
    create: vi.fn(async ({ data }: any) => {
      if (state.memberships.some((row) => row.userId === data.userId && row.salonId === data.salonId)) throw uniqueError();
      const row = { id: `membership-${nextId++}`, ...data };
      state.memberships.push(row);
      return row;
    }),
  },
  user: {
    findUnique: vi.fn(async ({ where }: any) => {
      if (where.email) return state.users.find((row) => row.email === where.email) ?? null;
      return state.users.find((row) => row.id === where.id) ?? null;
    }),
    create: vi.fn(async ({ data }: any) => {
      if (state.users.some((row) => row.email === data.email)) throw uniqueError();
      const row = { id: `user-${nextId++}`, ...data };
      state.users.push(row);
      return row;
    }),
  },
  service: {
    count: vi.fn(async ({ where }: any) =>
      state.services.filter(
        (row) =>
          row.salonId === where.salonId &&
          where.id.in.includes(row.id) &&
          (where.active === undefined || row.active === where.active),
      ).length,
    ),
  },
  userInvite: {
    findMany: vi.fn(async ({ where }: any) => state.invites.filter((row) => matchesInvite(row, where))),
    findUnique: vi.fn(async ({ where, select }: any) => {
      const row = where.tokenHash
        ? state.invites.find((item) => item.tokenHash === where.tokenHash)
        : state.invites.find((item) => item.id === where.id);
      if (!row) return null;
      return select?.salon
        ? { ...row, salon: state.salons.find((salon) => salon.id === row.salonId) }
        : row;
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      const row = state.invites.find((item) => matchesInvite(item, where));
      if (!row) return null;
      return { ...row, salon: state.salons.find((salon) => salon.id === row.salonId) };
    }),
    create: vi.fn(async ({ data }: any) => {
      if (state.invites.some((row) => row.tokenHash === data.tokenHash)) throw uniqueError();
      const row = {
        id: `invite-${nextId++}`,
        createdAt: new Date(),
        usedAt: null,
        revokedAt: null,
        sentAt: null,
        providerMessageId: null,
        lastErrorCode: null,
        ...data,
      };
      delete row.events;
      state.invites.push(row);
      if (data.events?.create) {
        state.events.push({ id: `event-${nextId++}`, inviteId: row.id, ...data.events.create });
      }
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const rows = state.invites.filter((row) => matchesInvite(row, where));
      for (const row of rows) {
        for (const [key, value] of Object.entries(data)) {
          row[key] =
            typeof value === "object" && value && "increment" in value
              ? row[key] + (value as any).increment
              : value;
        }
      }
      return { count: rows.length };
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = state.invites.find((item) => item.id === where.id);
      if (!row) throw new Error("not found");
      for (const [key, value] of Object.entries(data)) {
        row[key] =
          typeof value === "object" && value && "increment" in value
            ? row[key] + (value as any).increment
            : value;
      }
      return row;
    }),
  },
  userInviteEvent: {
    create: vi.fn(async ({ data }: any) => {
      const row = { id: `event-${nextId++}`, ...data };
      state.events.push(row);
      return row;
    }),
    createMany: vi.fn(async ({ data }: any) => {
      for (const item of data) state.events.push({ id: `event-${nextId++}`, ...item });
      return { count: data.length };
    }),
  },
  professional: {
    findUnique: vi.fn(async ({ where }: any) =>
      state.professionals.find((row) => row.userId === where.userId) ?? null,
    ),
    create: vi.fn(async ({ data }: any) => {
      if (state.professionals.some((row) => row.userId === data.userId)) throw uniqueError();
      const row = { id: `professional-${nextId++}`, ...data };
      state.professionals.push(row);
      return row;
    }),
  },
  professionalService: {
    createMany: vi.fn(async ({ data }: any) => {
      state.professionalServices.push(...data);
      return { count: data.length };
    }),
  },
};

vi.mock("@/lib/prisma", () => ({ prisma: fakePrisma }));

const {
  acceptExistingUserInvite,
  acceptNewUserInvite,
  createUserInvite,
  getInviteView,
  hashInviteToken,
  resendUserInvite,
  revokeUserInvite,
} = await import("@/lib/invitations");

const sentMessages: Array<Record<string, any>> = [];
const mailer = {
  async send(message: any) {
    sentMessages.push(message);
    return { messageId: `message-${sentMessages.length}` };
  },
};
const failingMailer = {
  async send() {
    throw new Error("provider unavailable");
  },
};
const now = new Date("2026-07-29T12:00:00.000Z");
const tokenA = "new-account-token-value-1234567890";
const tokenB = "rotated-account-token-value-1234567890";
const tokenC = "latest-account-token-value-1234567890";

function professionalInput(email = "new@example.com") {
  return {
    salonId: "salon-a",
    createdById: "owner-a",
    email,
    name: "Pessoa Convidada",
    role: "PROFESSIONAL" as const,
    professional: {
      bio: "Especialista",
      colorHex: "#112233",
      commissionPct: 42,
      monthlyGoalCents: 900_000,
      serviceIds: ["service-a", "service-b"],
    },
  };
}

beforeEach(() => {
  state = initialState();
  nextId = 1;
  transactionTail = Promise.resolve();
  sentMessages.length = 0;
  vi.clearAllMocks();
  process.env.NEXTAUTH_URL = "https://app.example.com";
});

describe("persistência transacional de convites", () => {
  it("cria convite para conta nova, preserva dados e envia sem expor token no banco", async () => {
    const result = await createUserInvite(professionalInput(), { now, token: tokenA, mailer });

    expect(result.deliveryStatus).toBe("SENT");
    expect(result.requiresEmailVerification).toBe(true);
    expect(state.users).toHaveLength(1);
    expect(state.professionals).toHaveLength(0);
    expect(state.invites[0]).toEqual(
      expect.objectContaining({
        tokenHash: hashInviteToken(tokenA),
        pendingBio: "Especialista",
        pendingColorHex: "#112233",
        pendingCommissionPct: 42,
        pendingMonthlyGoalCents: 900_000,
        pendingServiceIds: ["service-a", "service-b"],
        deliveryStatus: "SENT",
      }),
    );
    expect(JSON.stringify(state)).not.toContain(tokenA);
    expect(sentMessages[0]?.html).toContain("/convite/");
  });

  it("mantém o registro em falha quando o provedor não confirma", async () => {
    const result = await createUserInvite(professionalInput(), {
      now,
      token: tokenA,
      mailer: failingMailer,
    });
    expect(result.deliveryStatus).toBe("FAILED");
    expect(state.invites[0]).toEqual(
      expect.objectContaining({
        deliveryStatus: "FAILED",
        lastErrorCode: "MAIL_DELIVERY_FAILED",
      }),
    );
    expect(state.events.some((event) => event.type === "SEND_FAILED")).toBe(true);
  });

  it("reenvio rotaciona o token e invalida o anterior", async () => {
    const created = await createUserInvite(professionalInput(), { now, token: tokenA, mailer });
    await resendUserInvite(
      created.inviteId,
      { userId: "owner-a", salonId: "salon-a" },
      { now: new Date(now.getTime() + 1_000), token: tokenB, mailer },
    );

    expect((await getInviteView(tokenA, null, now)).state).toBe("INVALID");
    expect((await getInviteView(tokenB, null, now)).state).toBe("CREATE_ACCOUNT");
    expect(state.invites[0]?.sendAttempts).toBe(2);
    expect(state.events.some((event) => event.type === "RESENT")).toBe(true);
  });

  it("resultado de envio antigo não sobrescreve uma tentativa mais recente", async () => {
    const created = await createUserInvite(professionalInput(), {
      now,
      token: tokenA,
      mailer,
    });
    let releaseFirst!: (value: { messageId: string }) => void;
    let notifyFirstStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      notifyFirstStarted = resolve;
    });
    const delayedMailer = {
      send() {
        notifyFirstStarted();
        return new Promise<{ messageId: string }>((resolve) => {
          releaseFirst = resolve;
        });
      },
    };

    const first = resendUserInvite(
      created.inviteId,
      { userId: "owner-a", salonId: "salon-a" },
      {
        now: new Date(now.getTime() + 1_000),
        token: tokenB,
        mailer: delayedMailer,
      },
    );
    await started;
    await resendUserInvite(
      created.inviteId,
      { userId: "owner-a", salonId: "salon-a" },
      {
        now: new Date(now.getTime() + 2_000),
        token: tokenC,
        mailer,
      },
    );
    releaseFirst({ messageId: "stale-message" });
    expect((await first).deliveryStatus).toBe("FAILED");

    expect((await getInviteView(tokenB, null, now)).state).toBe("INVALID");
    expect((await getInviteView(tokenC, null, now)).state).toBe("CREATE_ACCOUNT");
    expect(state.invites[0]).toEqual(
      expect.objectContaining({
        deliveryStatus: "SENT",
        providerMessageId: "message-2",
        sendAttempts: 3,
      }),
    );
  });

  it("cancelamento é isolado por salão e torna o token inutilizável", async () => {
    const created = await createUserInvite(professionalInput(), { now, token: tokenA, mailer });
    await expect(
      revokeUserInvite(created.inviteId, { userId: "owner-a", salonId: "salon-b" }, now),
    ).rejects.toThrow("não disponível");
    await revokeUserInvite(created.inviteId, { userId: "owner-a", salonId: "salon-a" }, now);
    expect((await getInviteView(tokenA, null, now)).state).toBe("REVOKED");
  });

  it("expiração é reconhecida sem consumir o GET", async () => {
    await createUserInvite(professionalInput(), { now, token: tokenA, mailer });
    const afterExpiry = new Date(now.getTime() + 25 * 60 * 60 * 1_000);
    expect((await getInviteView(tokenA, null, afterExpiry)).state).toBe("EXPIRED");
    expect(state.invites[0]?.usedAt).toBeNull();
  });

  it.each(["x".repeat(73), "é".repeat(37)])(
    "rejeita senha de convite acima de 72 bytes antes de consultar o token",
    async (password) => {
      await expect(acceptNewUserInvite({
        token: tokenA,
        password,
        now,
      })).resolves.toEqual({ ok: false, reason: "INVALID" });

      expect(fakePrisma.userInvite.findUnique).not.toHaveBeenCalled();
    },
  );

  it("duas aceitações concorrentes criam User, Membership e Professional uma vez", async () => {
    await createUserInvite(professionalInput(), { now, token: tokenA, mailer });
    const acceptedAt = new Date(now.getTime() + 5_000);
    const results = await Promise.all([
      acceptNewUserInvite({ token: tokenA, password: "uma-senha-segura", now: acceptedAt }),
      acceptNewUserInvite({ token: tokenA, password: "uma-senha-segura", now: acceptedAt }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(fakePrisma.userInvite.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tokenHash: hashInviteToken(tokenA),
        }),
      }),
    );
    expect(state.users).toHaveLength(2);
    expect(state.memberships.filter((row) => row.userId !== "owner-a")).toHaveLength(1);
    expect(state.professionals).toEqual([
      expect.objectContaining({
        active: true,
        bio: "Especialista",
        colorHex: "#112233",
        commissionPct: 42,
        monthlyGoalCents: 900_000,
      }),
    ]);
    expect(state.professionalServices).toHaveLength(2);
    const user = state.users.find((row) => row.email === "new@example.com")!;
    expect(user.passwordSetAt).toEqual(acceptedAt);
    expect(await bcrypt.compare("uma-senha-segura", user.passwordHash)).toBe(true);
  }, 10_000);

  it("conta existente exige o usuário correspondente e não altera sua senha", async () => {
    state.users.push({
      id: "existing-user",
      email: "existing@example.com",
      name: "Existente",
      passwordHash: "hash-existente",
      passwordSetAt: new Date("2025-01-01"),
    });
    await createUserInvite(professionalInput("existing@example.com"), {
      now,
      token: tokenA,
      mailer,
    });

    expect((await getInviteView(tokenA, null, now)).state).toBe("LOGIN_REQUIRED");
    expect((await getInviteView(tokenA, "owner-a", now)).state).toBe("WRONG_USER");
    const wrong = await acceptExistingUserInvite({
      token: tokenA,
      actorUserId: "owner-a",
      now,
    });
    expect(wrong).toEqual({ ok: false, reason: "WRONG_USER" });
    const correct = await acceptExistingUserInvite({
      token: tokenA,
      actorUserId: "existing-user",
      now,
    });
    expect(correct.ok).toBe(true);
    expect(state.users.find((row) => row.id === "existing-user")?.passwordHash).toBe("hash-existente");
  });

  it("serviço de outro salão é rejeitado antes de persistir", async () => {
    const input = professionalInput();
    input.professional.serviceIds = ["service-other"];
    await expect(
      createUserInvite(input, { now, token: tokenA, mailer }),
    ).rejects.toThrow("não pertencem");
    expect(state.invites).toHaveLength(0);
  });

  it("não revela se uma conta profissional pertence a outro salão", async () => {
    state.users.push({
      id: "other-professional",
      email: "other@example.com",
      name: "Outro",
      passwordHash: "hash",
    });
    state.professionals.push({
      id: "professional-other",
      userId: "other-professional",
      salonId: "salon-b",
    });

    await expect(
      createUserInvite(professionalInput("other@example.com"), {
        now,
        token: tokenA,
        mailer,
      }),
    ).rejects.toThrow(
      "Não foi possível criar o convite para o endereço informado.",
    );
  });
});
