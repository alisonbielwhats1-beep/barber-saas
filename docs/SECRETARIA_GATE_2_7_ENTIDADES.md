# Gate 2.7 — nomes compostos e evidência de entidades

Correção local, sem chamadas OpenAI. Testes reais 1–3 permanecem aprovados e não
foram repetidos. Gate 2.7 continua pendente de revalidação exclusiva do Teste 4.
Worktree `service-create-mvp`, branch `codex/communication-core`, base `9b92138`.
Nenhuma alteração em Outbox, provider, credenciais, billing, schema, grants,
RLS, migrations, produção ou integrações externas nesta correção.

## Causa observada e limite da conclusão

Output real preservado em `src/test/fixtures/secretary-real-outputs.json:523`,
ID `gate27-communication-entity-split`. A fonte é o resultado da única chamada
do Teste 4 da bateria anterior; SHA-256 dos argumentos originais registrado.

```json
{
  "skills": ["scheduling", "communication"],
  "independent": false,
  "operations": [
    {"item_key":"a", "operation":"appointment.cancel", "depends_on":[],
     "customer_name":"Amanda", "service_name":"Communication Sintética"},
    {"item_key":"b", "operation":"customer.message", "depends_on":["a"],
     "communication":{"recipient_name":"Amanda", "channel":"WHATSAPP",
       "message_mode":"EXACT", "content":"Amanda, seu horário foi cancelado."}}
  ]
}
```

A entrada mencionava a cliente **Amanda Communication Sintética**, sem serviço.
O modelo repartiu uma única expressão nominal entre dois papéis. Não há como
provar a razão interna dessa escolha a partir do output. O que é verificável:

- `schedulingFields` aceitava textos opcionais independentes, sem descrição
  específica da extensão do nome nem exigência de menção própria de serviço;
- discovery dizia apenas “campos explícitos” e listava customer/service/professional;
- `recipient_name` também era um texto opcional sem orientação de nome completo;
- o transporte/validateSelection validava tipos, Skills, operações e grafo,
  não o papel semântico do trecho da mensagem;
- `secretary-scheduling.ts` buscava cliente/serviço com os textos fornecidos,
  usando consultas autorizadas e separadas; três Amandas levaram à desambiguação;
- o backend não fabricou referências nem moveu fragmentos. Nenhuma proposta,
  cancelamento ou Outbox foi produzida. O TypeError posterior foi do verificador
  do ensaio, que presumiu proposta onde o backend retornou NEEDS_INPUT.

Era uma lacuna de extração/evidência, não de null, IDs, dependências ou Outbox.
Nenhuma dessas validações foi relaxada.

## Camadas corrigidas

1. `packages/salon-secretary/src/entity-extraction.ts`: contrato compartilhado
   de interpretação, utilizado somente por discovery, Scheduling e Communication.
   Preservar expressão nominal completa; não consumir sobrenomes/qualificadores
   para preencher serviço/profissional; ausência continua null/ausência; no grafo
   cancelamento → mensagem, conservar a pessoa mencionada.
2. Descrições nos schemas de customer_name, service_name, professional_name e
   recipient_name. Sem novos campos, tipos ou referências de domínio aceitos.
3. `src/lib/scheduling-entity-mentions.ts`: defesa backend antes do merge/lookup
   operacional, reutilizando T01/withTenant e candidatos limitados.
4. `applySchedulingInterpretation` recebe a mensagem original nas entradas reais
   do coordenador e nas continuações. `startCancellationMessage` a encaminha
   antes de qualquer draft dependente. Fast-path temporal não depende da nova
   defesa de nome, pois não preenche serviço.
5. Handler autenticado apresenta esclarecimento para ENTITY_MENTION_CONFLICT.

Os manuais Services, Customers, Financial e Inventory não foram alterados.
O catálogo, capacidades, grafo, deduplicação e Progressive Disclosure permanecem.
O hash do manual carregado reflete o novo conteúdo; nenhuma Skill nova foi criada.

## Defesa backend

Quando um patch traz service_name novo ou modifica a associação cliente/serviço:

- a menção precisa existir literalmente na mensagem atual, ignorando caixa e
  equivalências Unicode NFC, com limites de palavra;
- busca-se o cliente pelo texto extraído via T01 tenant-scoped, com projeção
  mínima e limite já existente; nomes dos candidatos não são enviados ao modelo;
