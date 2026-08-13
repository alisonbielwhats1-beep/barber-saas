import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_RETRY_AFTER_SECONDS,
  parseRetryAfter,
  requestAvailability,
} from "../availability-client";

function response(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const validPayload = {
  slots: ["09:00", "09:30"],
  popularSlot: "09:00",
  occupied: [{ appointmentId: "appt-1", time: "10:00" }],
};

afterEach(() => {
  vi.useRealTimers();
});

describe("requestAvailability", () => {
  it("trata 200 com slots vazios como um dia realmente sem disponibilidade", async () => {
    const result = await requestAvailability("/api/availability", {
      fetcher: vi.fn(async () => response({ ...validPayload, slots: [] })),
    });

    expect(result.slots).toEqual([]);
    expect(result.occupied).toEqual(validPayload.occupied);
  });

  it.each([
    [429, "rate_limited"],
    [500, "server_error"],
  ] as const)("diferencia HTTP %i de uma agenda vazia", async (status, code) => {
    const promise = requestAvailability("/api/availability", {
      fetcher: vi.fn(async () => response({ error: "FAIL" }, status, { "Retry-After": "12" })),
    });

    await expect(promise).rejects.toMatchObject({ code });
  });

  it("rejeita JSON inválido e contrato incompleto", async () => {
    const invalidJson = requestAvailability("/api/availability", {
      fetcher: vi.fn(async () => new Response("{", { status: 200 })),
    });
    await expect(invalidJson).rejects.toMatchObject({ code: "invalid_response" });

    const invalidShape = requestAvailability("/api/availability", {
      fetcher: vi.fn(async () => response({ slots: [] })),
    });
    await expect(invalidShape).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("interrompe uma consulta lenta com erro de timeout", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );

    const promise = requestAvailability("/api/availability", {
      fetcher,
      timeoutMs: 50,
    });
    const assertion = expect(promise).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(50);

    await assertion;
  });

  it("mantém cancelamento de navegação distinto de falha de rede", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );

    const promise = requestAvailability("/api/availability", {
      fetcher,
      signal: controller.signal,
    });
    const assertion = expect(promise).rejects.toMatchObject({ code: "aborted" });
    controller.abort();

    await assertion;
  });
});

describe("parseRetryAfter", () => {
  const now = Date.parse("2026-08-13T12:00:00Z");

  it("aceita delta-seconds e limita esperas excessivas", () => {
    expect(parseRetryAfter("12", now)).toBe(12);
    expect(parseRetryAfter("999999", now)).toBe(MAX_RETRY_AFTER_SECONDS);
    expect(parseRetryAfter("-1", now)).toBeNull();
  });

  it("aceita HTTP-date, arredonda para cima e limita passado em zero", () => {
    expect(parseRetryAfter("Thu, 13 Aug 2026 12:00:12 GMT", now)).toBe(12);
    expect(parseRetryAfter("Thu, 13 Aug 2026 12:00:00 GMT", now - 1)).toBe(1);
    expect(parseRetryAfter("Wed, 12 Aug 2026 12:00:00 GMT", now)).toBe(0);
    expect(parseRetryAfter("Thu, 13 Aug 2026 14:00:00 GMT", now)).toBe(
      MAX_RETRY_AFTER_SECONDS,
    );
  });

  it("rejeita cabeçalho ausente ou inválido", () => {
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter("amanhã", now)).toBeNull();
  });
});
