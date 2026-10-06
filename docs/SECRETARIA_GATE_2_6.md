# Gate 2.6 — Inventory Core (local, sem OpenAI real)

Implementação pronta para revisão no worktree `service-create-mvp`, branch
`codex/inventory-core`, base `9b92138ec7665342b60e1ddc210f04ccfa611c84`.
Não implantada. Alterações preexistentes dos Gates anteriores preservadas.
`SALON_SECRETARY_ALLOW_PAID_CALLS=false`; nenhuma credencial/billing alterada.

## Domínio real e reaproveitamento

| Assunto | Evidência | Regra encontrada |
|---|---|---|
| Produto | prisma/schema.prisma:1469 | Product tenant-scoped; stock/minStock Int default 0; preço e custo em centavos; active, barcode, fornecedor, validade e metadados. Sem variante, local, unidade configurável ou fator de conversão. |
| Unidade | src/app/(admin)/produtos/products-catalog.tsx:217 | UI usa un; quantidades inteiras. Não inferir litros, caixas, físico/reservado separado. |
| Saldo | src/lib/appointment-product-service.ts:51 | adjustProductStockReliably lê saldo, trava produto, valida delta e atualiza condicionalmente stock. |
| Negativo | src/lib/operational-flows.ts:42 | delta inteiro não zero; resultado negativo rejeitado. Server action limita delta a ±100000. |
| Movimentos | src/lib/appointment-product-service.ts:87 | AuditLog STOCK_ADJUSTED/Product: delta, previousStock, newStock, kind, produto, ator e motivo. Não há tabela StockMovement. |
| Ajuste administrativo | src/app/(admin)/produtos/actions.ts:100 | OWNER/MANAGER, feature INVENTORY. kind PURCHASE/LOSS/INVENTORY/ADJUSTMENT. Motivo padrão existente: Ajuste rápido; não inferir compra/venda a partir de IN/OUT. |
| Concorrência | src/lib/inventory-lock.ts:17 | pg_advisory_xact_lock; ordem global appointment→professional→product. Reutilizar este lock, nunca lock paralelo incompatível. |
| Estoque baixo | src/app/(admin)/produtos/products-catalog.tsx:71 | stock <= minStock. Tela inclui inativos, identificados como pausados; minStock=0 inclui saldo zero. |
| Produto inativo | src/app/(admin)/produtos/actions.ts:134 | Pausa catálogo. Executor de ajuste manual não rejeita inativo; reserva pública exige active=true. Não inventar proibição de ajuste. |
| Reserva automática | src/lib/appointment-product-service.ts:169 | Produto vinculado ao Appointment por AppointmentProduct; reserva já decrementa stock e audita RESERVATION. Não há saldo reservado independente para somar novamente. |
| Cancelamento | src/lib/appointment-service.ts:1472 | Restitui produtos sob lock e audita. Não modificar essa regra nem tratar baixa manual como venda/receita. |
| Relação com serviços | prisma/schema.prisma:1495 | AppointmentProduct pertence ao atendimento; não há ficha de consumo produto→Service. |
| Leitura/plano | src/app/(admin)/produtos/page.tsx:12 | MANAGEMENT_ROLES=OWNER/MANAGER. Permite histórico mesmo sem feature; escrita exige plano habilitado. |
| Planos | src/lib/plan-entitlements.ts:21 | FREE sem INVENTORY; planos habilitados incluindo PRO. Não ignorar entitlement nos handlers da Secretária. |
| Auditoria | src/lib/audit.ts:11 | writeAuditLog dentro da transação; saldo e evento atômicos. |
| RLS | prisma/sql/rls/01_enable_rls.sql:95 + catálogo local | Product com RLS/FORCE; tenant_isolation usa salonId=app_current_salon() em USING/WITH CHECK. |