- localizam-se no texto os nomes completos reais desses candidatos;
- se todas as ocorrências do suposto serviço estiverem contidas nesses nomes
  completos, o patch é rejeitado com ENTITY_MENTION_CONFLICT;
- se existir uma ocorrência independente, segue a resolução normal do serviço;
  zero/múltiplos resultados continuam ausência/desambiguação, nunca adivinhação.

Repetir o mesmo par já aceito no draft durante uma continuação temporal não exige
que o usuário repita os nomes. O teste de reconciliação temporal também cobre
essa repetição do modelo. Trocar cliente ou serviço exige novamente evidência;
campos omitidos continuam preservando o contexto.

Não há lista de nomes/sobrenomes, regra para “Communication/Inventory”, extração
de tudo depois de um primeiro nome, nem remontagem de fragmentos. Não se converte
o serviço rejeitado em sobrenome automaticamente. Nenhum candidato é selecionado
pela nova função; referências continuam vindo dos resolvers existentes.

Exemplos:

| Pedido / interpretação | Resultado |
|---|---|
| Nome completo, sem serviço extraído | Cliente preservado; nenhum filtro de serviço inventado |
| Maria Clara de Souza + Corte masculino explícito | Cliente e serviço separados e preservados |
| Maria Clara de Souza; extração de serviço Clara de Souza | Conflito, antes de draft/proposta |
| Maria Clara de Souza para Clara; serviço Clara | Menção independente existe; domínio deve resolver o serviço |
| Serviço inexistente explicitamente dito | “Não encontrei”, sem alteração da identidade do cliente |
| Cliente ou serviço ambíguo | Seleção independente de candidatos autorizados |

No golden real defeituoso, a boundary estrutural continua aceitando o grafo
correto. A defesa contextual posterior rejeita o fragmento de serviço antes
do draft. Isso evita transformar uma falha semântica em exceção específica no
schema genérico ou em correção silenciosa de identidade.

## Testes sem OpenAI

- Novo `scheduling-entity-mentions.test.ts`: quatro nomes completos passam pelo
  SDK fake/mesmo parser; ausência de serviço; grafo mantido; golden real rejeitado
  pela defesa; serviço explícito separado; sobreposição de palavras; texto não
  sustentado; Unicode, limites de palavra, string vazia e nenhuma escolha de
  candidato pela defesa.
- PostgreSQL Communication: casos completos para Amanda Communication Sintética,
  Maria Clara de Souza, João Pedro Santos e Ana Paula Inventory Teste. Backend
  resolve o cliente/agendamento corretos; mesmo cliente no destinatário; preview
  EXACT preservado; zero escrita operacional. Um caso informa serviço explícito.
- Golden real com banco: rejeição antes de qualquer draft/proposta Scheduling ou
  Communication; agendamento original CONFIRMED e nenhuma Outbox nova.
- Serviço ambíguo: customer_ref completo preservado, candidatos service_ref
  separados e nenhuma proposta dependente.
- Regressões locais EXACT, GENERATED, canal, idempotência, segurança e dependência
  continuam na suíte existente. Não são repetição de testes pagos.
- Mock de serviço inexistente corrigido para que a mensagem realmente mencione
  o serviço inexistente extraído; antes o mock dizia “Inexistente” apesar de a
  mensagem fixa pedir “Progressiva”. A defesa não foi afrouxada para aceitá-lo.
- Fixture adicional Amanda aumenta de duas para três candidatas no teste antigo
  de desambiguação, que foi atualizado sem escolher automaticamente nenhuma.

Resultados:

- `npm test`: **236 arquivos / 1.497 testes aprovados**.
- Foco unit/boundary/Communication: **107 testes aprovados**.
- PostgreSQL final Communication + Scheduling Core: **37 testes aprovados**.
- Scheduling Batch PostgreSQL: **16 testes aprovados** na rodada de regressão.
- `npm run lint`: aprovado.
- `npx tsc --noEmit --incremental false`: aprovado.
- `npm run build`: aprovado, configuração sintética local, exit code 0.

