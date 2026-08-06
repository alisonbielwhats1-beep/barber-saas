-- Suporte mínimo para testar a migration da Fase 2 em PostgreSQL descartável.
-- A instalação real já recebe esta função de prisma/sql/rls/01_enable_rls.sql.
CREATE OR REPLACE FUNCTION app_current_salon() RETURNS TEXT AS $$
  SELECT NULLIF(current_setting('app.current_salon', TRUE), '')
$$ LANGUAGE SQL STABLE;
