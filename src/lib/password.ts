import { z } from "zod";

export const BCRYPT_PASSWORD_MAX_BYTES = 72;
export const BCRYPT_PASSWORD_TOO_LONG =
  "A senha deve ter no máximo 72 bytes.";

export function passwordByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function isBcryptPasswordLengthValid(value: string): boolean {
  return passwordByteLength(value) <= BCRYPT_PASSWORD_MAX_BYTES;
}

/**
 * bcrypt ignora silenciosamente tudo depois do 72º byte. A validação comum
 * impede que duas senhas visualmente diferentes sejam tratadas como iguais.
 */
export function bcryptPasswordSchema(
  minimumLength: number,
  minimumMessage: string,
) {
  return z
    .string()
    .min(minimumLength, minimumMessage)
    .max(BCRYPT_PASSWORD_MAX_BYTES, BCRYPT_PASSWORD_TOO_LONG)
    .refine(isBcryptPasswordLengthValid, BCRYPT_PASSWORD_TOO_LONG);
}
