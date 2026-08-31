import { describe, expect, it } from "vitest";
import { clientCookieIsSecure } from "@/lib/client-cookie";

describe("cookie de sessão do cliente", () => {
  it("permite HTTP somente em loopback de teste", () => {
    expect(clientCookieIsSecure({
      NODE_ENV: "production",
      NEXTAUTH_URL: "http://127.0.0.1:3100",
    })).toBe(false);
    expect(clientCookieIsSecure({
      NODE_ENV: "production",
      NEXTAUTH_URL: "http://localhost:3100",
    })).toBe(false);
  });

  it("mantém Secure para produção remota, configuração ausente ou inválida", () => {
    expect(clientCookieIsSecure({
      NODE_ENV: "production",
      NEXTAUTH_URL: "https://salon.example.com",
    })).toBe(true);
    expect(clientCookieIsSecure({ NODE_ENV: "production" })).toBe(true);
    expect(clientCookieIsSecure({
      NODE_ENV: "production",
      NEXTAUTH_URL: "http://preview.example.com",
    })).toBe(true);
  });
});
