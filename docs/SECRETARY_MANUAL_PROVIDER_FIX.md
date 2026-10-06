# Continuação manual — correção do observador de staging

26/09/2026. A continuação “pode marcar mesmo com conflito” falhou antes do
transporte HTTP: o observador procurava `select_capabilities` em toda chamada,
inclusive `upsert_action_draft`, e lançava `PUBLISHED_WEEKDAY_CONSTRAINT_MISSING`.
Correlation: `f89aca6f-6b1e-4b1b-8077-7adddd22ce9a`.

Correção somente no preload de staging `manual-20260926-01-budget.cjs`: aplicar
a asserção de publicação do schema de discovery somente à ferramenta discovery.
O guard de custo existente, limite de 20 tentativas, validação de schemas e
temporal grounding do backend permanecem intactos. Não há alteração no produto
compilado. A continuação não recebe autorização para contornar fechamento.

Cinco testes offline do wrapper completo reproduzem BEFORE sem transporte e
AFTER com transporte simulado; cobrem continuação de agenda, alteração de preço,
discovery válida e discovery sem limites ainda rejeitada. Zero chamada paga nos
testes. Fonte e testes em `.demo/manual-provider-fix-evidence/`.

Staging pausado às 14:30:07Z; RLS/isolamento aprovados. Comparação dos 62 conjuntos
da snapshot: somente AuditLog mudou, com 16 registros esperados. Outbox e estado
operacional intactos. Baseline original preservado; retomada usa snapshot
revisada, sem limpar journals ou redefinir orçamento. Quatro tentativas já
registradas, incluindo a falha local; não reclassificar como fatura.

Preflight e retomada PASS. Mesmo build `X_pW4ibxpeH-NHIM1dIDS`, somente ator
sintético autorizado, JEV OFF. Painel abriu no navegador após retomada. O usuário
deve repetir somente o cenário afetado; E2E da continuação corrigida ainda
PENDING_USER_RETEST. Não declarar validação manual integral.

Regressão do produto concluída nesta sessão: 2.686 PASS em 292 arquivos,
`npm test -- --maxWorkers=2`; lint, TypeScript sem incremental e build PASS.
São separados dos cinco testes do wrapper. Nenhuma alteração posterior no
produto compilado. Cadastro de profissional permanece fora do escopo; cartão
“Vamos preparar sua ação” nesse caso é uma limitação de apresentação pendente.

Evidência sanitizada: `SECRETARY_MANUAL_PROVIDER_FIX_EVIDENCE.json`.
Production não acessada; E/E2 e D histórico inalterados. Sessão manual ON.
