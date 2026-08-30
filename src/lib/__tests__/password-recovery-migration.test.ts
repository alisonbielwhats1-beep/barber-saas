import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("schema de recuperação de senha", () => {
  it("mantém a migration aditiva e idempotente", () => {
    const sql = fs.readFileSync(
      path.join(root, "prisma/sql/manual/017_password_recovery.sql"),
      "utf8",
    );
    expect(sql).toContain('ALTER TABLE "User"');
    expect(sql).toContain('ALTER TABLE "ClientProfile"');
    expect(sql.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(6);
    expect(sql).not.toMatch(/\b(?:DROP|DELETE|TRUNCATE|UPDATE)\b/i);
  });

  it("preflight não escreve dados", () => {
    const sql = fs.readFileSync(
      path.join(root, "prisma/sql/manual/017_password_recovery.preflight.sql"),
      "utf8",
    );
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP)\b/i);
    expect(sql).toContain("information_schema.columns");
  });
});
