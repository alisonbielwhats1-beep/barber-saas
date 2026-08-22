-- Índices para os caminhos mais frequentes do painel e do cron.
-- Não executar em Production sem preflight, janela aprovada e plano de
-- rollback. O código não depende de uma criação automática destes índices.

CREATE INDEX IF NOT EXISTS "UserInvite_salonId_role_usedAt_revokedAt_expiresAt_idx"
  ON "UserInvite" ("salonId", "role", "usedAt", "revokedAt", "expiresAt");

CREATE INDEX IF NOT EXISTS "ClientProfile_salonId_createdAt_idx"
  ON "ClientProfile" ("salonId", "createdAt");

CREATE INDEX IF NOT EXISTS "Appointment_salonId_reminderSentAt_startAt_idx"
  ON "Appointment" ("salonId", "reminderSentAt", "startAt");

CREATE INDEX IF NOT EXISTS "Appointment_salonId_createdAt_status_idx"
  ON "Appointment" ("salonId", "createdAt", "status");

CREATE INDEX IF NOT EXISTS "AuditLog_salonId_action_entityType_createdAt_idx"
  ON "AuditLog" ("salonId", "action", "entityType", "createdAt");
