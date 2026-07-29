import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkRateLimit,
  clientIp,
  rateLimitStatus,
  resetLocalRateLimitsForTests,
} from "@/lib/rate-limit";

describe("rate limiting local de defesa adicional", () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    resetLocalRateLimitsForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("bloqueia entradas repetidas acima do limite", async () => {
    const input = {
      namespace: "test",
      identifier: "same-client",
      limit: 3,
      windowSeconds: 60,
    };

    expect((await checkRateLimit(input)).allowed).toBe(true);
    expect((await checkRateLimit(input)).allowed).toBe(true);
    expect((await checkRateLimit(input)).allowed).toBe(true);
    const blocked = await checkRateLimit(input);

    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.source).toBe("local");
  });

  it("falha fechado em produção quando o Redis obrigatório não está disponível", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const result = await checkRateLimit({
      namespace: "sensitive-write",
      identifier: "client",
      limit: 5,
      windowSeconds: 60,
      failClosed: true,
    });

    expect(result).toMatchObject({
      allowed: false,
      source: "unavailable",
    });
    expect(rateLimitStatus(result)).toBe(503);
  });

  it("mantém apenas fallback local para leitura quando failClosed não é solicitado", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const result = await checkRateLimit({
      namespace: "public-read",
      identifier: "client",
      limit: 5,
      windowSeconds: 60,
    });

    expect(result).toMatchObject({
      allowed: true,
      source: "local",
    });
  });

  it("prioriza o IP confiável da Vercel e rejeita cabeçalhos malformados", () => {
    expect(
      clientIp(
        new Headers({
          "x-vercel-forwarded-for": "2001:db8::1",
          "x-forwarded-for": "198.51.100.10",
        }),
      ),
    ).toBe("2001:db8::1");
    expect(
      clientIp(new Headers({ "x-forwarded-for": "spoofed.example" })),
    ).toBe("unknown");
  });

  it("não confia em x-forwarded-for comum em produção", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(
      clientIp(new Headers({ "x-forwarded-for": "198.51.100.10" })),
    ).toBe("unknown");
  });
});
