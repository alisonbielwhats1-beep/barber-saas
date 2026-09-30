# Secretária: conversa persistida e apelidos aprendidos (D1)

Criado em 28/09/2026 (recomendação 17, item 1 do dono). Duas flags, **desligadas por padrão**. Com as duas desligadas,
nada muda: a conversa vive só na memória do processo e um reinício ou outra instância falha fechado
(`SESSION_NOT_FOUND`, nada executa).

| Flag | Padrão | O que liga |
|---|---|---|
| `SALON_SECRETARY_PERSISTED_STATE` | desligada | A conversa fica no PostgreSQL e continua depois de recarregar a página, abrir outra aba ou cair em outra instância |
| `SALON_SECRETARY_NAME_ALIASES` | desligada | Nomes que o dono ensinou com um clique viram uma proposta para confirmar (“Fabinho → Fábio Santos · (11) *****-0003 — confirmar?”) |

**Migration só em arquivo, não aplicada em banco nenhum:** `prisma/sql/manual/027_secretary_state{,.preflight,.rollback,.verify,.purge,.schedule}.sql`.
Tabelas só em SQL (sem model no `schema.prisma`), acesso por `$queryRaw` com template dentro de `withTenant`.

## 1. Conversa persistida (`SALON_SECRETARY_PERSISTED_STATE=true`)

- **Tabela `SecretaryConversation`**: uma linha por conversa de nível superior (id = `sessionId`), do usuário autenticado no
  salão ativo. FORCE RLS por salão **e** usuário. `state` guarda o texto JSON exato do agregado (a conversa, as sessões
  filhas das ações, os planos guardados, os recibos de grupo e os resultados de “confirmar tudo”). O texto é exato porque o
  JSONB reordena chaves e o orquestrador compara `JSON.stringify` do próprio estado.
- **Concorrência**: cada chamada do dono pega um *lease* (versão + 1, `leaseUntil` = agora + 120 s), trabalha na memória e
  salva com *compare-and-swap* (`UPDATE … WHERE id AND salonId AND userId AND version = esperada`). Nenhuma transação fica
  aberta durante a chamada da Luna. Outra chamada na mesma conversa enquanto o lease vale recebe `SESSION_BUSY`; se outra
  instância salvou primeiro (lease vencido de um processo que caiu), a gravação atrasada recebe `CONCURRENT_UPDATE`
  (“A conversa foi atualizada em outra aba ou dispositivo…”). A idempotência do domínio continua no journal: repetir a
  mesma aprovação em outra instância devolve o recibo, nunca executa de novo.
- **Leitura estrita**: o estado é validado (zod estrito) antes de voltar para a memória; chave desconhecida, dono diferente
  ou tipo errado → `SESSION_NOT_FOUND` e a linha corrompida é apagada. Outra versão de esquema é recusada sem apagar.
- **Nada fica na memória entre chamadas**: o processo carrega, usa e esquece.
- **Eventos (`SecretaryConversationEvent`)**: só códigos (`TURN_STARTED`, `TURN_OUTCOME`, `SELECTION`, `CONFIRMATION`,
  `DISCARD`, `RESUME`, `CANCEL`, com `ok`, código de erro, códigos do turno, revisão e número de ações). Nunca nomes ou
  texto. Só inclusão (trigger recusa UPDATE; DELETE só pela remoção da conversa). `UNIQUE(conversationId, seq)` e
  `UNIQUE(conversationId, clientTurnId)` (este ainda sem uso: reservado para reenvio idempotente do cliente).
- **Um relógio só**: `expiresAt`, `createdAt`, o lease e toda comparação de validade usam o `now()` do banco. O relógio da
  aplicação (que uma bateria pode fixar longe do real, como a Golden em 12/04/2027) só informa quanto tempo falta: o store
  grava `now() + tempo restante` (0 a 2 h, nunca além de `createdAt` + 2 h) e o `load` devolve a validade no relógio de quem
  chamou. Assim a Golden com a flag ligada não esbarra no CHECK nem vê a conversa vencer antes da hora.
- **Retenção**: a conversa vive no máximo 2 h desde o início, no relógio do banco (o CHECK de 3 h é só um limite de
  segurança). Ao iniciar uma conversa, as vencidas do próprio usuário são apagadas; as de quem não volta só saem pelo purge.
  Por isso **`027_secretary_state.purge.sql` precisa estar agendado antes de ligar qualquer uma das flags**:
  `027_secretary_state.schedule.sql` (pg_cron, papel de manutenção, a cada 30 min; falha fechado sem pg_cron) ou o agendador
  da plataforma no mesmo intervalo. A política de leitura não esconde linhas vencidas de propósito (diferente da 026): o
  PostgreSQL aplica a política de SELECT às linhas que um `DELETE … WHERE` lê, então escondê-las impediria o próprio app de
  apagar as suas; toda leitura e todo lease do app já filtram `"expiresAt" > now()`.
- **Limite**: `SESSION_LIMIT` (10 abertas por usuário) passa a contar as conversas abertas no banco.
- **Reabrir**: a server action `currentSecretary()` devolve a conversa aberta mais recente do dono. O chat pede uma vez,
  quando fica ativo pela primeira vez, fora do `act()`, e só mostra se o dono ainda não fez nada. Sem a flag, a resposta é
  `null` e a tela é a de hoje.
