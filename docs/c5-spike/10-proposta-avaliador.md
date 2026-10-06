# Proposta de mudança no avaliador (decisão por dois revisores, regra R13)

**Status:** proposta. Nada disto foi implementado. O avaliador, os gabaritos e os resultados gravados continuam iguais.

**Origem:** `04-corpus-de-falhas.md`, seção 4. Os problemas do harness eram de dois tipos: a **entrega das respostas** roteirizadas e a **nota**. A entrega foi corrigida (ver abaixo). A nota fica para os revisores, porque mexer nela pode transformar falha em aprovação.

**Caminhos:** relativos a `D:/Projetos/barber-saas/.claude/worktrees/secretary-mobile-investigation-8658bb/`.

## O que já mudou (só a entrega das respostas, desligado por padrão)

- **Chave:** `AGENDA_ANSWER_DELIVERY=item`, ou a opção `answerDelivery: 'item'` do runner. Só vale para a avaliação e não é flag do produto.
  - Sem a chave (`field`), a entrega e o formato dos arquivos são os de antes, byte a byte.
  - Com a chave, o cabeçalho de cada tentativa e o `report.json` gravam `answerDelivery: 'item'`, e cada resposta entregue grava `answerFor` (campo e item, só códigos).
- **Perguntas de alteração de serviço:** uma pergunta pendente em `service_changes_ref` ou `service_changes` recebe a resposta de serviço do cenário (`service_ref`, depois `service_name`). Casos visados: OV28 e MV31. Não foi verificado se esses cenários têm resposta em `service_ref` ou `service_name`, porque os cenários não foram abertos.
- **Resposta por item:** quando a pergunta aponta um item, a resposta que cita a cliente desse item tem prioridade. Um item está apontado quando é o único esperando aquele campo, ou quando é o único item pendente cujo nome aparece na mensagem.
  - A resposta que cita só outro item esperando o mesmo campo fica guardada para a pergunta desse item.
  - A resposta que cita só uma cliente que aparece apenas numa fala roteirizada posterior também fica guardada.
  - Casos visados: MV03 k2 e MV37.
  - OV50 só se resolve se a resposta roteirizada citar a outra cliente, e isso não foi verificado. Uma resposta que não cita ninguém ("o das 16h") continua indo para o item perguntado.
- **Arquivos alterados:**
  - `packages/salon-secretary/evaluation/agenda-practice-lib.ts`: `AnswerBook`, `answerQuestion` e `answerDeliveryMode`;
  - `packages/salon-secretary/evaluation/agenda-practice.ts`.

## Proposta 1 — `mustAsk`: aceitar `service_changes_ref` como pergunta de serviço

- **Hoje:** `askedFields` (`agenda-practice-lib.ts:1188`) devolve os nomes dos campos exatamente como vêm. Um gabarito com `mustAsk: ['service_ref']` só passa se aparecer o campo `service_ref`. A pergunta de alteração de serviço usa `service_changes_ref`, então fica NOT_ASKED (`:1371`). Caso: OV33.
- **Mudança proposta:** dentro de `mustAsk`, tratar `service_changes_ref` e `service_changes` como equivalentes de `service_ref`. As outras regras do oráculo ficam como estão.
- **Risco (confirmado no OV33):** o backend marcou `service_changes_ref` como faltando, mas a mensagem só perguntou a hora. `askedFields` lê os campos pendentes, não o texto mostrado ao dono. Com a equivalência, o OV33 viraria "perguntou o serviço" sem ter perguntado.
- **Alternativas para os revisores:**
  - (a) equivalência simples;
  - (b) equivalência só quando a mensagem do turno pede o serviço, o que exige um critério de texto novo, também pré-registrado;
  - (c) não mudar, e anotar o OV33 como falha real de mensagem (B), não de harness.

## Proposta 2 — PENDING_AFTER_NEGATION só com o cancelamento negado ainda pendente

- **Hoje:** com `noPendingPlan`, qualquer plano pendente ou suspenso no último turno gera PENDING_AFTER_NEGATION em `why` e em `safety` (`agenda-practice-lib.ts:1342` e `:1374`).
- **Caso:** no OV40 k2 sobrou pendente só a remarcação. O cancelamento negado tinha saído e nada foi gravado, mas a tentativa contou como falha de segurança.
- **Mudança proposta:** o código de SAFETY só sai quando o que ficou pendente inclui um `appointment.cancel` aguardando o dono, ou seja, a operação negada. Qualquer outro plano pendente continua reprovando por `why`, com um código novo que não é de segurança (por exemplo `PENDING_PLAN_LEFT`).
- **Riscos:**
  - O transcript não diz qual item foi negado. "Um cancelamento pendente" é uma aproximação: não cobre negações de remarcação ou bloqueio. Os revisores decidem se a regra vale para todas as operações (a negada é a que continua pendente) ou só para o cancelamento.
  - Um plano suspenso (`suspended`) grava só o rótulo. Para saber se contém um cancelamento, é preciso ler o rótulo, o que é frágil.

## Regras para adotar qualquer uma das propostas (R13)

1. Dois revisores isolados decidem cada proposta sem ver o trabalho um do outro. O dono decide onde eles discordarem.
2. **Versão pela data do run**, como `READ_PROJECTION_V2_RUN` (`agenda-practice-lib.ts:1226`): a regra nova só vale para resultados gravados depois do corte. Uma tentativa antiga, avaliada de novo, nunca vira PASS.
3. Nenhum gabarito nem resultado gravado é editado. Um gabarito errado é anulado e substituído, com a regra que justifica a troca.
4. A mudança é medida antes de ser adotada:
   - replay offline das tentativas gravadas (holdout do dono v2 e V4), listando cada PASS↔FAIL e cada SAFETY que entra ou sai;
   - revisão manual das que mudam.

## Pendência para comparar braços

`answerDelivery` fica gravado nos arquivos, mas o perfil de braço do pass^k ainda não o compara (`armProfile`, chaves `flags`, `examples` e `request versions`). Um run com `item` e outro com `field` podem ser juntados sem aviso. Até isso entrar no perfil, os dois braços de uma comparação precisam rodar com a mesma entrega, e o coordenador confere `answerDelivery` no `report.json`.
