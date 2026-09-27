# Gate 2 — Customers (sem OpenAI real)

Evolução posterior: [Gate 2.1](SECRETARIA_GATE_2_1.md) substitui a seleção manual
por descoberta automática. Os contratos e controles Customers abaixo permanecem.

Worktree `service-create-mvp`, branch `codex/service-create-mvp`, base `9b92138`.
O Gate 1 e suas alterações preexistentes foram preservados. Nenhuma migration,
deploy, alteração de produção ou mudança nos sete agentes internos do CRM.

## Auditoria antes da implementação

Fonte alvo: Revisão 5, seções 6.1/6.2 Customers, T01/T02/T19. Fonte real:

| Evidência | Regra encontrada e decisão |
| --- | --- |
| `prisma/schema.prisma:1119` | Cliente do salão é ClientProfile, não hq_customers. Possui nome, telefone/normalizado, e-mail, aniversário, gênero, notas, relacionamentos e campos de autenticação/mesclagem. |
| `src/app/(admin)/clientes/actions.ts:32` | Cadastro administrativo exige nome com pelo menos 2 caracteres. Telefone/e-mail opcionais. Não importar obrigatoriedade de telefone do cadastro público. |
| `src/app/(admin)/clientes/actions.ts:48` e `:82` | OWNER, MANAGER e RECEPTIONIST criam/editam. PROFESSIONAL tem leituras contextualizadas no CRM e não ganha leitura geral pela Secretária. |
| `src/lib/phone.ts` | Telefone BR: DDD válido, fixo 10 dígitos/celular 11; remove DDI 55. Validador reutilizado. |
| `src/lib/client-identity.ts:20` | E-mail trim/lowercase; telefone canônico nacional. Normalizador reutilizado. |
| `src/lib/client-identity.ts:75` | Duplicidade por e-mail case-insensitive OU telefone normalizado, com compatibilidade de telefone legado; exclui mesclados e próprio alvo. Predicado extraído para reutilização sem acessar credenciais. |
| `src/lib/client-identity.ts:106`, `src/lib/crm.ts:63` | Consultas internas antigas selecionam passwordHash/authIdentityId. Não foram ligadas à Secretária. Customers usa seleção própria explícita, sem carregar esses valores nem para descartá-los depois. |
| `src/lib/prisma-tenant.ts` e `prisma/sql/rls/01_enable_rls.sql` | withTenant/GUCs; ClientProfile com tenant_isolation. No descartável: RLS e FORCE RLS já ativos, confirmados antes de gravações. |

O pacote limita escrita a nome, telefone e e-mail. Aniversário/gênero existem,
mas não foram habilitados neste incremento. Notas podem conter ficha clínica,
alergias, preferências e consentimento serializados: ficam fora. Foto/media_ref
explicitamente desabilitados. Nome ganha trim e limite de 200 caracteres; e-mail,
320. São limites conservadores do contrato conversacional, não mudanças no form.

Proibidos: role, salonId, userId, permissões, saldo, passwordHash, authIdentityId,
tokens, sessionVersion, campos de mesclagem/administração, consentimento e mídia.
Criação deixa defaults técnicos no banco; não cria login nem concede consentimento.

## Contratos e fluxo

- **T01** `searchSalonCustomer(tx, actor, query)`: nome parcial case-insensitive ou
  dígitos de telefone (mínimo 4). Retorno id, nome, telefone mascarado. No máximo
  20 candidatos apresentados; consulta 21 para detectar excesso e pedir refinamento.
- **T02** `getCustomer(tx, actor, customerRef)`: DTO fixo `{id,name,phone,email}`.
  Referência deve existir no salão e não estar mesclada. Não aceita projeção arbitrária.
- **U02** `getOperationRequirements(customer.create|customer.change)`: somente
  name obrigatório na criação; patch name/phone/email; clear permitido phone/email;
  foto desabilitada. Valores solicitados mas ausentes são requisitos condicionais.
- **U03** `upsertCustomerDraft`: adaptador Customers no journal existente. Preserva
  patch/valores, revisão, expiração, alvo e snapshot. `requested_fields=[email]`
  sem valor pergunta e-mail, mesmo se houver um e-mail anterior; não apaga.
- **T19** `proposeCustomerChange(tx,actor,{draft_ref,draft_revision})`: cria proposta
  de customer.create/change; não grava ClientProfile. Mostra antes/depois dos 3 campos.
