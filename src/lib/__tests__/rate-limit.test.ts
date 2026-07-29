import { beforeEach, describe, expect, it } from "vitest";
import {
  checkRateLimit,
  resetLocalRateLimitsForTests,
} from "@/lib/rate-limit";

describe("rate limiting local de defesa adicional", () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    resetLocalRateLimitsForTests();
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
});
