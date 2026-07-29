import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => {
  type UserRow = { id: string; email: string };
  type MembershipRow = {
    id: string;
    userId: string;
    salonId: string;
    role: string;
  };
  type ProfessionalRow = {
    id: string;
    userId: string;
    salonId: string;
    active: boolean;
    bio?: string | null;
    colorHex?: string | null;
    commissionPct?: number;
    monthlyGoalCents?: number;
  };
  type InviteRow = {
    id: string;
    salonId: string;
    email: string;
    name: string;
    userId: string | null;
    createdById: string;
    role: string;
    emailVerificationRequired: boolean;
    tokenHash: string;
    expiresAt: Date;
    usedAt: Date | null;
  };
  type State = {
    users: UserRow[];
    memberships: MembershipRow[];
    professionals: ProfessionalRow[];
    invites: InviteRow[];
  };

  let state: State;
  let nextId: number;
  let failInviteCreation: boolean;
  let transactionTail: Promise<void>;

  function copy<T>(value: T): T {
    return structuredClone(value);
  }

  function uniqueConflict(): Error & { code: string } {
    return Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
    });
  }

  function makeTransactionClient(working: State) {
    return {
      $queryRaw: vi.fn(async () => [{ locked: 1 }]),
      user: {
        findUnique: vi.fn(
          async (args: { where: { id?: string; email?: string } }) =>
            working.users.find(
              (user) =>
                (args.where.id !== undefined &&
                  user.id === args.where.id) ||
                (args.where.email !== undefined &&
                  user.email === args.where.email),
            ) ?? null,
        ),
      },
      membership: {
        findUnique: vi.fn(
          async (args: {
            where: {
              userId_salonId: { userId: string; salonId: string };
            };
          }) => {
            const key = args.where.userId_salonId;
            return (
              working.memberships.find(
                (membership) =>
                  membership.userId === key.userId &&
                  membership.salonId === key.salonId,
              ) ?? null
            );
          },
        ),
        create: vi.fn(
          async (args: {
            data: { userId: string; salonId: string; role: string };
          }) => {
            if (
              working.memberships.some(
                (membership) =>
                  membership.userId === args.data.userId &&
                  membership.salonId === args.data.salonId,
              )
            ) {
              throw uniqueConflict();
            }
            const created = {
              id: `membership-${nextId++}`,
              ...args.data,
            };
            working.memberships.push(created);
            return created;
          },
        ),
      },
      professional: {
        findUnique: vi.fn(
          async (args: { where: { userId: string } }) =>
            working.professionals.find(
              (professional) =>
                professional.userId === args.where.userId,
            ) ?? null,
        ),
        create: vi.fn(
          async (args: { data: Omit<ProfessionalRow, "id"> }) => {
            if (
              working.professionals.some(
                (professional) =>
                  professional.userId === args.data.userId,
              )
            ) {
              throw uniqueConflict();
            }
            const created = {
              id: `professional-${nextId++}`,
              ...args.data,
            };
            working.professionals.push(created);
            return created;
          },
        ),
        count: vi.fn(
          async (args: {
            where: { userId: string; salonId: string };
          }) =>
            working.professionals.filter(
              (professional) =>
                professional.userId === args.where.userId &&
                professional.salonId === args.where.salonId,
            ).length,
        ),
        updateMany: vi.fn(
          async (args: {
            where: {
              userId: string;
              salonId: string;
              active: false;
            };
            data: { active: true };
          }) => {
            const matches = working.professionals.filter(
              (professional) =>
                professional.userId === args.where.userId &&
                professional.salonId === args.where.salonId &&
                professional.active === args.where.active,
            );
            for (const professional of matches) {
              professional.active = args.data.active;
            }
            return { count: matches.length };
          },
        ),
      },
      userInvite: {
        updateMany: vi.fn(
          async (args: {
            where: {
              id?: string;
              salonId?: string;
              email?: string;
              userId?: string;
              emailVerificationRequired?: boolean;
              usedAt: null;
              expiresAt?: { gt: Date };
            };
            data: { usedAt: Date };
          }) => {
            const matches = working.invites.filter((invite) => {
              if (invite.usedAt !== null) return false;
              if (args.where.id && invite.id !== args.where.id) return false;
              if (
                args.where.salonId &&
                invite.salonId !== args.where.salonId
              ) {
                return false;
              }
              if (args.where.email && invite.email !== args.where.email) {
                return false;
              }
              if (args.where.userId && invite.userId !== args.where.userId) {
                return false;
              }
              if (
                args.where.emailVerificationRequired !== undefined &&
                invite.emailVerificationRequired !==
                  args.where.emailVerificationRequired
              ) {
                return false;
              }
              if (
                args.where.expiresAt &&
                invite.expiresAt <= args.where.expiresAt.gt
              ) {
                return false;
              }
              return true;
            });
            for (const invite of matches) invite.usedAt = args.data.usedAt;
            return { count: matches.length };
          },
        ),
        create: vi.fn(
          async (args: {
            data: Omit<InviteRow, "id" | "usedAt">;
          }) => {
            if (failInviteCreation) {
              throw new Error("simulated invite insert failure");
            }
            if (
              working.invites.some(
                (invite) =>
                  invite.salonId === args.data.salonId &&
                  invite.email === args.data.email &&
                  invite.usedAt === null,
              )
            ) {
              throw uniqueConflict();
            }
            const created: InviteRow = {
              id: `invite-${nextId++}`,
              ...args.data,
              usedAt: null,
            };
            working.invites.push(created);
            return created;
          },
        ),
      },
    };
  }

  const prisma = {
    userInvite: {
      findUnique: vi.fn(
        async (args: { where: { tokenHash: string } }) =>
          copy(
            state.invites.find(
              (candidate) => candidate.tokenHash === args.where.tokenHash,
            ) ?? null,
          ),
      ),
    },
    $transaction: vi.fn(
      async <T>(
        callback: (
          tx: ReturnType<typeof makeTransactionClient>,
        ) => Promise<T>,
      ): Promise<T> => {
        let release = () => {};
        const previous = transactionTail;
        transactionTail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        const working = copy(state);
        try {
          const result = await callback(makeTransactionClient(working));
          state = working;
          return result;
        } finally {
          release();
        }
      },
    ),
  };

  return {
    prisma,
    reset() {
      state = {
        users: [],
        memberships: [],
        professionals: [],
        invites: [],
      };
      nextId = 1;
      failInviteCreation = false;
      transactionTail = Promise.resolve();
      vi.clearAllMocks();
    },
    failNextInviteCreation() {
      failInviteCreation = true;
    },
    seed(value: Partial<State>) {
      state = {
        users: copy(value.users ?? []),
        memberships: copy(value.memberships ?? []),
        professionals: copy(value.professionals ?? []),
        invites: copy(value.invites ?? []),
      };
    },
    snapshot() {
      return copy(state);
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: database.prisma }));