Não afirmar que stock é inventário físico ou que reservado=0: stock é o saldo
persistido, já reduzido pelas reservas existentes. Separação físico/reservado não
é modelada; campo indisponível deve ser null/ausente, não zero fabricado.

## Contratos R5 e adaptações ao domínio

| ID | Handler / contrato implementado | Evidência |
|---|---|---|
| T24 search_products | `{query?: string, low_stock?: boolean}` → até 21 candidatos mínimos; UI apresenta até 20 e pede refinamento quando excede | `src/lib/inventory-catalog.ts:21` |
| T25 get_product | referência resolvida pelo backend → DTO autorizado | `src/lib/inventory-catalog.ts:30` |
| T26 get_stock_balance | mesma projeção autorizada, com saldo e unidade reais | `src/lib/inventory-catalog.ts:36` |
| T30 propose_stock_movement | `{draft_ref, draft_revision}` → proposta IN/OUT, saldo anterior, delta e projetado calculados no backend | `src/lib/inventory-actions.ts:60` |
| U02 | `stock.movement`: produto, direção e quantidade; inteiro 1..100000; unidade un; motivo padrão real visível | `src/lib/service-contract.ts:54` |
| U03 | `{product_ref, patch, draft_ref?, expected_revision?}` → draft revisionado; patch somente mode/quantity/reason | `src/lib/inventory-actions.ts:41` |

R5 mapeada pelas fichas T24–T30 da Revisão 5 (texto extraído, linhas 964–1048).
Diferenças deliberadas: quantidade inteira conforme Product/UI, não Decimal;
somente IN/OUT, sem COUNT; sem local/variante/conversão; motivo opcional conforme
executor/UI reais, com default `Ajuste rápido` mostrado na proposta. O tipo de
auditoria é ADJUSTMENT. Uma entrada não vira compra, uma saída não vira venda.
Não foram publicados T27 (histórico), T28/T29 (criação/alteração de produto).
Não há paginação por cursor nem filtro de ativos nesta primeira versão: preserva
leitura do catálogo incluindo inativos, com limite e refinamento por nome.

DTO: `id, name, stock, minStock, active, unit, revision`. Sem preço, custo,
fornecedor, credenciais ou histórico de movimentações. A revisão é hash do snapshot
selecionado, incluindo updatedAt; não é uma referência inventada pelo modelo.

## Manual e Registry

Manual versionado: `packages/salon-secretary/src/inventory-skill.ts:17`, versão 1.0.0.
Orienta busca backend, desambiguação, unidade real, baixo estoque, perguntas somente
sobre campos faltantes, preservação do draft e sucesso somente após recibo.

Registry habilitado: Services, Customers, Scheduling, Financial e Inventory.
Inventory publica `product.search`, `stock.balance`, `stock.movement` e capacidades
U02/U03/T24/T25/T26/T30. U01 deduplica e registra versão/hash como antes.

Permanece UM Agent normal. A primeira inferência combina descoberta e interpretação;
não recebe automaticamente o manual completo de Inventory. Continuação recebe apenas
o manual selecionado. O modelo tem uma Function Tool de interpretação por turno;
os handlers T24–T30 determinísticos são coordenados pelo backend, como nos Gates
anteriores, sem adicionar uma inferência para calcular saldo ou formular proposta.
Zero handoffs/hosted tools/containers; store:false e tracing desabilitado preservados.

Fronteira Inventory: campos opcionais nullable são omitidos, jamais viram clear.
IDs de domínio, stock, delta, projected_stock, SQL e campos não publicados são
rejeitados. low_stock=false não solicita filtro e é permitido; true não pode
acompanhar movimentação. Campos de movimentação são rejeitados em leituras.
Validação de dependências/ciclos do Batch não foi modificada. Batch cross-Skill
continua fora do escopo.

## Fluxo, consistência e confirmação

Nome interpretado → T24 resolve dentro do tenant. Zero retorna ausência; mais de um
exige seleção de candidato autorizada e reconsultada. Produto não encontrado não
vira saldo zero. Erro de consulta/permissão não vira resposta de saldo.

