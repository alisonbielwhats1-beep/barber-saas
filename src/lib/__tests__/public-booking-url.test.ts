import { afterEach, describe, expect, it, vi } from "vitest";
import { getPublicBookingUrl } from "../public-booking-url";

afterEach(() => vi.unstubAllEnvs());

describe("endereço público de divulgação", () => {
  it("usa o domínio oficial mesmo no painel antigo, preservando a URL de autenticação", () => {
    const legacy = "https://salon-saas-ruby.vercel.app";
    vi.stubEnv("NEXTAUTH_URL", legacy);
    vi.stubEnv("PUBLIC_BOOKING_URL", " https://everflair.com.br/ ");
    expect(getPublicBookingUrl("luna-hair", legacy)).toBe("https://everflair.com.br/book/luna-hair");
    expect(process.env.NEXTAUTH_URL).toBe(legacy);
  });

  it("preserva o comportamento anterior quando a nova configuração está ausente", () => {
    vi.stubEnv("PUBLIC_BOOKING_URL", "");
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3001/");
    expect(getPublicBookingUrl("luna-hair")).toBe("http://localhost:3001/book/luna-hair");
    vi.stubEnv("NEXTAUTH_URL", undefined);
    expect(getPublicBookingUrl("luna-hair", "https://preview.example.com"))
      .toBe("https://preview.example.com/book/luna-hair");
    expect(getPublicBookingUrl("luna-hair"))
      .toBe("https://salon-saas-ruby.vercel.app/book/luna-hair");
  });

  it.each([
    "http://everflair.com.br", "javascript:alert(1)",
    "https://user:password@example.com", "https://example.com/book/",
    "https://example.com/?query=1", "https://example.com/#fragment",
  ])("recusa configuração inválida: %s", (value) => {
    vi.stubEnv("PUBLIC_BOOKING_URL", value);
    expect(() => getPublicBookingUrl("luna-hair")).toThrow();
  });

  it("permite conferir divulgação em localhost sem acesso produtivo", () => {
    vi.stubEnv("PUBLIC_BOOKING_URL", "http://localhost:3100");
    expect(getPublicBookingUrl("luna-hair")).toBe("http://localhost:3100/book/luna-hair");
  });
});
