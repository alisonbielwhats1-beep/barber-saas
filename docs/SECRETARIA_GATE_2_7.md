# Gate 2.7 — Communication Core

Implementado para revisão, exclusivamente no worktree `service-create-mvp`,
branch `codex/communication-core`, base `9b92138`. Sem deploy, push, produção,
OpenAI real ou comunicação externa. `SALON_SECRETARY_ALLOW_PAID_CALLS=false`.
Este relatório complementa a auditoria `SECRETARIA_GATE_2_7_AUDITORIA.md`.
As alterações dos Gates anteriores permanecem preservadas e ainda não estão
isoladas em commits: o `git status` completo não representa apenas este Gate.

## Domínio e adaptações à R5

A Outbox existente é a fonte única: `prisma/schema.prisma:1362`,
`src/lib/appointment-events.ts:68`. INTERNAL/SENT significa notificação interna
persistida. MANUAL_WHATSAPP é registro de ação manual, não confirmação de
entrega externa. O mailer Resend existente não é chamado por Communication.
Não havia adapter Meta, worker de despacho, janela de conversa, templates Meta
nem política de consentimento para WhatsApp. Consentimento de cuidados do
cliente não foi reaproveitado como opt-in de mensagens.

A R5 prevê T10, T11, T20 e T21. Os IDs são preservados, mas elegibilidade de
canal e entrega neste Gate significam exclusivamente **simulação local**.
Regras oficiais de WhatsApp permanecem não implementadas.

## Contratos e manual

| Capacidade | Entrada / saída | Implementação |
|---|---|---|
| T01 existente | Nome → candidatos limitados, telefone mascarado; tenant obrigatório | `src/lib/customer-catalog.ts:19` |
| T10 get_customer_message_context | Referência resolvida → nome, contato mascarado, revisão, requisitos e elegibilidade LOCAL_FAKE | `src/lib/communication-actions.ts:20` |
| U02 | customer.message → recipient, channel, message_mode, content; sem canal default | `packages/salon-secretary/src/communication-skill.ts:9`, `src/lib/service-contract.ts` |
| U03 | patch + draft_ref/expected_revision → draft/revisão/status/missing_fields | `src/lib/communication-actions.ts:48` |
| T20 propose_customer_message | draft_ref/revisão → proposal_ref, conteúdo, preview, hash, validade | `src/lib/communication-actions.ts:61` |
| Confirmação | proposal_ref/revisão autenticados → recibo estável e message_ref | `src/lib/communication-actions.ts:72` |
| T11 get_message_status | message_ref autorizado → status, tentativas, erro sanitizado, vínculo; sem corpo/telefone | `src/lib/communication-actions.ts:96` |
| T21 restrito | appointment.cancel → customer.message, mesmo cliente → proposta única e recibo | `src/lib/secretary-communication.ts:82` |

Manual final versionado: `packages/salon-secretary/src/communication-skill.ts:10`,
versão 1.0.0. Orienta resolução exclusivamente backend, EXACT literal, GENERATED
explícito, esclarecimento de canal, preview obrigatório, confirmação sem modelo,
dependência real e ausência de alegação de entrega externa. Não habilita campanha,
SMS, e-mail, templates Meta, consentimento inventado ou outra capacidade futura.

O contrato de interpretação é estrito e permite apenas `recipient_name`,
`channel=WHATSAPP`, `message_mode=EXACT|GENERATED`, `content` (até 2.000 caracteres).
Null/ausência preservam os campos opcionais; não aceita telefone, IDs, SQL,
provider ou template arbitrário. Referências aparecem somente após resolução
autorizada pelo backend.

## Registry, Agent e autorização de instructions

O Registry contém as seis Skills, com Communication habilitada somente para o
caminho local protegido. Um único Agent normal continua em uso; descoberta e
interpretação usam Function Tools locais. `store:false`, confirmação sem modelo,
tracing e usage existentes permanecem. Sem hosted tools, handoffs ou containers.

Alterações de instructions limitadas ao autorizado: catálogo Communication,
contrato dessa capacidade, exceção `appointment.cancel → customer.message` e
substituição da proibição genérica de WhatsApp pela proibição de WhatsApp real.
Comparação com snapshot pré-alteração confirmou igualdade das cinco entradas
anteriores do Registry e de todas as linhas de instructions não relacionadas.

