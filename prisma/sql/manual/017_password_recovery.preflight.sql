-- Preflight somente leitura para a migration aditiva de recuperação de senha.
-- Aceita colunas ausentes ou já aplicadas com os tipos esperados.

DO $$
DECLARE
  target_table TEXT;
  target_column TEXT;
  actual_type TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['User', 'ClientProfile'] LOOP
    IF to_regclass(format('public.%I', target_table)) IS NULL THEN
      RAISE EXCEPTION 'Tabela obrigatória ausente: %', target_table;
    END IF;
  END LOOP;

  FOREACH target_table IN ARRAY ARRAY['User', 'ClientProfile'] LOOP
    FOREACH target_column IN ARRAY ARRAY['passwordResetTokenHash', 'passwordResetExpiresAt', 'sessionVersion'] LOOP
      SELECT data_type INTO actual_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND information_schema.columns.table_name = target_table
        AND information_schema.columns.column_name = target_column;

      IF actual_type IS NOT NULL AND (
        (target_column = 'passwordResetTokenHash' AND actual_type <> 'character varying') OR
        (target_column = 'passwordResetExpiresAt' AND actual_type <> 'timestamp with time zone') OR
        (target_column = 'sessionVersion' AND actual_type <> 'integer')
      ) THEN
        RAISE EXCEPTION 'Tipo incompatível em %.%: %', target_table, target_column, actual_type;
      END IF;
      actual_type := NULL;
    END LOOP;
  END LOOP;
END $$;
