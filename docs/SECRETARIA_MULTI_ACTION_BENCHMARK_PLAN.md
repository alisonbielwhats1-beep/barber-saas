# Conversational stress + scalability — plano anterior à execução

Solicitação do responsável em 24/09/2026. Duas fases: A sem OpenAI com runtime e
PostgreSQL reais; B somente após A PASS. Não confirmar nem executar mutations.
Drafts, propostas e AuditLogs técnicos são permitidos; efeitos operacionais dos
pedidos, confirmações, Outbox e mensagens externas devem permanecer zero.

## Auditoria inicial

V2 offline existe na branch anterior, flag OFF. PostgreSQL foi identificado por
consultas somente leitura: 127.0.0.1:55441/everflair_service_mvp, role
mvp_service_runtime NOSUPERUSER/NOBYPASSRLS, 19 tabelas RLS/FORCE requeridas.
O cluster é local nativo; não iniciar containers. Nenhuma configuração .env.local
será modificada. Branch de trabalho codex/multi-action-benchmark.

Lacunas antes da bateria: continuação conjunta ainda exigia operation_ref para
dois itens incompletos; orçamento de saída legado 1200; validação de mensagem
ramificada dependia prematuramente do snapshot completo do batch. Corrigir e
testar offline antes de validar integração. Override permanece DESIGN_TARGET
na Secretária; não publicar uma capacidade nova neste benchmark.

## Fase A

Backup sintético antes de fixtures novas; namespace novo, sem reset de histórico.
Reutilizar seed/precheck/snapshot do harness PostgreSQL, contadores independentes,
RuntimeObservationBridge, DurableJournal com fsync/checkpoints/lock/hash e
diagnóstico de provider. Nenhuma confirmação disponível no boundary do runner.
Rodar respostas estruturadas sintéticas pelo SDK/runtime verdadeiro, com fetch
que recusa rede; verificar planos, drafts, dependências, faltantes, continuidades,
grupos e snapshots pós-turno. Qualquer falha no Gate A: parar sem Fase B.

## Casos propostos

Comparação principal: um caso completo de 1, 2, 5 e 10 ações (uma amostra por
grupo, sem p95 estatístico). Conversas separadas de 1/2/5/10 com faltantes,
mais variante ambígua de corte e conflito de intervalo. Se corte for ambíguo,
não tratar a resposta “10h” como seleção de serviço. Casos completos de cinco/
dez explicitam motivo de cancelamento e texto EXACT da mensagem para não
introduzir faltantes adicionais escondidos. O caso que omite motivo/texto deve
ser classificado pelo contrato real, sem exigir pergunta apenas de serviço.
12 ações: preparação estrutural opcional, fora da comparação principal.

Antes de B, congelar mensagens, turnos, fixtures, número de requests e teto em USD
com tarifa verificável; não executar requests extras ou retries. Separar falha de
provider, funcional, segurança e DESIGN_TARGET. Persistir dados críticos antes
de avançar. Restart não refaz request nem reconstrói sessão parcial silenciosamente.

No finally: Multi-Action V2=false, paid=false, Router=false. Snapshot final e
relatórios devem distinguir dados observados de itens não medidos. Sem Front,
Meta, deploy ou reexecução dos antigos Ultimate u01–u10.