- **“Não era isso”**: com a flag, os códigos vêm do estado salvo (leitura sem lease).
- Código: `src/lib/secretary-session-store.ts` (contrato, `InMemorySessionStore`, `PostgresSessionStore`, codec exato),
  `src/lib/secretary-session-state.ts` (esquema estrito), `src/lib/salon-secretary.ts` (`persisted()`, `current()`).
  O Map em memória continua sendo o padrão (sem store); o `InMemorySessionStore` implementa o mesmo contrato para testes.

## 2. Apelidos aprendidos (`SALON_SECRETARY_NAME_ALIASES=true`)

- **Aprende** só com o **clique** do dono numa opção de um cartão de sugestão ou de homônimos publicado para um nome que ele
  digitou (`selectAutomatic`). Uma escolha feita pela Luna (texto) nunca ensina. Guarda (salão, tipo, texto digitado sem
  acento/artigo/maiúsculas → id escolhido) e o hash do conjunto que a busca exata devolveu naquele momento.
- **Propõe**, quando a busca exata desse texto volta vazia ou exatamente com o conjunto aprendido, e a entidade ainda está
  ativa no mesmo salão (profissional: elegível para o serviço). A proposta é um cartão com a entidade destacada e
  “Não é essa pessoa” (serviço: “Não é esse serviço”). Nada é resolvido sem o clique; “sim” digitado não confirma. O clique é
  conferido de novo pela mesma regra (mesma busca, mesmo apelido, entidade ativa); senão `SELECTION_INVALID`.
- **Só clique, inclusive contra a escolha da Luna**: o cartão mostra uma das possivelmente várias pessoas com o nome digitado
  (os homônimos ficam de fora), então nenhum trecho da mensagem prova a escolha. Uma opção escolhida pela Luna num cartão de
  apelido é recusada antes de tudo (`OPTION_CLICK_REQUIRED`, “Não consegui aplicar essa escolha com segurança…”, o cartão
  continua), e o adaptador recusa a confirmação sem clique (`SELECTION_INVALID`). Digitar o nome completo continua
  funcionando pelo caminho comum (busca exata com um resultado só).
- **“Não é essa pessoa”** (clique): apaga o apelido quando o usuário pode (RLS: OWNER ou MANAGER) e, de qualquer forma,
  mostra o cartão comum e não propõe de novo nesta ação.
- **Cobertura**: cartões da Agenda (cliente, serviço e profissional, inclusive a busca sem serviço do bloqueio e o cartão do
  cancelamento com mensagem, que recebe o clique do dono pelo mesmo caminho). O par cancelar→agendar (batch) e a skill de
  clientes ainda não usam apelidos.
- Telemetria: `name_resolution.outcome = "ALIAS"` (códigos).
- Tabela `SecretaryNameAlias`: RLS por salão; inclusão só com `createdBy` = usuário autenticado; exclusão só para
  OWNER/MANAGER; `UNIQUE(salonId, kind, aliasFolded)`. O purge (agendado, diário) apaga apelidos sem uso há 365 dias e os
  apelidos de cliente cujo cadastro foi mesclado ou apagado.
- Código: `src/lib/secretary-name-aliases.ts`, `src/lib/secretary-scheduling.ts`.

## 3. Baterias (Golden e prática)

- Com `SALON_SECRETARY_PERSISTED_STATE` ligada, os dois executores usam o store persistido, e o portão do banco exige FORCE
  RLS também nas tabelas novas (aliases entram na lista com `SALON_SECRETARY_NAME_ALIASES`).
- A Golden continua sem confirmação e sem escrita operacional. Com a flag ligada, o guarda inspeciona também SQL cru e
  permite **somente** `SecretaryConversation` e `SecretaryConversationEvent` (contadas à parte em `technicalStateWrites`;
  fora do snapshot de efeitos, que só lê tabelas de negócio). Qualquer outra escrita crua é recusada como operacional.
  `SecretaryNameAlias` não entra na lista: só um clique escreve, e a Golden não clica. Com a flag desligada nada muda.
  Regra e testes: `packages/salon-secretary/evaluation/free-use-technical-writes.ts`.

## 4. Como aplicar (coordenador, banco local descartável)

1. Preflight somente leitura (recusa qualquer banco que não seja `everflair_service_mvp@127.0.0.1:55441` ou `salon_schema_ci`):
   `027_secretary_state.preflight.sql`.
2. `027_secretary_state.sql`, depois `027_secretary_state.verify.sql`.
3. `node scripts/setup-local-app-role.cjs` (concede ao `local_app_runtime` quando as tabelas existem com FORCE RLS).
4. Para os testes PostgreSQL: `SALON_SECRETARY_ALLOW_PAID_CALLS=false MVP_SECRETARY_STATE_ADMIN_APPROVED=true`
   `npx tsx scripts/setup-secretary-state-mvp-access.ts` (backup `pg_dump` e rollback gravados antes), então
   `RUN_SERVICE_MVP_INTEGRATION=1` com `secretary-persisted-state.integration.test.ts`.
5. Agendar o purge, como papel de manutenção: `027_secretary_state.schedule.sql` (pg_cron) ou o agendador da plataforma
   rodando `027_secretary_state.purge.sql` a cada 30 min. No banco local descartável (sem pg_cron) o schedule falha fechado;
   rode o purge à mão depois das baterias.
6. Só então ligar as flags. Rollback: desligar as flags e reiniciar; `027_secretary_state.rollback.sql`.

Nunca em Production ou Supabase sem nova autorização.
