-- Preflight somente leitura da fase 014.
-- Executar no projeto identificado antes de aplicar a migration.
-- Não altera dados nem cria objetos.

SELECT current_database() AS database_name,
       current_schema() AS schema_name,
       current_setting('server_version') AS server_version;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'ClientProfile';

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'ClientProfile'
  AND column_name IN ('phone', 'phoneNormalized', 'mergedIntoId', 'mergedAt')
ORDER BY ordinal_position;

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'ClientProfile'
  AND indexname = 'ClientProfile_id_salonId_key';

-- Antes do backfill, mostra possíveis colisões pelo telefone normalizado.
-- Números compartilhados não devem ser unidos automaticamente.
WITH normalized AS (
  SELECT
    "salonId" AS salon_id,
    id,
    CASE
      WHEN regexp_replace("phone", '[^0-9]', '', 'g') ~ '^55[0-9]{10,11}$'
        THEN substring(regexp_replace("phone", '[^0-9]', '', 'g') FROM 3)
      WHEN regexp_replace("phone", '[^0-9]', '', 'g') ~ '^[0-9]{10,11}$'
        THEN regexp_replace("phone", '[^0-9]', '', 'g')
      ELSE NULL
    END AS phone_normalized
  FROM "ClientProfile"
  WHERE "phone" IS NOT NULL
)
SELECT salon_id, phone_normalized, COUNT(*) AS profile_count,
       ARRAY_AGG(id ORDER BY id) AS profile_ids
FROM normalized
WHERE phone_normalized IS NOT NULL
GROUP BY salon_id, phone_normalized
HAVING COUNT(*) > 1
ORDER BY profile_count DESC, salon_id, phone_normalized;

SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ClientProfile'
      AND column_name = 'mergedIntoId'
  )
  THEN 'A coluna mergedIntoId já existe; consulte os vínculos antes de prosseguir.'
  ELSE 'A coluna mergedIntoId ainda não existe; migration pronta para aplicação.'
END AS merge_column_state;

-- Resultado esperado antes da primeira aplicação: as novas colunas podem não
-- existir; colisões são apenas relatório e exigem revisão, não limpeza cega.
