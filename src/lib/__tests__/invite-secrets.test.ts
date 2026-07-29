import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const files = [
  "src/lib/invitations.ts",
  "src/lib/mailer.ts",
  "src/app/(admin)/profissionais/actions.ts",
  "src/app/(admin)/configuracoes/actions.ts",
].map((path) => readFileSync(join(process.cwd(), path), "utf8"));

describe("segredos do fluxo de convite", () => {
  it("não registra token, senha, chave ou link completo", () => {
    for (const source of files) {
      expect(source).not.toMatch(
        /console\.(?:log|info|warn|error)\s*\([^)]*(?:token|password|senha|RESEND|convite\/)/i,
      );
    }
  });

  it("ações administrativas não devolvem token nem caminho copiável", () => {
    const adminSources = files.slice(2).join("\n");
    expect(adminSources).not.toMatch(/invitePath|invite\.token|token:\s*invite/i);
  });

  it("bcrypt é o único mecanismo de armazenamento da nova senha", () => {
    expect(files[0]).toContain("bcrypt.hash(input.password, 12)");
    expect(files[0]).not.toMatch(/passwordHash:\s*input\.password/);
  });
});
