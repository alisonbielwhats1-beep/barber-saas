-- Recuperação não destrutiva: HQ_ENABLED=false e promover código anterior.
-- Não remover tabelas nem registros. Correções posteriores por roll-forward.
SELECT count(*) AS preserved_accounts FROM public.hq_accounts;

