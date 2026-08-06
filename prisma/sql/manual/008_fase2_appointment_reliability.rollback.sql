-- Rollback NÃO DESTRUTIVO da Fase 2.
--
-- A estratégia segura é voltar primeiro o código e manter as colunas/tabelas
-- aditivas. Clientes Prisma antigos ignoram campos desconhecidos; assim,
-- eventos, notificações e snapshots nunca são apagados durante um rollback.
--
-- Este SQL restaura apenas a forma anterior da constraint, continuando em
-- TIMESTAMPTZ para não reinterpretar instantes existentes. Não execute DROP
-- das tabelas novas: isso destruiria o histórico criado depois do rollout.

BEGIN;

ALTER TABLE "Appointment" DROP CONSTRAINT IF EXISTS appointment_no_overlap;

CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "Appointment"
  ADD CONSTRAINT appointment_no_overlap
  EXCLUDE USING gist (
    "professionalId" WITH =,
    tstzrange("startAt", "endAt", '[)') WITH &&
  )
  WHERE (status IN ('PENDING', 'CONFIRMED', 'IN_PROGRESS') AND NOT "isOverbooked");

-- As estruturas aditivas são deliberadamente preservadas. Remoção definitiva
-- só pode ocorrer em migration futura, após comprovar que não existem dados
-- dependentes e criar backup nativo verificável.

COMMIT;
