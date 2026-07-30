-- Garantia definitiva contra double-booking no nível do banco.
-- A checagem em aplicação (conflict check) continua existindo para UX,
-- mas é vulnerável a corrida (TOCTOU): dois requests simultâneos passam
-- ambos pela checagem. Esta exclusion constraint fecha a janela.
--
-- Rodar no Supabase SQL Editor. Se falhar com "could not create exclusion
-- constraint", existem agendamentos sobrepostos no banco — use a query de
-- diagnóstico no fim deste arquivo para encontrá-los e corrigir antes.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Appointment"
  ADD CONSTRAINT appointment_no_overlap
  EXCLUDE USING gist (
    "professionalId" WITH =,
    tsrange("startAt", "endAt") WITH &&
  )
  WHERE (status IN ('PENDING', 'CONFIRMED', 'IN_PROGRESS'));

-- ── Diagnóstico: encontra pares de agendamentos ativos sobrepostos ──────────
-- SELECT a.id, b.id, a."professionalId", a."startAt", a."endAt", b."startAt", b."endAt"
-- FROM "Appointment" a
-- JOIN "Appointment" b
--   ON a."professionalId" = b."professionalId"
--  AND a.id < b.id
--  AND a."startAt" < b."endAt"
--  AND b."startAt" < a."endAt"
-- WHERE a.status IN ('PENDING','CONFIRMED','IN_PROGRESS')
--   AND b.status IN ('PENDING','CONFIRMED','IN_PROGRESS');
