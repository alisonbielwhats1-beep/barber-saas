-- Personalização do estabelecimento pelo dono
-- Rodar no Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- POR QUE: hoje o dono não consegue mudar nada da própria vitrine. A foto de
-- capa é sorteada de um pool do Unsplash pelo hash do slug, não há texto de
-- apresentação, nem cor, nem redes sociais. Estas colunas destravam a tela de
-- personalização.
--
-- SEGURANÇA DESTA MIGRATION:
--   - Só adiciona colunas, todas anuláveis. Não altera nem apaga nada.
--   - `IF NOT EXISTS` em tudo: rodar duas vezes não quebra.
--   - Nenhuma linha existente é tocada; salões atuais ficam com NULL e a
--     aplicação segue usando os defaults de hoje.
--
-- ORDEM OBRIGATÓRIA (importante):
--   1. Rode este SQL primeiro.
--   2. SÓ DEPOIS suba o código que atualiza prisma/schema.prisma.
--   Invertendo a ordem, o Prisma Client passa a esperar colunas que o banco
--   ainda não tem, e qualquer `salon.update()` (que retorna todos os campos)
--   quebra em produção.

ALTER TABLE "Salon"
  -- Tipo de negócio: 'barbearia' | 'salao-beleza' | 'manicure-nail'
  --                | 'estetica-bemestar' | 'espaco-misto'
  -- Texto livre em vez de enum de propósito: adicionar um segmento novo passa
  -- a ser deploy de código, não migration de banco.
  ADD COLUMN IF NOT EXISTS "segment"       TEXT,
  -- Apresentação exibida na vitrine
  ADD COLUMN IF NOT EXISTS "description"   TEXT,
  -- Foto de capa própria (hoje é uma imagem do Unsplash sorteada pelo slug)
  ADD COLUMN IF NOT EXISTS "coverUrl"      TEXT,
  -- Cor da marca, formato #RRGGBB
  ADD COLUMN IF NOT EXISTS "themeColorHex" VARCHAR(7),
  -- @usuario, sem a URL completa
  ADD COLUMN IF NOT EXISTS "instagram"     TEXT,
  -- Só dígitos. Separado de "phone" porque o WhatsApp costuma ser outro número
  ADD COLUMN IF NOT EXISTS "whatsapp"      TEXT,
  -- Formas de pagamento aceitas, separadas por vírgula (ex.: "PIX,CASH,CREDIT_CARD")
  ADD COLUMN IF NOT EXISTS "paymentMethods" TEXT,
  -- Avisos livres: estacionamento, política de atraso, etc.
  ADD COLUMN IF NOT EXISTS "importantInfo" TEXT;

-- Conferência: deve listar as 8 colunas novas.
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_name = 'Salon'
--    AND column_name IN ('segment','description','coverUrl','themeColorHex',
--                        'instagram','whatsapp','paymentMethods','importantInfo')
--  ORDER BY column_name;
