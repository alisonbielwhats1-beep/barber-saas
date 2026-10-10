import { bcryptPasswordSchema } from "./password";

export const NEW_PASSWORD_MIN_LENGTH = 8;
export const NEW_PASSWORD_HELP = `Use pelo menos ${NEW_PASSWORD_MIN_LENGTH} caracteres, incluindo letras e números.`;
export const newAuthPasswordSchema = bcryptPasswordSchema(NEW_PASSWORD_MIN_LENGTH, NEW_PASSWORD_HELP)
  .refine(value => /[a-zA-Z]/.test(value) && /[0-9]/.test(value), NEW_PASSWORD_HELP);
