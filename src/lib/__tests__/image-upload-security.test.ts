import { describe, expect, it } from "vitest";
import {
  canUploadToFolder,
  detectImageMimeType,
  isUploadFolder,
} from "@/lib/image-upload-security";

describe("segurança de upload de imagens", () => {
  it("detecta o conteúdo real em vez de confiar no MIME enviado", () => {
    expect(
      detectImageMimeType(
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe("image/png");
    expect(
      detectImageMimeType(
        Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
      ),
    ).toBe("image/jpeg");
    expect(
      detectImageMimeType(new TextEncoder().encode("<script>alert(1)</script>")),
    ).toBeNull();
  });

  it("aceita somente finalidades conhecidas", () => {
    expect(isUploadFolder("portfolio")).toBe(true);
    expect(isUploadFolder("branding")).toBe(true);
    expect(isUploadFolder("profiles")).toBe(true);
    expect(isUploadFolder("../../private")).toBe(false);
    expect(isUploadFolder("misc")).toBe(false);
  });

  it("aplica permissões proporcionais por pasta", () => {
    expect(canUploadToFolder("PROFESSIONAL", "portfolio")).toBe(true);
    expect(canUploadToFolder("PROFESSIONAL", "services")).toBe(false);
    expect(canUploadToFolder("RECEPTIONIST", "portfolio")).toBe(false);
    expect(canUploadToFolder("MANAGER", "products")).toBe(true);
    expect(canUploadToFolder("OWNER", "branding")).toBe(true);
    expect(canUploadToFolder("PROFESSIONAL", "branding")).toBe(false);
    expect(canUploadToFolder("PROFESSIONAL", "profiles")).toBe(true);
  });
});
