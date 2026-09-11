# Piloto do Agente Chefe — publicação

## Autorização e versão
O responsável cadastrou OPENAI_API_KEY diretamente na Vercel, confirmou a
compra de US$ 5 em créditos e respondeu “prossiga” à proposta de orçamento
mensal de US$ 2. O saldo do fornecedor não é a franquia mensal do HQ.
PR #94; candidato 3d10832; merge d2e9647aebed57543af70dc16ad265089391ab34.
Production dpl_4GPX5ebXCvT6YHmCiFQLydRCSLHg READY em 11/09/2026.
HQ_CHIEF_ENABLED=true e HQ_CHIEF_MONTHLY_USD=2 apenas em Production.

## Banco e recuperação
Projeto barber-saas, vshnatkzxdekkvqttvbv, sa-east-1, PostgreSQL 17.6.
Preflight confirmou ausência de hq_agent_runs, função HQ existente e runtime
NOSUPERUSER/NOBYPASSRLS. Migration 022 exclusivamente aditiva, aplicada sob
nome hq_chief_022, versão 20260911044105. Não reaplicar.
Preservados 29 usuários, 13 salões, 2.230 agendamentos, uma conta e um cliente
HQ. Checksums CRM antes/depois idênticos:
accounts 31e7a7f5d9561045728ac9bbeb07f573;
customers d1828743e153c0be814c94b364f3d1d3.
Verify aprovado: ENABLE/FORCE RLS, três policies, FK, nenhum grant público
ou DELETE para app_runtime. Advisors não apontaram novos achados HQ;
permanecem avisos preexistentes de search_path e btree_gist.

Recuperação delimitada: tabela nova sem dados prévios, inventário HQ,
estrutura User, função de autorização e contagens preservados em arquivo
DPAPI fora do repositório, sob o perfil Windows do operador:
.codex/backups/everflair/hq-022-production-2026-09-11.dpapi.
SHA256 E0F7E7374D9BBB6F9E878EC2EF419E90F120E868BE80807815CF856B279A86F0.
Descriptografia/comparação integral verificada. Não é dump completo do banco.
Rollback: desativar a flag e republicar a versão anterior, mantendo histórico
e reservas. Não remover tabela nem restaurar dados sobre escritas posteriores.

## Verificação
CI do candidato 34559122639 aprovado: lint, TypeScript, 819 testes unitários,
build, schema-smoke, integração PostgreSQL e 85 jornadas de navegador.
Banco/CRUD/RLS e responsividade usaram somente PostgreSQL descartável do CI.
Build Production aprovado. Home, health e Booksite Martinelli retornaram 200;
/hq/agents sem sessão redirecionou para login; sessão administrativa acessou
o piloto disponível com orçamento US$ 2 e histórico persistente.

Primeira consulta operacional: resumo executivo atual do HQ, concluída às
04:44:28 UTC. Modelo gpt-5.6-luna; 542 tokens de entrada, 207 de saída;
chargeMicros=384 (US$ 0,000384 estimados, não uma fatura do fornecedor).
O resumo identificou um cliente ativo e ausência de registros financeiros,
sem inferir gratuidade nem atividade de uso. Nenhum dado comercial alterado.

## Limites observados
O texto gerado identificou incorretamente 04:44 UTC como BRT; a data da linha
de histórico aparece corretamente como 01:44. Conferir referências temporais
nas fontes; saída de IA não é fonte de verdade. Não foi feita segunda chamada.
SDK registrou aviso “No traceId found ... Returning NoopSpan” na consulta que
retornou 200 e concluiu. Traces externos seguem desativados; não habilitar
exportação para silenciar o aviso. Revisar ruído de observabilidade depois.
Os demais agentes e WhatsApp continuam em etapas futuras; laboratório abaixo
do piloto permanece uma simulação local sem consumo de IA.
