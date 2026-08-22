-- Preflight somente leitura para os índices operacionais da fase 013.
-- Executar antes de qualquer aplicação, no projeto/ambiente correto.

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('Appointment', 'ClientProfile', 'UserInvite', 'AuditLog')
ORDER BY table_name;

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'UserInvite_salonId_role_usedAt_revokedAt_expiresAt_idx',
    'ClientProfile_salonId_createdAt_idx',
    'Appointment_salonId_reminderSentAt_startAt_idx',
    'Appointment_salonId_createdAt_status_idx',
    'AuditLog_salonId_action_entityType_createdAt_idx'
  )
ORDER BY indexname;

-- A leitura acima deve confirmar as tabelas e mostrar quais índices já
-- existem. Nenhum dado é alterado por este preflight.