- Confirmação usa a mesma Server Action e o motor compartilhado
  `confirmJournalAction`: autenticação, escopo, lock, hash, revisão, expiração,
  executor e recibo atômicos. Repetição retorna `duplicate=true`, sem novo UPDATE.

`null` na resposta do modelo significa omitido. Remoção exige `clear_fields`,
convertido pelo backend em null somente para phone/email. Campos omitidos nunca
viram clear. Nomes de clientes não são capitalizados artificialmente.

O backend resolve IDs; schemas do modelo rejeitam customer_ref, service_ref e
qualquer campo desconhecido. Zero resultados não cria draft/proposta de alteração;
um candidato resolve; vários exigem seleção autenticada e reconsulta no tenant.

Duplicidade usa o critério real, não nome isolado. Dois nomes iguais sem contato
compatível são permitidos pelo domínio; não foi inventada uma unicidade de nome.
Com contato compatível, não existe botão de forçar criação. A pessoa pode abrir o
existente (seleção vira somente leitura) ou cancelar/revisar os dados. Não há merge.
Rechecagem de duplicidade na confirmação. Escritas Customers da Secretária usam
lock por salão; outras telas legadas mantêm seus próprios checks. Uma corrida com
escritor legado por telefone (sem índice UNIQUE) permanece uma limitação do domínio.

Concorrência do registro usa xmin e FOR UPDATE, como T18. Alteração posterior à
proposta, inclusive ABA, invalida confirmação. xmin não é versão externa durável.
Resultado verificado vem do commit e DTO; modelo nunca escreve diretamente.

## Agent, manual e carregamento sob demanda

Manual final: `packages/salon-secretary/src/customers-skill.ts` (`customersSkill`).
Orienta classificação, minimização, requisitos reais, patches explícitos, clear,
duplicidade, seleção, foto desabilitada e sucesso somente após commit.

Mesmo Agent normal/Runner do SDK, sem novo agente, handoff ou registry das seis
Skills. A interface seleciona Services ou Customers antes de abrir a conversa.
O servidor valida o enum e carrega apenas o manual/schema selecionado. Não existe
roteador automático por outra inferência; não há parser textual substituindo Luna.
Dentro do pacote, o modelo distingue as operações. Trocar pacote ou operação após
seleção exige nova conversa. Não carregar ambos os manuais indiscriminadamente.

A única Function Tool permanece `upsert_action_draft`, entregando interpretação.
T01/T02/T19 e U02/U03 são coordenados deterministicamente no backend. Uma inferência
por mensagem; leitura, seleção, proposta e confirmação não fazem inferência extra.
Sem hosted tools/containers; store:false, maxTurns=1, tracing desabilitado,
retry=0. Usage existente permanece sem prompts/conversa/telefones/secrets.
Identidade, tenant e papel nunca vêm do modelo. Sessões seguem em memória/TTL local.

## Banco descartável e autorização

Preflight confirmou 127.0.0.1:55441/everflair_service_mvp e diretório
`C:/Users/USURIO~2/AppData/Local/Temp/everflair-service-mvp-762536beeefa4a74b9c2ab5f1dfc3406/data`.
Usuário autorizou especificamente os grants locais de ClientProfile durante esta execução.
Script reproduzível: `scripts/setup-customers-mvp-access.ts`, bloqueado fora do
alvo exato ou se a flag paga não for false. Não reaplica RLS nem migrations.

Grants somente em ClientProfile para mvp_service_runtime:

- SELECT: id, salonId, name, phone, phoneNormalized, email, mergedIntoId, xmin.
- INSERT: id, salonId, name, phone, phoneNormalized, email.
- UPDATE: name, phone, phoneNormalized, email.
- Sem DELETE; sem SELECT de passwordHash; sem UPDATE de sessionVersion;
  sem superuser/BYPASSRLS. Nenhuma outra tabela recebeu grants.

Prisma create incluía sessionVersion/createdAt no INSERT. Em vez de autorizar essas
colunas, o executor usa SQL parametrizado com lista fixa de colunas e defaults do
banco. Não há Tool SQL, SQL gerado pelo modelo nem acesso genérico de escrita.
ID novo é UUID textual válido no schema. Edição usa updateMany e exige count=1.

## Arquivos deste pacote

