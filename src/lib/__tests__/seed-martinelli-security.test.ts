import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const seed = readFileSync(
  join(process.cwd(), "scripts", "seed-martinelli.ts"),
  "utf8",
);

describe("seed Martinelli — alterações da Fase 1", () => {
  it("não gera credencial, não cria User e não imprime segredo", () => {
    expect(seed).not.toContain("randomBytes");
    expect(seed).not.toContain("bcrypt");
    expect(seed).not.toContain("passwordHash");
    expect(seed).not.toMatch(/prisma\.user\.create\s*\(/);
    expect(seed).not.toMatch(/userInvite\.(create|upsert)/);
    expect(seed).not.toContain("tokenHash");
    expect(seed).not.toMatch(
      /console\.(?:log|error|warn)\([^)]*(senha|password|token|convite)/i,
    );
    expect(seed).not.toMatch(/return\s+`\/convite\/\$\{token\}`/);
  });

  it("falha antes de criar salão, Membership ou Professional quando falta User", () => {
    const missingUserGuard = seed.indexOf(
      "if (!ownerUser || !tatianaUser)",
    );
    const missingUserError = seed.indexOf(
      'throw new Error("Usuários configurados não existem previamente.");',
    );
    const usableUserGuard = seed.indexOf(
      "if (!ownerUser.passwordSetAt || !tatianaUser.passwordSetAt)",
    );
    const salonCreate = seed.indexOf("prisma.salon.create(");
    const membershipActivation = seed.indexOf("prisma.membership.upsert(");
    const professionalActivation = seed.indexOf("prisma.professional.create(");

    expect(missingUserGuard).toBeGreaterThan(-1);
    expect(missingUserError).toBeGreaterThan(missingUserGuard);
    expect(usableUserGuard).toBeGreaterThan(missingUserError);
    expect(salonCreate).toBeGreaterThan(usableUserGuard);
    expect(salonCreate).toBeGreaterThan(missingUserError);
    expect(membershipActivation).toBeGreaterThan(missingUserError);
    expect(professionalActivation).toBeGreaterThan(missingUserError);
  });

  it("rejeita Professional existente antes de persistir e nunca o move", () => {
    const crossSalonGuard = seed.indexOf(
      "if (ownerUser.professional || tatianaUser.professional)",
    );
    const salonCreate = seed.indexOf("prisma.salon.create(");

    expect(crossSalonGuard).toBeGreaterThan(-1);
    expect(crossSalonGuard).toBeLessThan(salonCreate);
    expect(seed).toContain(
      "já possui perfil Professional em outro salão.",
    );
    expect(seed).not.toMatch(/prisma\.professional\.update\s*\(/);
  });
});