IN/OUT: resolução → U03 → NEEDS_INPUT ou READY → T30 → proposta → confirmação.
Antes da confirmação só existem journal/draft/proposta/telemetria, nenhuma mudança
em Product. Proposta mostra nome/estado ativo, saldo, delta, saldo projetado, motivo.
Todos os números são backend; o modelo nunca soma estoque.

Confirmação utiliza `confirmJournalAction`, sem modelo. Revalida papel, aprovação do
salão, plano INVENTORY, revisão do draft, expiração/hash e produto. Reutiliza
`lockProductMutations`, também trava a linha Product e compara snapshot/updatedAt.
Qualquer mudança exige nova conversa/proposta: não recalcula silenciosamente a
operação aprovada. O executor existente `adjustProductStockReliably` aplica saldo
condicionalmente e grava STOCK_ADJUSTED na mesma transação do recibo.

Duas propostas com snapshot igual: só uma vence, a outra recebe PRODUCT_CHANGED.
Duas confirmações da mesma proposta: um efeito e mesmo receipt_ref; outra recebe
`duplicate=true`. Alteração do draft invalida proposta antiga por REVISION_CONFLICT.
Saldo negativo segue a rejeição do domínio. Proteção adicional de representação:
projeção acima de Int32 é rejeitada antes de gravar.

Campos independentes são preservados; undefined/ausência não apagam campo anterior.
Um produto já selecionado não é trocado silenciosamente por interpretação posterior.
Em conflito de versão, iniciar nova conversa para ler snapshot atual.

## Continuidade, composição e fast-path

`Dê entrada no Shampoo X` → quantidade faltante no mesmo draft → `10`:
parser aceita somente inteiro positivo isolado 1..100000, quando exclusivamente
aguardando quantity, sem candidato/proposta/recibo pendente. Passa pelas mesmas
validações U03/T30. Zero modelo, mesma operação/draft. `dez`, `10 caixas`, fração,
número negativo, aproximação ou outros formatos não usam fast-path.

Seleção na UI não chama modelo. Financial + Inventory mantém operação financeira
read-only separada da proposta de estoque, com refs distintas e confirmação apenas
da movimentação. Nenhuma transação cross-Skill foi criada.

## Segurança e ajuste administrativo autorizado

Destino confirmado antes da escrita: `127.0.0.1:55441/everflair_service_mvp`, cluster
`C:/Users/USURIO~2/AppData/Local/Temp/everflair-service-mvp-762536beeefa4a74b9c2ab5f1dfc3406/data`.
Script reproduzível: `scripts/setup-inventory-mvp-access.ts`.
Pré-condições: flags seguras, URLs exatas, diretório exato, RLS/FORCE e policy
existentes, ACL inicial vazia. Se divergir, aborta; não reaplica migrations.

Grants aplicados exclusivamente com mvp_test_admin, conforme autorização:

```sql
GRANT SELECT (id, "salonId", name, stock, "minStock", active, "updatedAt"),
      UPDATE (stock, "updatedAt") ON "Product" TO mvp_service_runtime;
```

Backup anterior e rollback:
`C:/Users/Usuário/AppData/Local/Temp/everflair-gate26-acl-20260921222509/`.
ACL anterior vazia; RLS/FORCE true antes/depois. tenant_isolation preservada em
USING/WITH CHECK: salonId = app_current_salon(). Sem SELECT de preço/custo, sem
INSERT/DELETE, sem UPDATE geral, sem outro grant/policy/objeto/migration.

Todos os testes funcionais usam mvp_service_runtime, rolsuper=false,
rolbypassrls=false. Admin só ajustou ACL e preparou/limpou fixtures Inventory
sintéticas, tenants A/B PRO e um FREE separado. Everflair Demo Local FREE e fixtures
anteriores não foram alterados. Produto estrangeiro nem é lido nem atualizado;
contexto ausente/inválido não enxerga linhas. Papel RECEPTIONIST é negado; FREE
pode ler, mas não movimentar. Autorizações são revalidadas inclusive antes de
redisplay de resultado Inventory em sessão composta.

