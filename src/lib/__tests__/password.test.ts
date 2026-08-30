import { describe, expect, it } from "vitest";
import {
  BCRYPT_PASSWORD_MAX_BYTES,
  isBcryptPasswordLengthValid,
  passwordByteLength,
} from "@/lib/password";

describe("limite de senha do bcrypt", () => {
  it("aceita no máximo 72 bytes, não apenas 72 caracteres", () => {
    expect(passwordByteLength("a".repeat(72))).toBe(BCRYPT_PASSWORD_MAX_BYTES);
    expect(isBcryptPasswordLengthValid("a".repeat(72))).toBe(true);
    expect(isBcryptPasswordLengthValid("a".repeat(73))).toBe(false);
    expect(passwordByteLength("é".repeat(36))).toBe(BCRYPT_PASSWORD_MAX_BYTES);
    expect(isBcryptPasswordLengthValid("é".repeat(36))).toBe(true);
    expect(isBcryptPasswordLengthValid("é".repeat(37))).toBe(false);
  });
});
