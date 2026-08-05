-- Antecedência de agendamento e buffer entre atendimentos
-- Rodar no Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- POR QUE: hoje o único limite pra quando o cliente pode marcar é "não no
-- passado" — dá pra marcar daqui a 2 minutos ou daqui a 3 anos, e um
-- atendimento pode terminar às 14:00 e o próximo já começar 14:00 em ponto,
-- sem tempo de limpar a estação/trocar de sala. Estas colunas dão ao dono
-- controle sobre as duas coisas.
--
-- SEGURANÇA DESTA MIGRATION:
--   - Só adiciona colunas, com DEFAULT explícito (NOT NULL, sem ambiguidade
--     de NULL) — toda linha existente recebe o valor default imediatamente,
--     sem varredura cara (Postgres 11+ otimiza DEFAULT constante em
--     ADD COLUMN para não reescrever a tabela inteira).
--   - `IF NOT EXISTS` em tudo: rodar duas vezes não quebra.
--   - Os defaults preservam o comportamento de hoje o máximo possível:
--     `minBookingLeadMinutes = 0` (pode marcar imediatamente, como agora),
--     `bufferMinutes = 0` (sem intervalo forçado, como agora).
--     `maxBookingLeadDays = 90` é a única mudança de comportamento — hoje
--     não há limite nenhum; 90 dias é um teto razoável pra um negócio de
--     serviço e evita marcação num futuro tão distante que a equipe pode
--     nem existir mais. Ajustável por salão em Configurações.
--
-- ORDEM OBRIGATÓRIA (importante):
--   1. Rode este SQL primeiro.
--   2. SÓ DEPOIS suba o código que usa essas colunas.
--   Invertendo a ordem, o Prisma Client passa a esperar colunas que o banco
--   ainda não tem, e qualquer `salon.update()` (que retorna todos os campos)
--   quebra em produção — mesmo aviso da migration 004.

ALTER TABLE "Salon"
  -- Antecedência mínima pra marcar, em minutos. 0 = pode marcar imediatamente.
  ADD COLUMN IF NOT EXISTS "minBookingLeadMinutes" INTEGER NOT NULL DEFAULT 0,
  -- Quantos dias no futuro o cliente pode marcar. Sem isso hoje não há limite.
  ADD COLUMN IF NOT EXISTS "maxBookingLeadDays"     INTEGER NOT NULL DEFAULT 90,
  -- Intervalo forçado entre o fim de um atendimento e o início do próximo,
  -- por profissional, em minutos. 0 = sem buffer (como hoje).
  ADD COLUMN IF NOT EXISTS "bufferMinutes"           INTEGER NOT NULL DEFAULT 0;

-- Conferência: deve listar as 3 colunas novas, todas NOT NULL.
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_name = 'Salon'
--    AND column_name IN ('minBookingLeadMinutes','maxBookingLeadDays','bufferMinutes')
--  ORDER BY column_name;