SQL observado no executor Prisma, sem parâmetros ou dados pessoais:

```sql
UPDATE "public"."Product" SET "stock" = $1, "updatedAt" = $2
WHERE ("public"."Product"."id" = $3 AND "public"."Product"."salonId" = $4
AND "public"."Product"."stock" = $5)
```

## Latência e custo

Medição local com PostgreSQL, uma observação por continuação (não benchmark):

| Caminho | Interpretação/parsing | U03 | T30 | Mensagem→proposta |
|---|---:|---:|---:|---:|
| Fast-path `10` | 0,088 ms | 5,556 ms | 5,512 ms | 14,932 ms |
| Modelo fake, quantidade por extenso | 6,262 ms | 5,758 ms | 5,045 ms | 21,568 ms |

São cenários sintéticos, sujeitos ao processo/DB/carga; não extrapolar ganho de
latência do Luna real. Uma inferência evitada no fast-path, custo OpenAI zero.
Confirmação/seleção usam zero inferências. Uma interpretação inicial por pedido,
sem inferência extra de cálculo/pergunta/proposta. Usage original continua medido
pelo instrumentServicesModel. Latência registra resolução de produto, query de
saldo, draft, proposta, mensagem total e confirmação+commit (transação completa,
não tempo interno isolado do COMMIT). Não se registra SQL/parametrização em produção.

Progressive Disclosure preservado: teste observa zero manuais completos no pedido
inicial, somente Inventory na continuação; somente Function Tool. O catálogo/schema
de descoberta cresceu ao publicar Inventory. Não há alegação de redução de tokens
iniciais: teste de Services após expansão observou payload de 11.025 caracteres,
1 inferência; continuações carregam seletivamente o manual. Não foi medido custo real.

## Arquivos deste Gate

Criados:
- packages/salon-secretary/src/inventory-skill.ts
- src/lib/inventory-catalog.ts
- src/lib/inventory-actions.ts
- src/lib/secretary-inventory.ts
- src/lib/__tests__/secretary-inventory.test.ts
- src/lib/__tests__/secretary-inventory.integration.test.ts
- scripts/setup-inventory-mvp-access.ts
- docs/SECRETARIA_GATE_2_6.md

Alterados somente para integração/regressão:
- packages/salon-secretary/src/index.ts
- packages/salon-secretary/src/skill-registry.ts
- src/lib/service-contract.ts
- src/lib/salon-secretary.ts
- src/app/(admin)/servicos/secretaria/actions.ts
- src/app/(admin)/servicos/secretaria/secretary-chat.tsx
- src/test/secretary-capability-plan.ts
- src/lib/__tests__/secretary-registry.test.ts
- src/lib/__tests__/secretary-plan-boundary.test.ts
- src/lib/__tests__/salon-secretary-ui.test.tsx

Não houve mudança em executor de estoque, schema/migrations, outras regras de
negócio, sete agentes internos do CRM, credenciais ou configuração de billing.
Outros arquivos já modificados/untracked pertencem aos Gates anteriores.

## Testes e limites de validação

- `npx vitest run src/lib/__tests__/secretary-inventory.integration.test.ts`
  com RUN_SERVICE_MVP_INTEGRATION=1 e configuração descartável: **15 passaram**.
- `npm test`: **1.468 testes em 234 arquivos passaram**, incluindo regressões e UI.
- `npm run lint`, `npx tsc --noEmit --incremental false`, `npm run build`:
  **passaram**. Build incluiu `/servicos/secretaria`; usou segredo NextAuth sintético só no processo.
