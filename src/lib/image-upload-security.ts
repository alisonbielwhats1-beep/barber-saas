export const UPLOAD_FOLDERS = [
  "portfolio",
  "products",
  "services",
  "branding",
  "profiles",
] as const;

export type UploadFolder = (typeof UPLOAD_FOLDERS)[number];

export const IMAGE_MIME_TYPES = [
  "image/gif",
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
  if (bytes.length >= 6) {
    const gif = new TextDecoder("ascii").decode(bytes.slice(0, 6));
    if (gif === "GIF87a" || gif === "GIF89a") return "image/gif";
  }
  if (bytes.length >= 12) {
    const riff = new TextDecoder("ascii").decode(bytes.slice(0, 4));
    const webp = new TextDecoder("ascii").decode(bytes.slice(8, 12));
    if (riff === "RIFF" && webp === "WEBP") return "image/webp";
  }
  return null;
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
