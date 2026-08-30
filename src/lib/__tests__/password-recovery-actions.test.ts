import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  issueAdmin: vi.fn(),
  issueClient: vi.fn(),
  consumeAdmin: vi.fn(),
  consumeClient: vi.fn(),
  checkRateLimit: vi.fn(),
  clearClientSession: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock("@/lib/password-recovery", () => ({
  issueAdminPasswordReset: mocks.issueAdmin,
  issueClientPasswordReset: mocks.issueClient,
  consumeAdminPasswordReset: mocks.consumeAdmin,
  consumeClientPasswordReset: mocks.consumeClient,
  hashPasswordResetToken: (token: string) => `hash:${token}`,
}));
vi.mock("@/lib/rate-limit", () => ({
  clientIp: () => "test-ip",
  checkRateLimit: mocks.checkRateLimit,
}));
vi.mock("@/lib/client-auth", () => ({ clearClientSession: mocks.clearClientSession }));

import {
  requestAdminPasswordReset,
  requestClientPasswordReset,
  resetAdminPassword,
  resetClientPassword,
} from "@/app/password-recovery-actions";

const token = "a".repeat(43);

describe("actions de recuperação de senha", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, source: "local" });
    mocks.consumeAdmin.mockResolvedValue(true);
    mocks.consumeClient.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("responde de forma idêntica sem revelar se a conta administrativa existe", async () => {
    const validRequest = requestAdminPasswordReset(" OWNER@EXAMPLE.COM ");
    await vi.advanceTimersByTimeAsync(800);
    const valid = await validRequest;

    const invalidRequest = requestAdminPasswordReset("email-invalido");
    await vi.advanceTimersByTimeAsync(800);
    const invalid = await invalidRequest;

    expect(valid).toEqual(invalid);
    expect(mocks.issueAdmin).toHaveBeenCalledWith({ email: "owner@example.com" });
    expect(mocks.issueAdmin).toHaveBeenCalledTimes(1);
  });

  it("limita recuperação do cliente por IP e conta dentro do slug", async () => {
    const request = requestClientPasswordReset("studio-a", "maria@example.com");
    await vi.advanceTimersByTimeAsync(800);
    await request;

    expect(mocks.checkRateLimit).toHaveBeenCalledWith(expect.objectContaining({
      namespace: "client-password-reset-account",
      identifier: "studio-a:maria@example.com",
      failClosed: true,
    }));
    expect(mocks.issueClient).toHaveBeenCalledWith({
      salonSlug: "studio-a",
      email: "maria@example.com",
    });
  });

  it("rejeita divergência e excesso de bytes antes de consultar o token", async () => {
    await expect(resetAdminPassword({
      token,
      password: "senha-um",
      confirmPassword: "senha-dois",
    })).resolves.toEqual({ ok: false, error: "As senhas não coincidem." });

    await expect(resetAdminPassword({
      token,
      password: "é".repeat(37),
      confirmPassword: "é".repeat(37),
    })).resolves.toEqual({ ok: false, error: "A senha deve ter no máximo 72 bytes." });

    expect(mocks.consumeAdmin).not.toHaveBeenCalled();
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
  });

  it("não aceita token expirado ou reutilizado", async () => {
    mocks.consumeAdmin.mockResolvedValue(false);

    await expect(resetAdminPassword({
      token,
      password: "senha-nova",
      confirmPassword: "senha-nova",
    })).resolves.toEqual(expect.objectContaining({ ok: false }));
  });

  it("limpa a sessão local do cliente depois da troca bem-sucedida", async () => {
    await expect(resetClientPassword("studio-a", {
      token,
      password: "senha-nova",
      confirmPassword: "senha-nova",
    })).resolves.toEqual({ ok: true });

    expect(mocks.consumeClient).toHaveBeenCalledWith({
      salonSlug: "studio-a",
      token,
      password: "senha-nova",
    });
    expect(mocks.clearClientSession).toHaveBeenCalledOnce();
  });
});
