-- Somente leitura. Confirme o projeto/ambiente antes de executar.
SELECT
  current_database() AS database_name,
  current_user AS database_user,
  inet_server_addr() AS server_address,
  inet_server_port() AS server_port,
  version() AS postgres_version;

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'UserInvite'
  AND column_name IN ('pendingPhone', 'pendingAvatarUrl')
ORDER BY column_name;

SELECT count(*) AS pending_professional_invites
FROM "UserInvite"
WHERE role = 'PROFESSIONAL'
  AND "usedAt" IS NULL
  AND "revokedAt" IS NULL;