U01 continua carregando somente manuais selecionados, com versão/hash e união
deduplicada de capacidades. Services/Customers/Scheduling/Financial/Inventory
isolados não carregam o manual Communication. Communication utiliza T01 sem
carregar o manual Customers inteiro. Financial + Communication permanece um
pedido independente, com resultado financeiro e proposta separados.

Não há redução alegada de contexto: o catálogo/schema de descoberta ficou maior
com a nova Skill. A seleção inicial continua com uma inferência fake por pedido;
não foi introduzida inferência para confirmar ou escolher a próxima ação backend.

## Destinatário, conteúdo e continuidade

Zero clientes retorna ausência; múltiplos exigem seleção de candidato real; a
seleção na interface não usa modelo. Sem telefone BR válido não há proposta.
Não existe canal default: ausência de canal gera pergunta.

EXACT usa o trecho entre um único par de aspas da mensagem original. Preserva
espaços, quebras de linha, acentos e emojis, sem trim ou normalização. Um conteúdo
reescrito pelo modelo é substituído pelo trecho original, nunca o inverso.
Texto sem delimitação inequívoca ou com múltiplos trechos pede esclarecimento.
Não é um parser genérico de intenções.

GENERATED só é aceito quando o pedido autoriza geração explicitamente; a sugestão
completa fica no draft e no preview. Não se envia texto oculto diferente do hash
confirmado. Nova revisão torna a proposta anterior não confirmável.

Fast-path de canal: exclusivamente `WhatsApp`, quando o único requisito faltante
é channel, sem seleção pendente, proposta ou recibo. Preserva o mesmo draft e
conteúdo; ambiguidade retorna à interpretação. Evidência:
`src/lib/secretary-communication.ts:18`, `:23`, `:33`.

## Confirmação, transação e Outbox

O journal compartilhado fornece lock, revisão, expiração, hash e recibo. A
confirmação revalida papel, tenant, destinatário/contato e eventual cancelamento.
Sem confirmação existem apenas drafts/propostas/auditoria, nenhum enqueue ou
cancelamento operacional.

Cancelamento dependente reutiliza `executeSchedulingMutation`; motivo continua
obrigatório. Regras de status/evento/fila do domínio não foram duplicadas. A ação
não recebe uma proposta separada que permitiria cancelar antecipadamente.
Cancelamento, evento, Outbox e recibo são gravados na mesma transação tenant-scoped.
Falha ao inserir Outbox reverte cancelamento e evento. A mensagem recebe o evento
e appointment reais; o alvo deve ser o mesmo cliente.

Somente após o commit o coordenador chama `dispatchLocalMessage` em uma nova
transação. O único provider permitido é `FakeCommunicationProvider`, sem rede.
Uma falha posterior marca a comunicação FAILED e mantém o negócio concluído.
Repetição e confirmações concorrentes retornam o mesmo recibo; PK derivada da
proposta e locks impedem segundo enqueue/despacho. Não dependem de unique com
eventId nulo. Evidências: `communication-actions.ts:72`, `:101` e
`salon-secretary.ts:364`.

## Estados reais, retry e interface futura

| Situação | Persistência / resposta |
|---|---|
| Rascunho / proposta | Journal DRAFT / PROPOSAL, nenhuma mensagem na Outbox |
| Commit | Outbox PENDING, recibo QUEUED |
| Fake aceitou | PENDING, attempts=1; DTO SIMULATED, external_delivery=false |
| Fake falhou | FAILED, attempts=1, erro FAKE_FAILURE; MANUAL_REVIEW |
| Repetição | Mesmo recibo, duplicate=true; nenhuma nova tentativa |

`sentAt` e `readAt` permanecem nulos. Nenhum SENT/DELIVERED/READ externo é
fabricado. Campos de retry existentes são preservados, mas não há worker nem
retry automático; nextAttemptAt permanece nulo. T11 é handler backend e alimenta
o resultado após confirmação; não foi criado um novo intent de consulta de
status em linguagem natural.

`src/lib/communication-provider.ts:3` define a interface e o fake. O contrato
atual não finge implementar eventos/webhooks oficiais. Um futuro adapter real
exigirá evolução explícita dos estados/capacidades, nunca troca silenciosa do
fake por envio externo.

## Segurança e banco autorizado

Somente `127.0.0.1:55441/everflair_service_mvp`. Cluster validado:
`C:/Users/USURIO~2/AppData/Local/Temp/everflair-service-mvp-762536beeefa4a74b9c2ab5f1dfc3406/data`.
Testes funcionais usam mvp_service_runtime; mvp_test_admin apenas backup,
alteração aprovada, fixtures sintéticas e limpeza dessas fixtures.

