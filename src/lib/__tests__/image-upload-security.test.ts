import { describe, expect, it } from "vitest";
import {
  canUploadToFolder,
  detectImageMimeType,
  ImageUploadValidationError,
  isUploadFolder,
  normalizeUploadedImage,
} from "@/lib/image-upload-security";
import sharp from "sharp";

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

  it("decodifica, remove metadados e preserva dimensões válidas", async () => {
    const input = await sharp({
      create: { width: 80, height: 60, channels: 3, background: "#123456" },
    }).jpeg().withMetadata({ exif: { IFD0: { Artist: "não persistir" } } }).toBuffer();

    const result = await normalizeUploadedImage(input, "image/jpeg");
    const metadata = await sharp(result.bytes).metadata();

    expect(result).toEqual(expect.objectContaining({
      extension: "jpg",
      mimeType: "image/jpeg",
      width: 80,
      height: 60,
    }));
    expect(metadata.exif).toBeUndefined();
  });

  it("rejeita imagem pequena demais antes do storage", async () => {
    const input = await sharp({
      create: { width: 16, height: 16, channels: 3, background: "#123456" },
    }).png().toBuffer();

    await expect(normalizeUploadedImage(input, "image/png")).rejects.toMatchObject({
      code: "INVALID_DIMENSIONS",
    } satisfies Partial<ImageUploadValidationError>);
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
