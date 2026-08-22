-- Rollback da fase 013. Só executar com autorização explícita e após
-- confirmar que nenhum código depende de um índice específico.

DROP INDEX IF EXISTS "UserInvite_salonId_role_usedAt_revokedAt_expiresAt_idx";
DROP INDEX IF EXISTS "ClientProfile_salonId_createdAt_idx";
DROP INDEX IF EXISTS "Appointment_salonId_reminderSentAt_startAt_idx";
DROP INDEX IF EXISTS "Appointment_salonId_createdAt_status_idx";
DROP INDEX IF EXISTS "AuditLog_salonId_action_entityType_createdAt_idx";
