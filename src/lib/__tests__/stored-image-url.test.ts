import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isAllowedStoredImageUrl,
  isRenderableImageUrl,
} from "@/lib/stored-image-url";

describe("URLs de imagens persistidas", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("aceita somente o projeto e o prefixo do tenant configurado", () => {
    vi.stubEnv("SUPABASE_URL", "https://project-a.supabase.co");
    const own = "https://project-a.supabase.co/storage/v1/object/public/salon-assets/salon-a/branding/logo.webp";
    const anotherTenant = "https://project-a.supabase.co/storage/v1/object/public/salon-assets/salon-b/branding/logo.webp";
    const anotherProject = "https://project-b.supabase.co/storage/v1/object/public/salon-assets/salon-a/branding/logo.webp";

    expect(isAllowedStoredImageUrl(own, "salon-a")).toBe(true);
    expect(isAllowedStoredImageUrl(anotherTenant, "salon-a")).toBe(false);
    expect(isAllowedStoredImageUrl(anotherProject, "salon-a")).toBe(false);
    expect(isRenderableImageUrl(anotherProject)).toBe(false);
  });

  it("recusa protocolo inseguro, host arbitrário e caminho fora do bucket", () => {
    vi.stubEnv("SUPABASE_URL", "https://project-a.supabase.co");

    expect(isAllowedStoredImageUrl("http://project-a.supabase.co/logo.png", "salon-a")).toBe(false);
    expect(isAllowedStoredImageUrl("https://cdn.example.com/logo.png", "salon-a")).toBe(false);
    expect(isRenderableImageUrl("https://cdn.example.com/logo.png")).toBe(false);
    expect(isRenderableImageUrl("/images/salon-hero-barber-v2.webp")).toBe(true);
  });
});
