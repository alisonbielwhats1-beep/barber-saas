import { bcryptPasswordSchema } from "./password";

export const NEW_PASSWORD_HELP = "Use pelo menos 10 caracteres, incluindo letras e números.";
export const newAuthPasswordSchema = bcryptPasswordSchema(10, NEW_PASSWORD_HELP)
  .refine(value => /[a-zA-Z]/.test(value) && /[0-9]/.test(value), NEW_PASSWORD_HELP);