O script `scripts/setup-communication-mvp-access.ts` recusa drift/reaplicação,
confere ACLs/objetos/roles, faz pg_dump/schema/linhas/ACLs e compara o hash das
linhas após o ajuste. Aplicado somente o enum WHATSAPP, opcionalidade do par
eventId/appointmentId, CHECK aprovado e UPDATE em status, attempts,
nextAttemptAt, lastError, updatedAt. SELECT/INSERT anteriores preservados;
nenhum DELETE, UPDATE global ou privilégio em outra coluna/tabela.

Postcheck: RLS=true; FORCE RLS=true; tenant_isolation permanece
`salonId = app_current_salon()` em USING/WITH CHECK; runtime rolsuper=false,
rolbypassrls=false. A/B com registros positivos não veem dados um do outro;
sem contexto, zero linhas. OWNER/MANAGER/RECEPTIONIST podem preparar mensagem;
o cancelamento dependente mantém OWNER/MANAGER. PROFESSIONAL rejeitado.

Matrix PostgreSQL: ambos IDs presentes aceitos nos quatro canais; ambos ausentes
aceitos apenas WHATSAPP; qualquer par parcial rejeitado; ambos ausentes rejeitados
em INTERNAL/EMAIL/MANUAL_WHATSAPP. Testes efetuados com runtime, rollback das
linhas da matrix, sem modificar policies/FKs/índices/triggers existentes.

Backup administrativo local:
`C:/Users/USURIO~2/AppData/Local/Temp/everflair-gate27-backup-e1f755c62a2740f0bd78efd2518471c3`.
Contém before/after.json, schema-before.sql, outbox-before.sql/json e rollback.sql.
Nenhum valor de credencial faz parte deste relatório.

## Privacidade

O modelo recebe nomes fornecidos pelo usuário e contexto mínimo; não recebe
telefone completo resolvido. T10 usa máscara/revisão hash; T11 não inclui corpo.
Payload da Outbox e journal tenant-scoped guardam o conteúdo necessário para
preview/auditoria/execução. Isso não equivale a telemetria anônima: o conteúdo
deve continuar protegido pelos controles existentes. Não foi criada política
nova de retenção/purge. Logs técnicos/latência guardam refs, hashes e tempos,
sem telefone, corpo completo, token ou secret. Fake registra apenas chave/hash.

## Testes e regressões

- `npm test`: 235 arquivos, **1.485 testes aprovados**.
- `npm run lint`: aprovado.
- `npx tsc --noEmit --incremental false`: aprovado.
- `npm run build`: aprovado com configuração sintética local. A primeira
  tentativa encontrou lock Windows na DLL Prisma durante testes concorrentes;
  executado novamente após os testes, concluiu com exit code 0. Não houve
  alteração de configuração produtiva para o build.
- Communication unit: 15 testes (incluindo parametrizados), conteúdo literal,
  geração explícita, injeção de campos, fast-path, grafo e disclosure.
- Communication PostgreSQL: 13 testes, incluindo matrix de 16 combinações,
  A/B positivo, auth, zero efeito antes da confirmação, concorrência, revisão,
  rollback do enqueue e falha do fake após commit.
- UI: preview exato, confirmação conjunta pelo handler autenticado e nenhum
  envio pela interpretação; integrado à suíte geral.
- Regressões PostgreSQL dos dez arquivos: 149/150 passaram no primeiro lote;
  uma expectativa antiga de plano dependente sem IDs foi ajustada para rejeição
  já exigida pela boundary aprovada. Rerun Registry + Communication: **20/20**.
  A falha remanescente foi resolvida e o arquivo correspondente passou inteiro.
  Services, Customers, Scheduling Core/Actions/Batch,
  Financial, Inventory e Registry preservados.

Execução PostgreSQL: `RUN_SERVICE_MVP_INTEGRATION=1 npx vitest run` com os
arquivos de regressão existentes. Rerun final dirigido:
`npx vitest run src/lib/__tests__/secretary-registry.integration.test.ts src/lib/__tests__/secretary-communication.integration.test.ts`,
com a mesma flag, APP_ENV=test, paid=false e conexão mvp_service_runtime local.

Logs locais: `%TEMP%/gate27-suite3.log`, `gate27-tsc4.log`, `gate27-lint2.log`,
`gate27-regression-pg.log`, `gate27-pg-final.log`, `gate27-build2.log`.
Fetch bloqueado nos testes Communication, com asserção de zero chamadas.

