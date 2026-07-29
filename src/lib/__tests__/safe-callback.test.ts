import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTH_CALLBACK,
  safeNextAuthRedirect,
  sanitizeAuthCallback,
} from "@/lib/safe-callback";

describe("callback após login", () => {
  it("rejeita domínio externo", () => {
    expect(sanitizeAuthCallback("https://evil.example/steal")).toBe(
      DEFAULT_AUTH_CALLBACK,
    );
    expect(
      safeNextAuthRedirect(
        "https://evil.example/steal",
        "https://app.example",
      ),
    ).toBe("https://app.example/dashboard");
  });

  it("rejeita javascript:, data: e URL iniciada por //", () => {
    for (const unsafe of [
      "javascript:alert(1)",
      "data:text/html,pwned",
      "//evil.example/steal",
    ]) {
      expect(sanitizeAuthCallback(unsafe)).toBe(DEFAULT_AUTH_CALLBACK);
    }
  });

  it("aceita caminho interno permitido iniciado por uma única barra", () => {
    expect(sanitizeAuthCallback("/dashboard")).toBe("/dashboard");
    expect(sanitizeAuthCallback("/agenda?date=2030-01-01")).toBe(
      "/agenda?date=2030-01-01",
    );
    expect(
      sanitizeAuthCallback("/convite/valid-token-value-1234567890"),
    ).toBe("/convite/valid-token-value-1234567890");
  });

  it("rejeita caminho interno arbitrário fora da allowlist", () => {
    expect(sanitizeAuthCallback("/api/auth/signout")).toBe(
      DEFAULT_AUTH_CALLBACK,
    );
    expect(sanitizeAuthCallback("/admin/desconhecido")).toBe(
      DEFAULT_AUTH_CALLBACK,
    );
  });
});