import {
  createUserInvite,
  consumeUserInvite,
  hashInviteToken,
} from "@/lib/invitations";

const now = new Date("2030-01-01T12:00:00.000Z");

function inviteInput(role: "RECEPTIONIST" | "PROFESSIONAL" = "RECEPTIONIST") {
  return {
    salonId: "salon-a",
    createdById: "owner-a",
    email: "member@example.com",
    name: "Member",
    role,
    ...(role === "PROFESSIONAL"
      ? { professional: { commissionPct: 40 } }
      : {}),
  };
}

function persistedInvite(
  overrides: Partial<ReturnType<typeof database.snapshot>["invites"][number]> = {},
) {
  return {
    id: "invite-a",
    salonId: "salon-a",
    email: "member@example.com",
    name: "Member",
    userId: "user-a",
    createdById: "owner-a",
    role: "PROFESSIONAL",
    emailVerificationRequired: false,
    tokenHash: hashInviteToken("valid-token-value-1234567890"),
    expiresAt: new Date("2030-01-01T13:00:00.000Z"),
    usedAt: null,
    ...overrides,
  };
}

describe("persistência transacional de convites", () => {
  beforeEach(() => {
    database.reset();
  });

  it("reverte Professional quando a criação do convite falha", async () => {
    database.seed({
      users: [{ id: "user-a", email: "member@example.com" }],
    });
    database.failNextInviteCreation();

    await expect(
      createUserInvite(inviteInput("PROFESSIONAL"), {
        now,
        token: "rollback-token-value-1234567890",
      }),
    ).rejects.toThrow("simulated invite insert failure");

    expect(database.snapshot()).toEqual({
      users: [{ id: "user-a", email: "member@example.com" }],
      memberships: [],
      professionals: [],
      invites: [],
    });
  });

  it("serializa emissões concorrentes e mantém um convite pendente", async () => {
    const [first, second] = await Promise.all([
      createUserInvite(inviteInput(), {
        now,
        token: "concurrent-token-value-a-1234567890",
      }),
      createUserInvite(inviteInput(), {
        now: new Date(now.getTime() + 1),
        token: "concurrent-token-value-b-1234567890",
      }),
    ]);

    const state = database.snapshot();
    expect(first.userId).toBeNull();
    expect(second.userId).toBeNull();
    expect(state.users).toEqual([]);
    expect(state.invites).toHaveLength(2);
    expect(state.invites.filter((invite) => invite.usedAt === null)).toHaveLength(
      1,
    );
  });

  it("normaliza caixa e espaços e mantém somente um convite pendente", async () => {
    const emails = [
      "Pessoa@Email.com",
      "pessoa@email.com",
      "  pessoa@email.com  ",
    ];

    for (const [index, email] of emails.entries()) {
      await createUserInvite(
        { ...inviteInput(), email },
        {
          now: new Date(now.getTime() + index),
          token: `normalized-email-token-${index}-1234567890`,
        },
      );
    }

    const state = database.snapshot();
    expect(state.invites).toHaveLength(3);
    expect(
      state.invites.map((invite) => invite.email),
    ).toEqual([
      "pessoa@email.com",
      "pessoa@email.com",
      "pessoa@email.com",
    ]);
    expect(
      state.invites.filter((invite) => invite.usedAt === null),
    ).toHaveLength(1);
  });

  it("conta nova fica bloqueada sem criar identidade global ou Professional", async () => {
    const result = await createUserInvite(inviteInput("PROFESSIONAL"), {
      now,
      token: "new-account-token-value-1234567890",
    });

    const state = database.snapshot();
    expect(result).toEqual(
      expect.objectContaining({
        userId: null,
        professionalId: null,
        requiresEmailVerification: true,
      }),
    );
    expect(state.users).toEqual([]);
    expect(state.professionals).toEqual([]);
    expect(state.memberships).toEqual([]);
    expect(state.invites[0]).toEqual(
      expect.objectContaining({
        email: "member@example.com",
        salonId: "salon-a",
        userId: null,
        emailVerificationRequired: true,
      }),
    );
  });

  it("convite antigo não sobrescreve role de membership ativa", async () => {
    database.seed({
      users: [{ id: "user-a", email: "member@example.com" }],
      memberships: [
        {
          id: "membership-a",
          userId: "user-a",
          salonId: "salon-a",
          role: "MANAGER",
        },
      ],
      invites: [persistedInvite({ role: "RECEPTIONIST" })],
    });

    const result = await consumeUserInvite(
      "valid-token-value-1234567890",
      { now, actorUserId: "user-a" },
    );

    const state = database.snapshot();
    expect(result).toEqual({ ok: false, reason: "CONFLICT" });
    expect(state.memberships[0]?.role).toBe("MANAGER");
    expect(state.invites[0]?.usedAt).toBeNull();
  });

  it("role PROFESSIONAL sem perfil válido causa rollback", async () => {
    database.seed({
      users: [{ id: "user-a", email: "member@example.com" }],
      invites: [persistedInvite()],
    });

    const result = await consumeUserInvite(
      "valid-token-value-1234567890",
      { now, actorUserId: "user-a" },
    );

    const state = database.snapshot();
    expect(result).toEqual({ ok: false, reason: "CONFLICT" });
    expect(state.memberships).toEqual([]);
    expect(state.invites[0]?.usedAt).toBeNull();
  });

  it("Professional de outro salão é rejeitado e nunca movido", async () => {
    database.seed({
      users: [{ id: "user-a", email: "member@example.com" }],
      professionals: [
        {
          id: "professional-b",
          userId: "user-a",
          salonId: "salon-b",
          active: true,
        },
      ],
    });

    await expect(
      createUserInvite(inviteInput("PROFESSIONAL"), {
        now,
        token: "other-salon-token-value-1234567890",
      }),
    ).rejects.toThrow(
      "Esta conta já é profissional em outro estabelecimento.",
    );

    expect(database.snapshot().professionals).toEqual([
      expect.objectContaining({
        id: "professional-b",
        salonId: "salon-b",
      }),
    ]);
    expect(database.snapshot().invites).toEqual([]);
  });

  it("updateMany com count zero não ativa Professional nem membership", async () => {
    database.seed({
      users: [{ id: "user-a", email: "member@example.com" }],
      professionals: [
        {
          id: "professional-a",
          userId: "user-a",
          salonId: "salon-a",
          active: true,
        },
      ],
      invites: [persistedInvite()],
    });

    const result = await consumeUserInvite(
      "valid-token-value-1234567890",
      { now, actorUserId: "user-a" },
    );

    const state = database.snapshot();
    expect(result).toEqual({ ok: false, reason: "CONFLICT" });
    expect(state.memberships).toEqual([]);
    expect(state.invites[0]?.usedAt).toBeNull();
  });
});
