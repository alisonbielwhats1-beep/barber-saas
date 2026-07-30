import { readFileSync } from "node:fs";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260729164510_email_professional_invites/migration.sql",
  ),
  "utf8",
);

describe("migration do convite por e-mail", () => {
  it("preserva o nome da migration anterior já versionada", () => {
    expect(
      existsSync(
        join(
          process.cwd(),
          "prisma/migrations/20260729120000_user_invite_created_by_index/migration.sql",
        ),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(
          process.cwd(),
          "prisma/migrations/20260729145849_user_invite_created_by_index/migration.sql",
        ),
      ),
    ).toBe(false);
  });

  it("preserva dados pendentes e estados de entrega", () => {
    for (const field of [
      "deliveryStatus",
      "sentAt",
      "revokedAt",
      "pendingBio",
      "pendingColorHex",
      "pendingCommissionPct",
      "pendingMonthlyGoalCents",
      "pendingServiceIds",
    ]) {
      expect(sql).toContain(`"${field}"`);
    }
  });

  it("mantém somente um convite não consumido e não revogado", () => {
    expect(sql).toMatch(
      /WHERE "usedAt" IS NULL AND "revokedAt" IS NULL;/,
    );
  });

  it("habilita RLS e remove acesso público do histórico", () => {
    expect(sql).toContain(
      'ALTER TABLE "UserInviteEvent" ENABLE ROW LEVEL SECURITY;',
    );
    expect(sql).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE "UserInviteEvent" FROM anon, authenticated;',
    );
    expect(sql).not.toMatch(/CREATE\s+POLICY/i);
  });
});