Novos:
- `src/lib/customer-contract.ts`
- `src/lib/customer-catalog.ts`
- `src/lib/customer-actions.ts`
- `src/lib/secretary-customers.ts`
- `src/lib/secretary-journal.ts` — extração do motor de confirmação anterior, não segundo executor.
- `packages/salon-secretary/src/customers-skill.ts`
- `scripts/setup-customers-mvp-access.ts`
- `src/lib/__tests__/secretary-customers.test.ts`
- `src/lib/__tests__/secretary-customers-flow.test.ts`
- `src/lib/__tests__/secretary-customers.integration.test.ts`
- Este relatório.

Alterados:
- `src/lib/client-identity.ts` — extração do predicado de duplicidade, comportamento antigo preservado.
- `src/lib/service-contract.ts` — dispatch U02.
- `src/lib/service-create-mvp.ts` — reutiliza motor extraído, hashes/schemas/recibos antigos preservados.
- `src/lib/salon-secretary.ts` — mesmo armazenamento/isolamento de sessão e usage.
- `packages/salon-secretary/src/index.ts` — schema/manual conforme pacote selecionado.
- `src/app/(admin)/servicos/secretaria/{actions.ts,page.tsx,secretary-chat.tsx}`.
- `src/lib/__tests__/{salon-secretary-actions.test.ts,salon-secretary-ui.test.tsx}`.

## Validação

10 testes PostgreSQL Customers passaram com runtime normal; modelo fake e fetch
bloqueado. Cobrem A–K, DTO, grants por coluna, RLS ausente/inválido/cross-tenant,
clear explícito, revogação de papel, confirmação concorrente/replay, conflito ABA
e duplicata criada entre proposta e confirmação. Fixtures em salões sintéticos
novos; administrador somente para fixtures e inspeção/configuração local autorizada.

10 testes PostgreSQL Services passaram, incluindo criação com duas inferências
mockadas, T18, revisão/concorrência e idempotência. Testes de fluxo em memória são
adicionais e não apresentados como evidência de PostgreSQL/RLS. Nenhum teste Luna real.

Comandos/resultados:
- `npm run lint`: passou.
- `npx tsc --noEmit --incremental false`: passou, executado isoladamente após o build.
- `npm test -- --maxWorkers=2`: 225 arquivos, 1.247 testes passaram.
- `vitest run secretary-customers.integration.test.ts`: 10 testes passaram, incluindo grants/RLS.
- `vitest run service-change.integration.test.ts`: 10 testes passaram, incluindo T17/T18.
- Após adicionar guarda de expiração pós-inferência e corrigir codificação UTF-8,
  `vitest run secretary-customers-flow.test.ts salon-secretary-ui.test.tsx salon-secretary-actions.test.ts`:
  21 testes passaram, incluindo teste adicional de sessão expirada sem escrita de draft.
- `npm run build`: passou, 61 páginas geradas. Segredo NextAuth sintético somente no
  processo de build; chaves OpenAI vazias nesse processo, configuração persistida intacta.

Conferência final: serviço do Gate 1 permanece Massagem/R$60/60 minutos; o salão
original mantém seus quatro eventos históricos de chamadas reais, sem acréscimos.
SALON_SECRETARY_ALLOW_PAID_CALLS=false; nenhuma chamada OpenAI nesta execução.
Cluster descartável encerrado ao final.

## Rollback

Manter SALON_SECRETARY_ALLOW_PAID_CALLS=false. Reverter somente este incremento,
preservando o Gate 1 e alterações preexistentes sem commit (não usar reset/clean).
Recibos/journal Services mantêm compatibilidade; preservar todo AuditLog. Encerrar
sessões Customers antes de voltar ao código anterior. Sem rollback de schema.

Grants locais podem ser revertidos, com autorização administrativa, por REVOKE
das mesmas listas de colunas acima em ClientProfile para mvp_service_runtime;
não revogar grants de outras tabelas nem alterar RLS. As listas eram ausentes
antes deste pacote. Fixtures sintéticas podem permanecer para auditoria.

## Poucos cenários futuros com Luna, somente após nova autorização

1. Cadastre Amanda Souza: nome suficiente, proposta, confirmar/repetir sem inferência.
2. Alterar telefone de cliente único: patch só telefone, antes/depois e confirmação.
3. Mude o e-mail da Amanda: pergunta novo valor; segunda mensagem completa mesmo draft.
4. Duas Amandas ou duplicata por telefone: seleção/revisão sem escrita automática.

Scheduling, foto, WhatsApp, voz, outros pacotes e produção permanecem fora do escopo.