- Teste UI/jsdom: escolha entre produtos e confirmação da operação Inventory,
  consulta Financial separada sem botão de confirmação.

Cobertura PostgreSQL: saldo, inexistente, zero, baixo/inativo, IN/OUT, nenhum efeito
pré-confirmação, auditoria, repetição, negativa/fração/null/COUNT, saldo alterado,
concorrência entre propostas e mesma proposta, cross-tenant A/B, leitura/update
estrangeiro, contexto ausente/inválido, papel/plano, desambiguação sem modelo,
quantidade no mesmo draft via fast-path, fallback fake, composto Financial+Inventory,
revisão antiga e SQL restrito às colunas autorizadas.

Testes locais adicionais: bounds/formato do fast-path, campos/ref/SQL proibidos,
nullable seguro, discriminação entre Skills, U02, catálogo seletivo e ausência de
hosted tools. Regressões Services/Customers/Scheduling/Financial e golden outputs
reais continuam na suíte geral, sem repetir chamadas pagas de Gates encerrados.

Smoke de schema/ACL/RLS local está no teste PostgreSQL. O job CI schema-smoke
completo não foi disparado: recria schema/aplica migrations em container, fora do
escopo autorizado. Não declarar CI remoto aprovado. Sem novo E2E de navegador;
interface verificada em jsdom e build. Não houve push, PR, deploy ou migração.

## Limitações e rollback

Somente consultas e ajuste manual IN/OUT em unidades. Sem COUNT, compra, fornecedor,
previsão, Product CRUD, conversão, variante/local, histórico T27, preço/custo,
Communication, WhatsApp, voz ou batch transacional cross-Skill. Busca limitada a
20 opções; acima disso requer refinamento. Sessão continua local ao processo,
como no MVP aprovado. Snapshot usa dados selecionados/updatedAt do domínio;
nenhum novo contador de versão/constraint foi criado. Conflito exige nova proposta.

Rollback de código: retirar apenas os oito arquivos novos e os incrementos Inventory
nos dez arquivos listados; preservar integralmente Gates anteriores. Não usar reset
ou clean global neste worktree, que contém trabalho aprovado ainda não commitado.
Antes de revogar grants, comparar ACL atual com backup. SQL documentado (NÃO executado):

```sql
REVOKE SELECT (id, "salonId", name, stock, "minStock", active, "updatedAt"),
       UPDATE (stock, "updatedAt") ON "Product" FROM mvp_service_runtime;
```

Fixtures desta suíte são limpas somente pelos IDs dos tenants/users sintéticos
criados nela. Journal/saldo reais não devem ser apagados para desfazer rollout.

## Próxima validação real recomendada — não autorizada/executada

1. Consultar saldo inequívoco e estoque baixo, números já conhecidos da fixture.
2. Entrada sem quantidade → resposta `10` por fast-path → proposta → confirmação
   única e repetição idempotente sem modelo.
3. Saída com nome ambíguo → seleção UI → proposta; verificar saldo insuficiente
   deterministicamente antes de qualquer confirmação.

Somente após nova autorização explícita. Nenhuma chamada real foi feita neste Gate.

Evidências locais desta execução, sem secrets:
- `%TEMP%/gate26-pg-tests-final.log` — PostgreSQL, latências e SQL parametrizado;
- `%TEMP%/gate26-suite-final.log` — suíte geral;
- `%TEMP%/gate26-lint-final.log` e `%TEMP%/gate26-tsc-final.log`;
- `%TEMP%/gate26-build.log` — build local.

Verificação final via conexão direta **runtime**: database/host/porta exatos,
rolsuper=false, rolbypassrls=false, Product RLS/FORCE=true; exatamente sete SELECTs
de coluna e dois UPDATEs de coluna. `.env.local` continua com paid calls false.
Cluster nativo utilizado nesta execução encerrado ao terminar. Nenhuma chamada
OpenAI, nenhum container/hosted tool, nenhuma alteração produtiva.
