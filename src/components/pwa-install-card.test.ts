import { describe, expect, it } from "vitest";
import { detectPwaPlatform } from "./pwa-install-card";

describe("detecção da plataforma para instalação", () => {
  it("identifica iPhone e iPadOS moderno", () => {
    expect(detectPwaPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("ios");
    expect(detectPwaPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", "MacIntel", 5)).toBe("ios");
  });

  it("identifica Android e não inventa plataforma para desktop", () => {
    expect(detectPwaPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("android");
    expect(detectPwaPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("other");
  });
});