Verificação final sequencial após as últimas alterações: suíte geral, lint,
TypeScript e build. Logs locais em `%TEMP%/gate27-entities-all-final.log`,
`gate27-entities-lint-final.log`, `gate27-entities-tsc-final-check.log`,
`gate27-entities-build-complete.log` e `gate27-entities-pg-complete.log`.
Uma execução intermediária de TypeScript coincidiu com a regeneração de
`.next/types`; foi repetida sequencialmente, sem alterar configuração para
contornar a checagem.

Todos os testes funcionais de banco usaram mvp_service_runtime no descartável
`127.0.0.1:55441/everflair_service_mvp`, cluster temporário já autorizado.
mvp_test_admin foi usado somente por helpers de fixtures sintéticas existentes.
Não foi necessário nenhum objeto/grant novo. Fetch bloqueado nos testes de
Communication; modelos ScriptedServicesModel, nenhum OpenAI real.

## Arquivos deste incremento

Criados:

- `packages/salon-secretary/src/entity-extraction.ts`
- `src/lib/scheduling-entity-mentions.ts`
- `src/lib/__tests__/scheduling-entity-mentions.test.ts`
- este relatório

Alterados:

- `packages/salon-secretary/src/scheduling-skill.ts`
- `packages/salon-secretary/src/communication-skill.ts`
- `packages/salon-secretary/src/skill-registry.ts`
- `src/lib/secretary-scheduling.ts`
- `src/lib/secretary-communication.ts`
- `src/lib/salon-secretary.ts`
- `src/app/(admin)/servicos/secretaria/actions.ts`
- `src/test/fixtures/secretary-real-outputs.json`
- `src/lib/__tests__/secretary-communication.integration.test.ts`
- `src/lib/__tests__/secretary-scheduling.integration.test.ts`

Demais alterações do worktree pertencem aos Gates anteriores e foram preservadas.

## Limitações

Mocks comprovam contratos, encaminhamento e segurança do backend, não a futura
escolha linguística do Luna. Somente a revalidação autorizada poderá confirmar
que o modelo passou a extrair o nome completo nesse cenário.

A defesa é conservadora e limitada aos candidatos autorizados retornados por
T01; não tenta compreender toda a gramática portuguesa. Uma menção independente
é evidência textual mínima, não prova universal de seu papel semântico. Não
resolve sinônimos, abreviações ou nomes mal escritos; deve pedir esclarecimento.
Se o nome completo não estiver entre os candidatos limitados, a nova regra não
deduz um cadastro alternativo; permanecem os bloqueios de resolução existentes.
Conteúdo e nomes não são registrados por essa defesa em logs técnicos.

O mecanismo não reinterpreta operações Services/Customers/Financial/Inventory,
não altera Scheduling Batch e não faz nova inferência para reparar o output.
Há uma consulta T01 adicional quando o patch contém serviço; é limitada e segura,
sem varredura de catálogo. Não se declara ganho de custo/latência nesta correção.

## Rollback

Reverter apenas os blocos/arquivos listados deste incremento, preservando todos
os Gates anteriores no worktree. Remover a defesa/instrução compartilhada e os
encaminhamentos de sourceMessage juntos. Nenhuma reversão de banco é necessária.
Manter golden real como evidência se a correção for substituída. Não usar reset
ou clean global sobre alterações preexistentes.

## Revalidação real preparada — NÃO EXECUTADA

Somente Teste 4, após nova autorização. Revalidar fixtures locais e data relativa
no timezone do salão; preservar um cliente inequívoco com nome completo e reserva
cancelável às 14h. Solicitação, sem inventar serviço:

> Cancele a Amanda Communication Sintética de amanhã às 14h e mande exatamente
> no WhatsApp: “Amanda, seu horário foi cancelado.” Motivo: teste controlado.

Limites propostos: uma solicitação, uma inferência, zero retries, zero confirmação,
zero cancelamento, zero Outbox/dispatch. Não repetir Testes 1–3. Conferir nome
completo em customer_name/recipient_name, service_name ausente/null, grafo a→b,
referências resolvidas exclusivamente backend e proposta conjunta correta.
Se a extração continuar dividida, deve pedir esclarecimento sem proposta e parar.
Registrar usage/latência, desabilitar paid calls ao final e não corrigir durante
o teste. Nenhuma chamada/harness pago foi iniciado para essa revalidação.

`SALON_SECRETARY_ALLOW_PAID_CALLS=false`. Aguardando aprovação.
