import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const PASSWORD_FORMS = [
  "src/app/(auth)/login/login-form.tsx",
  "src/app/(auth)/signup/signup-form.tsx",
  "src/app/book/[salonSlug]/login/login-form.tsx",
  "src/app/book/[salonSlug]/cadastro/cadastro-form.tsx",
  "src/app/convite/[token]/invite-form.tsx",
];

describe("fluxos de senha", () => {
  it.each(PASSWORD_FORMS)("usa o campo compartilhado com visualização em %s", (path) => {
    expect(source(path)).toContain("<PasswordInput");
  });

  it.each([
    "src/app/(auth)/signup/signup-form.tsx",
    "src/app/book/[salonSlug]/cadastro/cadastro-form.tsx",
    "src/app/convite/[token]/invite-form.tsx",
  ])("exige confirmação ao criar senha em %s", (path) => {
    const form = source(path);
    expect(form).toContain('name="confirmPassword"');
    expect(form).toContain('autoComplete="new-password"');
  });
});
