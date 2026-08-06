import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("prisma/sql/manual/008_fase2_appointment_reliability.sql"),
  "utf8",
);
const rollback = readFileSync(
  resolve("prisma/sql/manual/008_fase2_appointment_reliability.rollback.sql"),
  "utf8",
);
const preflight = readFileSync(
  resolve("prisma/sql/manual/008_fase2_appointment_reliability.preflight.sql"),
  "utf8",
);

describe("migration aditiva da Fase 2", () => {
  it("é atômica, preserva dados e usa instantes com timezone", () => {
    expect(migration).toMatch(/\bBEGIN;/);
    expect(migration).toMatch(/\bCOMMIT;/);
    expect(migration).not.toMatch(/DROP\s+TABLE/i);
    expect(migration).not.toMatch(/DELETE\s+FROM/i);
    expect(migration).toContain("TIMESTAMPTZ(3)");
    expect(migration).toContain("AT TIME ZONE ''UTC''");
  });

  it("protege intervalos [início, fim) por tenant e profissional", () => {
    expect(migration).toMatch(
      /EXCLUDE USING gist[\s\S]*"salonId" WITH =[\s\S]*"professionalId" WITH =[\s\S]*tstzrange\("startAt", "endAt", '\[\)'\) WITH &&/,
    );
  });

  it("não permite que a exclusão de um agendamento apague seu histórico", () => {
    expect(migration).toMatch(
      /AppointmentEvent_appointment_tenant_fkey[\s\S]*Appointment"\(id, "salonId"\) ON DELETE RESTRICT/,
    );
    expect(migration).toMatch(
      /NotificationOutbox_appointment_tenant_fkey[\s\S]*Appointment"\(id, "salonId"\) ON DELETE RESTRICT/,
    );
  });

  it("amarra snapshots, eventos e outbox ao mesmo tenant do pai", () => {
    expect(migration).toContain(
      'FOREIGN KEY ("clientId", "salonId")',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("professionalId", "salonId")',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("appointmentId", "salonId")',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("eventId", "salonId")',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("serviceId", "salonId")',
    );
  });

  it("possui rollback não destrutivo e transacional", () => {
    expect(rollback).toMatch(/\bBEGIN;/);
    expect(rollback).toMatch(/\bCOMMIT;/);
    expect(rollback).not.toMatch(/DROP\s+TABLE/i);
    expect(rollback).not.toMatch(/DELETE\s+FROM/i);
  });

  it("possui preflight estritamente somente leitura para dados legados", () => {
    expect(preflight).toMatch(/SELECT[\s\S]*Appointment/);
    expect(preflight).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/i);
    expect(preflight).toContain("pg_timezone_names");
    expect(preflight).toContain('client."salonId" <> appointment."salonId"');
    expect(preflight).toContain('professional."salonId" <> appointment."salonId"');
    expect(preflight).toContain('service."salonId" <> appointment."salonId"');
    expect(preflight).toContain('right_appointment."startAt" < left_appointment."endAt"');
    expect(preflight).toContain('right_appointment."endAt" > left_appointment."startAt"');
  });
});