O job CI completo `schema-smoke` não foi executado: seu bootstrap aplica outros
objetos e utiliza container, fora da autorização deste Gate. Foi executada a
validação dirigida do schema real descartável, constraints, ACLs, RLS e FKs.
Isso não é uma alegação de CI/Preview/deploy aprovados.

## Latências locais observadas

Amostra de teste fake, não benchmark de Luna ou garantia de produção:

| Etapa | ms |
|---|---:|
| Interpretação fake | 97,15 |
| Resolução destinatário | 14,32 |
| Preparação draft | 16,69 |
| Proposta | 15,47 |
| Mensagem → proposta | 192,65 |
| Confirmação → commit | 13,85 |
| Provider fake | 0,28 |
| Despacho completo | 14,98 |
| Parsing fast-path canal | 0,10 |
| Continuação fast-path → proposta | 49,82 |

Fast-path evitou uma inferência no caso testado. Confirmação/repetição usaram
zero inferências. Custo real OpenAI deste trabalho = zero; tempos fake não
estimam a latência futura do provedor.

## Arquivos deste incremento

Criados: `packages/salon-secretary/src/communication-skill.ts`,
`src/lib/communication-provider.ts`, `src/lib/communication-actions.ts`,
`src/lib/secretary-communication.ts`, testes unit/PG Communication,
`scripts/setup-communication-mvp-access.ts`, auditoria e este relatório.

Alterados: `packages/salon-secretary/src/{index,skill-registry}.ts`,
`src/lib/{service-contract,secretary-scheduling,salon-secretary}.ts`,
`prisma/schema.prisma`, `src/app/(admin)/servicos/secretaria/{secretary-chat.tsx,actions.ts}`,
as páginas de notificações admin e book (relações agora opcionais),
`src/test/secretary-capability-plan.ts`, testes Registry unit/PG, boundary e UI.
Os demais arquivos no git status pertencem a trabalho anterior; não revertê-los.

## Limitações e rollback

Comunicação exclusivamente local fake, uma mensagem individual, somente WhatsApp
simulado, no máximo 2.000 caracteres. EXACT exige um trecho inequívoco entre
aspas. Geração exige solicitação explícita. Sem consentimento/janela/template
oficial, anexos, campanhas, rede ou retry automático. O único grafo cross-Skill
dependente suportado é cancelamento → mensagem ao mesmo cliente. Combinações
Scheduling/Communication fora desse grafo são rejeitadas, inclusive o caso
contraditório agendar + mensagem de cancelamento. Isso é uma lista restrita,
não um detector universal de contradições em texto livre.

Rollback de aplicação: retirar somente os arquivos/blocos listados deste Gate,
restaurando o snapshot anterior, sem git reset/clean do worktree com Gates
anteriores. Desabilitar a entrada Communication se for necessária interrupção
imediata. Preservar journal/outbox/histórico.

Rollback SQL documentado no backup: revogar apenas os cinco UPDATE, restaurar
NOT NULL e remover CHECK em transação. Se existirem mensagens avulsas, NOT NULL
falha e a transação inteira reverte: parar e revisar preservação de histórico.
Não apagar registros para forçar rollback. WHATSAPP pode permanecer inerte no
enum; reconstruir enum/objetos não foi autorizado. Nenhum rollback foi aplicado.

## Próximas validações, somente após aprovação

Poucos cenários Luna recomendados: EXACT com espaços/acentos; GENERATED
explicitamente solicitado e preview; canal faltante seguido de WhatsApp por
fast-path; cancelamento com motivo explícito + mensagem ao mesmo cliente e
falha fake posterior. Nenhum desses testes reais foi executado aqui.

Futura integração oficial Meta exige outro escopo aprovado: conta/número por
salão e secrets protegidos, opt-in/preferências, janela e templates, adapter
oficial, despacho externo pós-commit, IDs do provider e webhooks autenticados,
estados comprovados e deduplicação, retry limitado e tratamento de incerteza.
Não basta habilitar uma flag para transformar esta simulação em envio real.

Gate 2.7 pronto para revisão local. Não validado com Luna real; nenhum avanço
para Gate 3, Meta ou qualquer canal externo.

Finalização: cluster descartável encerrado por pg_ctl após os testes; nenhum
servidor web de teste permaneceu ativo. `.env.local` conferido com
`SALON_SECRETARY_ALLOW_PAID_CALLS=false`. Zero mensagens externas e zero chamadas
OpenAI. Aguardando aprovação do responsável.
