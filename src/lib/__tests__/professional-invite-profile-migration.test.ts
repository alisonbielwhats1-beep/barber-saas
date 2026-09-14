import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(process.cwd(), "prisma/migrations/20260913110000_professional_invite_profile_fields/migration.sql"), "utf8");

describe("migration do perfil pendente do profissional", () => {
  it("adiciona telefone e foto sem reescrever convites existentes", () => {
    expect(sql).toContain('ADD COLUMN "pendingPhone" TEXT');
    expect(sql).toContain('ADD COLUMN "pendingAvatarUrl" TEXT');
    expect(sql).not.toMatch(/UPDATE|DELETE|DROP/i);
  });
});
