import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hash: vi.fn(),
  compare: vi.fn(),
  redirect: vi.fn(),
  withSalonBySlug: vi.fn(),
  isApprovedSalonSlug: vi.fn(),
  setClientSession: vi.fn(),
  checkRateLimit: vi.fn(),
  clientFindFirst: vi.fn(),
  clientCreate: vi.fn(),
}));

vi.mock("bcryptjs", () => ({
  default: { hash: mocks.hash, compare: mocks.compare },
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock("@/lib/prisma-tenant", () => ({
  withSalonBySlug: mocks.withSalonBySlug,
  isApprovedSalonSlug: mocks.isApprovedSalonSlug,
}));
vi.mock("@/lib/client-auth", () => ({
  setClientSession: mocks.setClientSession,
  clearClientSession: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  clientIp: () => "test-ip",
  checkRateLimit: mocks.checkRateLimit,
}));

import {
  loginClient,
  registerClient,
} from "@/app/book/[salonSlug]/auth-actions";

const tx = {
  clientProfile: {
    findFirst: mocks.clientFindFirst,
    create: mocks.clientCreate,
  },
};

describe("registerClient — validação no servidor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, source: "local" });
    mocks.isApprovedSalonSlug.mockResolvedValue(true);
    mocks.hash.mockResolvedValue("password-hash");
    mocks.compare.mockResolvedValue(false);
    mocks.clientFindFirst.mockResolvedValue(null);
    mocks.clientCreate.mockResolvedValue({ id: "client-a" });
    mocks.withSalonBySlug.mockImplementation(
      async (_slug: string, callback: (value: typeof tx, salonId: string) => unknown) =>
        callback(tx, "salon-a"),
    );
    mocks.redirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
  });

  it("rejeita senhas divergentes antes do limiter e do bcrypt", async () => {
    const result = await registerClient("studio-a", {
      name: "Maria Silva",
      phone: "",
      email: "maria@example.com",
      password: "123456",
      confirmPassword: "654321",
    } as Parameters<typeof registerClient>[1]);

    expect(result).toEqual({ error: "As senhas não coincidem." });
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.withSalonBySlug).not.toHaveBeenCalled();
  });

  it.each([
    { name: "A", phone: "", email: "valid@example.com", password: "123456" },
    { name: "Cliente", phone: "119123", email: "valid@example.com", password: "123456" },
    { name: "Cliente", phone: "119123456789", email: "valid@example.com", password: "123456" },
    { name: "Cliente", phone: "+1 (212) 555-0100", email: "valid@example.com", password: "123456" },
    { name: "Cliente", phone: "abc (11) 91234-5678", email: "valid@example.com", password: "123456" },
    { name: "Cliente", phone: "(20) 91234-5678", email: "valid@example.com", password: "123456" },
    { name: "Cliente", phone: "(11) 9333-4444", email: "valid@example.com", password: "123456" },
    { name: "Cliente", phone: "", email: "invalid", password: "123456" },
    { name: "Cliente", phone: "", email: "valid@example.com", password: "12345" },
    { name: "Cliente", phone: "", email: "valid@example.com", password: "x".repeat(129) },
    { name: "Cliente", phone: "", email: "valid@example.com", password: "é".repeat(37) },
  ])("rejeita payload inválido antes do bcrypt e do banco", async (payload) => {
    await expect(registerClient("studio-a", payload)).resolves.toEqual({
      error: "Não foi possível criar a conta com os dados informados.",
    });
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.withSalonBySlug).not.toHaveBeenCalled();
    expect(mocks.isApprovedSalonSlug).not.toHaveBeenCalled();
  });

  it("rejeita slug fora do formato antes do limiter e do bcrypt", async () => {
    const result = await registerClient("../studio-a", {
      name: "Maria Silva",
      phone: "",
      email: "maria@example.com",
      password: "123456",
    });

    expect(result).toEqual({
      error: "Não foi possível criar a conta com os dados informados.",
    });
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.hash).not.toHaveBeenCalled();
  });

  it.each([
    ["+55 (11) 91234-5678", "11912345678"],
    ["55 11 91234-5678", "11912345678"],
    ["(11) 91234-5678", "11912345678"],
    ["+55 (11) 3333-4444", "1133334444"],
    ["55 11 3333-4444", "1133334444"],
    ["(11) 3333-4444", "1133334444"],
  ])("normaliza telefone %s antes de persistir e criar a sessão", async (phone, normalized) => {
    await expect(
      registerClient("studio-a", {
        name: "  Maria Silva  ",
        phone,
        email: "  MARIA@EXAMPLE.COM ",
        password: "123456",
      }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.clientCreate).toHaveBeenCalledWith({
      data: {
        salonId: "salon-a",
        name: "Maria Silva",
        phone: normalized,
        email: "maria@example.com",
        passwordHash: "password-hash",
      },
      select: { id: true },
    });
    expect(mocks.setClientSession).toHaveBeenCalledWith({
      clientId: "client-a",
      salonId: "salon-a",
      name: "Maria Silva",
      email: "maria@example.com",
    });
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: "client-register-global",
        identifier: "test-ip",
      }),
    );
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: "client-register",
        identifier: "test-ip:studio-a",
      }),
    );
    expect(mocks.isApprovedSalonSlug).toHaveBeenCalledWith("studio-a");
  });

  it("não expõe se a constraint única encontrou uma conta existente", async () => {
    mocks.withSalonBySlug.mockRejectedValueOnce(
      Object.assign(new Error("unique"), { code: "P2002" }),
    );
    const result = await registerClient("studio-a", {
      name: "Maria Silva",
      phone: "",
      email: "maria@example.com",
      password: "123456",
    });

    expect(result).toEqual({
      error: "Não foi possível criar a conta com os dados informados.",
    });
    expect(mocks.setClientSession).not.toHaveBeenCalled();
  });

  it("falha no preflight sem gastar bcrypt quando o salão não está aprovado", async () => {
    mocks.isApprovedSalonSlug.mockResolvedValueOnce(false);

    const result = await registerClient("studio-a", {
      name: "Maria Silva",
      phone: "",
      email: "maria@example.com",
      password: "123456",
    });

    expect(result).toEqual({ error: "Salão não encontrado" });
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.withSalonBySlug).not.toHaveBeenCalled();
  });

  it("revalida a aprovação na transação antes do INSERT", async () => {
    mocks.withSalonBySlug.mockResolvedValueOnce(null);

    const result = await registerClient("studio-a", {
      name: "Maria Silva",
      phone: "",
      email: "maria@example.com",
      password: "123456",
    });

    expect(mocks.isApprovedSalonSlug).toHaveBeenCalledOnce();
    expect(mocks.hash).toHaveBeenCalledOnce();
    expect(result).toEqual({ error: "Salão não encontrado" });
    expect(mocks.clientCreate).not.toHaveBeenCalled();
  });

  it("o bucket global bloqueia rotação de slugs", async () => {
    mocks.checkRateLimit
      .mockResolvedValueOnce({ allowed: false, source: "local" })
      .mockResolvedValueOnce({ allowed: true, source: "local" });

    const result = await registerClient("studio-a", {
      name: "Maria Silva",
      phone: "",
      email: "maria@example.com",
      password: "123456",
    });

    expect(result).toEqual({
      error: "Muitas tentativas. Aguarde antes de criar outra conta.",
    });
    expect(mocks.isApprovedSalonSlug).not.toHaveBeenCalled();
    expect(mocks.hash).not.toHaveBeenCalled();
  });

  it("normaliza o returnTo por allowlist e remove destinos maliciosos", async () => {
    await expect(
      registerClient(
        "studio-a",
        {
          name: "Maria Silva",
          phone: "",
          email: "maria@example.com",
          password: "123456",
        },
        "/book/studio-a/%2e%2e/admin",
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.redirect).toHaveBeenCalledWith("/book/studio-a/minhas");
  });

  it("preserva query de uma rota de retorno explicitamente permitida", async () => {
    await expect(
      registerClient(
        "studio-a",
        {
          name: "Maria Silva",
          phone: "",
          email: "maria@example.com",
          password: "123456",
        },
        "/book/studio-a/agendar?services=a%2Cb#ignored",
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.redirect).toHaveBeenCalledWith(
      "/book/studio-a/agendar?services=a%2Cb",
    );
  });

  it("executa bcrypt dummy quando a conta não existe", async () => {
    const result = await loginClient(
      "studio-a",
      "missing@example.com",
      "password",
    );

    expect(result).toEqual({ error: "E-mail ou senha incorretos" });
    expect(mocks.compare).toHaveBeenCalledOnce();
    expect(mocks.compare.mock.calls[0]?.[1]).toMatch(/^\$2a\$10\$/);
    expect(mocks.setClientSession).not.toHaveBeenCalled();
  });

  it.each([
    [42, "valid@example.com", "password", null],
    ["studio-a", { email: "valid@example.com" }, "password", null],
    ["studio-a", "invalid", "password", null],
    ["studio-a", `${"a".repeat(250)}@example.com`, "password", null],
    ["studio-a", "valid@example.com", 123456, null],
    ["studio-a", "valid@example.com", "12345", null],
    ["studio-a", "valid@example.com", "x".repeat(73), null],
    ["studio-a", "valid@example.com", "é".repeat(37), null],
    ["studio-a", "valid@example.com", "password", { path: "/admin" }],
  ])(
    "rejeita argumentos de login inválidos antes do limiter, lookup e bcrypt",
    async (salonSlug, email, password, returnTo) => {
      await expect(loginClient(
        salonSlug as string,
        email as string,
        password as string,
        returnTo as string | null,
      )).resolves.toEqual({ error: "E-mail ou senha incorretos" });

      expect(mocks.checkRateLimit).not.toHaveBeenCalled();
      expect(mocks.withSalonBySlug).not.toHaveBeenCalled();
      expect(mocks.hash).not.toHaveBeenCalled();
      expect(mocks.compare).not.toHaveBeenCalled();
    },
  );

  it("bloqueia força bruta global por IP mesmo com rotação de slugs, antes do bcrypt", async () => {
    const buckets = new Map<string, number>();
    mocks.checkRateLimit.mockImplementation(async (input: {
      namespace: string;
      identifier: string;
      limit: number;
    }) => {
      const key = `${input.namespace}:${input.identifier}`;
      const attempts = (buckets.get(key) ?? 0) + 1;
      buckets.set(key, attempts);
      return { allowed: attempts <= input.limit, source: "local" };
    });

    for (let attempt = 0; attempt < 30; attempt += 1) {
      await expect(
        loginClient(`studio-${attempt}`, "missing@example.com", "password"),
      ).resolves.toEqual({ error: "E-mail ou senha incorretos" });
    }

    const blocked = await loginClient(
      "studio-rotated",
      "missing@example.com",
      "password",
    );

    expect(blocked).toEqual({
      error: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
    });
    expect(mocks.compare).toHaveBeenCalledTimes(30);
    expect(mocks.withSalonBySlug).toHaveBeenCalledTimes(30);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: "client-login-global-ip",
        identifier: "test-ip",
      }),
    );
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: "client-login-ip",
        identifier: "test-ip:studio-rotated",
      }),
    );
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: "client-login-account",
        identifier: "studio-rotated:missing@example.com",
      }),
    );
  });
});
