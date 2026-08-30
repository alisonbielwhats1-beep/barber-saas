import sharp from "sharp";

export const UPLOAD_FOLDERS = [
  "portfolio",
  "products",
  "services",
  "branding",
  "profiles",
] as const;

export type UploadFolder = (typeof UPLOAD_FOLDERS)[number];

export const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

export function isUploadFolder(value: unknown): value is UploadFolder {
  return (
    typeof value === "string" &&
    UPLOAD_FOLDERS.includes(value as UploadFolder)
  );
}

export function detectImageMimeType(
  bytes: Uint8Array,
): ImageMimeType | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 12) {
    const riff = new TextDecoder("ascii").decode(bytes.slice(0, 4));
    const webp = new TextDecoder("ascii").decode(bytes.slice(8, 12));
    if (riff === "RIFF" && webp === "WEBP") return "image/webp";
  }
  return null;
}

export const MAX_IMAGE_DIMENSION = 8_192;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const MIN_IMAGE_DIMENSION = 32;

export class ImageUploadValidationError extends Error {
  constructor(readonly code: "INVALID_IMAGE" | "INVALID_DIMENSIONS") {
    super(code);
    this.name = "ImageUploadValidationError";
  }
}

/**
 * Decodifica e regrava a imagem antes de enviá-la ao storage. Além de validar
 * dimensões e conteúdo completo, isso remove EXIF e bytes anexados ao arquivo.
 */
export async function normalizeUploadedImage(
  bytes: Uint8Array,
  mimeType: ImageMimeType,
): Promise<{
  bytes: Uint8Array;
  extension: "jpg" | "png" | "webp";
  mimeType: ImageMimeType;
  width: number;
  height: number;
}> {
  try {
    const metadata = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS,
    }).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (
      width < MIN_IMAGE_DIMENSION ||
      height < MIN_IMAGE_DIMENSION ||
      width > MAX_IMAGE_DIMENSION ||
      height > MAX_IMAGE_DIMENSION ||
      width * height > MAX_IMAGE_PIXELS ||
      (metadata.pages ?? 1) > 1
    ) {
      throw new ImageUploadValidationError("INVALID_DIMENSIONS");
    }

    const pipeline = sharp(bytes, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS,
    }).rotate();
    const output = mimeType === "image/jpeg"
      ? await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true })
      : mimeType === "image/png"
        ? await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
        : await pipeline.webp({ quality: 90, alphaQuality: 100 }).toBuffer({ resolveWithObject: true });

    return {
      bytes: output.data,
      extension: mimeType === "image/jpeg" ? "jpg" : mimeType === "image/png" ? "png" : "webp",
      mimeType,
      width: output.info.width,
      height: output.info.height,
    };
  } catch (error) {
    if (error instanceof ImageUploadValidationError) throw error;
    throw new ImageUploadValidationError("INVALID_IMAGE");
  }
}

export function canUploadToFolder(
  role: string,
  folder: UploadFolder,
): boolean {
  if (folder === "portfolio") {
    return ["OWNER", "MANAGER", "PROFESSIONAL"].includes(role);
  }
  if (folder === "profiles") {
    return ["OWNER", "MANAGER", "PROFESSIONAL", "RECEPTIONIST"].includes(role);
  }
  return ["OWNER", "MANAGER"].includes(role);
}
