-- Recuperação sem perda: HQ_CHIEF_ENABLED=false, voltar aplicação anterior.
-- Manter tabela, respostas e reservas. Não apagar histórico para liberar orçamento.
SELECT status, count(*) FROM public.hq_agent_runs GROUP BY status;
