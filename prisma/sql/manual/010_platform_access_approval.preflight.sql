-- Preflight somente leitura para a aprovação central de estabelecimentos.
-- Deve retornar zero linhas. Não altera schema nem dados.

SELECT table_name, column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'User' AND column_name = 'platformRole' AND udt_name <> 'PlatformRole')
    OR (table_name = 'Salon' AND column_name = 'accessStatus' AND udt_name <> 'SalonAccessStatus')
    OR (table_name = 'Salon' AND column_name = 'accessRequestedAt' AND data_type NOT LIKE 'timestamp%')
    OR (table_name = 'Salon' AND column_name = 'accessReviewedAt' AND data_type NOT LIKE 'timestamp%')
  );

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'SalonAccessEvent'
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'SalonAccessEvent'
      AND column_name = 'salonId'
  );
