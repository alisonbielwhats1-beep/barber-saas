# Secretária: referências entre ações (`same_as`, C5)

28/09/2026. Recomendação 14 do relatório de arquitetura. Flag `SALON_SECRETARY_SAME_AS` (padrão desligado).
Nenhuma chamada à Luna real e nenhum banco. Com a flag desligada, o wire, o prompt, a versão do contrato e o
comportamento do backend são os históricos, byte a byte (as 53 linhas de medição dos testes de orçamento são
idênticas e `node scripts/secretary-contract-version.cjs --check` não acusa diferença).

## 1. O problema

Pedidos compostos citam valores de OUTRA ação do mesmo pedido:

- "Marca a Carla para Escova quinta às 14h e a Rosa para Coloração no mesmo dia às 15h" (C06): o dia da Rosa é o
  da Carla. Hoje a Secretária pergunta o dia da Rosa (seguro, mas uma pergunta a mais).
- "Cancela a Amanda e passa o Fábio para o horário dela" (V27): o destino do Fábio é o horário que o cancelamento
  libera. Hoje a remarcação é validada contra a agenda atual, onde a Amanda ainda ocupa o horário.
- "... no mesmo dia e horário com ela" (profissional), "avisa ela" (cliente da mensagem).

Nada disso pode virar regra por frase. O contrato ganha um vínculo estruturado, e o backend copia o valor ACEITO
pela outra ação (nunca o valor que a Luna escreveu).

## 2. Contrato (só com a flag)

Toda operação NEW/ADD que pode seguir outro valor (as operações de agenda e `customer.message`) ganha, logo depois
dos campos de grafo:

```
same_as: null | [{ field: date|time|professional|customer, item_key, literal }]
```

- `item_key` é a chave de outra operação do mesmo envelope ou, em ADD, de uma ação do plano ativo.
- `literal` é só a expressão de referência ("no mesmo dia", "no horário dela", "com ela").
- A regra fica uma vez só, na descrição do próprio campo (`sameAsInstructions`, em
  `packages/salon-secretary/src/same-as.ts`). Ela diz que "no horário dela" vale como date e time, que o campo
  referenciado não deve ser preenchido na operação e que criar no horário liberado por um cancelamento continua
  sendo `released_slot_of`.
- Nunca aparece em PATCH ou RESUME (vínculos são dados do grafo, não deltas) nem no adapter isolado (CURRENT).

### Validação (`checkReferences`, `preparationGraph`)

Estrutural, nunca de intenção:

| Situação | Resultado |
|---|---|
| Flag desligada e referência presente | `CAPABILITY_FIELD_MISMATCH` (a operação sai; com aceitação parcial o dono é avisado) |
| Chave desconhecida, a própria chave, ação descartada | `SAME_AS_INVALID` na operação |
| Campo que o alvo não segue ou que a fonte não tem | `SAME_AS_INVALID` na operação |
| Duas referências para o mesmo campo | `SAME_AS_INVALID` na operação |
| Ciclo no grafo de preparação (depends_on ∪ same_as) | `INVALID_DEPENDENCY_GRAPH`, turno inteiro (igual a um ciclo de depends_on) |
| Operação que referencia outra deixada de fora | sai junto (`DEPENDENT_OF_REJECTED`) |
| Referência ao lado de `released_slot_of` | descartada em silêncio: o horário liberado já define dia, hora e profissional |

Quem segue o quê:

| Campo | Pode seguir (alvo) | Pode ser copiado de (fonte) |
|---|---|---|
| date, time | criar, remarcar (destino), bloquear | criar, remarcar (destino), bloquear, cancelar (o agendamento localizado) |
| professional | criar, bloquear; remarcar aceita, mas não muda nada (remarcar mantém o profissional) | criar, remarcar, bloquear, cancelar |
| customer | criar, remarcar, cancelar (localizam), mensagem (destinatário) | criar, remarcar, cancelar |

## 3. Backend

Módulos: `src/lib/secretary-same-as.ts` (valores aceitos, prova do literal, comparação) e os métodos
`prepareReferences`, `syncReferences` e `followReferences` de `src/lib/salon-secretary.ts`.

**Ordem e grupo.** O plano ordena e agrupa pelo grafo de preparação (`execution_order` e componentes de
`depends_on ∪ same_as`). A ação referenciada é preparada antes, e ações vinculadas ficam no mesmo grupo de
confirmação. A execução continua esperando só `depends_on`: um vínculo não bloqueia nem é bloqueado.

**Valor aceito.** É lido do rascunho do journal da outra ação (dia e horário aceitos, profissional e cliente
resolvidos pelo backend, com o nome canônico do catálogo) ou do agendamento que um cancelamento ou remarcação
localizou. Nunca vem do envelope da Luna. Ele entra no rascunho dependente como estado anterior, então a
comprovação temporal só verifica evidência nova.

**Prova do literal** (`referenceLiteralProven`). O literal precisa:

- ser um trecho de tokens inteiros da mensagem (tolerante a caixa e acento), dentro da oração verificada da ação
  quando ela existe; sem oração verificada, ocorrer **uma única vez** na mensagem (revisão de 28/09: a ocorrência
  de uma ação irmã nunca prova a referência negada desta, como em "a Rosa no mesmo dia e o Fábio não no mesmo dia");
- não ser negado na sua oração, em nenhuma ocorrência considerada; "sem (ser)" antes do literal, na mesma oração,
  nega como um negador ("sem ser no horário dela");
- não declarar data ou horário próprios;
- conter uma palavra de anáfora ou identidade (classe gramatical fechada: mesmo/mesma, igual, ele/ela, dele/dela,
  nele/nela, junto...) ou uma palavra do sujeito da ação citada ("no horário da Amanda").

**Resultado de cada referência na primeira preparação:**

| Caso | Efeito | Código |
|---|---|---|
| Provada, valor conhecido, a Luna não deu valor próprio | valor copiado; vínculo mantido | `SAME_AS_SEEDED` |
| Provada, a Luna deu o mesmo valor | copiado; vínculo mantido | `SAME_AS_AGREED` |
| Provada, a Luna deu outro valor | nenhum escolhido: o campo é perguntado com "Recebi indicações diferentes para o dia e não escolhi nenhuma."; vínculo desfeito | `SAME_AS_CONFLICT` |
| Provada, valor ainda desconhecido | o campo ESPERA: nota "Agendar — Rosa: aguardando o dia do agendamento de Carla." (nunca uma pergunta, nunca um palpite, nenhuma proposta) | `SAME_AS_WAITING` |
| Valor desconhecido e a Luna deu valor próprio | vale o valor dito pelo dono (comprovado pelo adapter); vínculo desfeito | `SAME_AS_OWN_VALUE` |
| Literal não comprovado | o campo é perguntado; vínculo desfeito | `SAME_AS_LITERAL_UNPROVEN` |
| A ação citada não pode mais dar o valor (falhou, bloqueada, descartada) | o campo é perguntado | `SAME_AS_GONE` |

Um campo que espera ou que é perguntado nunca é herdado: uma remarcação só com hora, cujo dia espera outra ação,
não fica no dia original (regra GF14), e um profissional que espera não é atribuído automaticamente.

**Depois de cada turno** (`syncReferences`, dentro de `preparePlanSafely` e no descarte), cada vínculo segue o
valor ATUAL da ação citada, sem chamada ao modelo:

- valor novo ou alterado: é copiado de novo; a proposta dependente é retirada e preparada outra vez, e a revisão
  muda, então aprovações antigas ficam velhas (`SAME_AS_REDERIVED`);
- valor retirado: o campo volta a esperar; a cópia antiga fica, mas não é usável;
- ação citada que não pode mais dar um valor ausente: vínculo desfeito, campo perguntado (`SAME_AS_GONE`);
- valor que o dono mudou na própria ação dependente: o vínculo daquele campo termina (`SAME_AS_OVERRIDDEN`).
  Exemplo: "no mesmo dia e horário com ela" e depois "a Rosa às 16h" mantém dia e profissional vinculados e
  solta só o horário.

**Mensagem que segue o cliente ("avisa ela").** Quando o destinatário conhecido muda por causa do vínculo (a
Carla foi corrigida para a Rosa), o texto e o modo da mensagem são descartados e perguntados de novo
(`reseedCommunication`, revisão de 28/09): um texto escrito para a Carla nunca segue para a Rosa.

**Apresentação.** Uma ação que só espera é uma nota depois das perguntas (`ClarificationHint.waiting`). Ela não
entra nas perguntas numeradas nem no contexto como `requested_field`. O aviso de conflito aparece como aviso da
ação. Telemetria: só códigos, em `failed_codes`.

## 4. V27: remarcar para o horário que um cancelamento do mesmo pedido libera

Havia duas opções. Estender o lote atômico (hoje só cancelar→criar) para cancelar→remarcar, ou manter as duas ações
no mesmo grupo, com o cancelamento executado antes e o horário conferido de novo na execução. Escolhida a segunda,
porque:

1. O lote atômico, o seu journal, a projeção de `loadVisitDay` e o executor numa transação única são exclusivos de
   criação. Estendê-los exigiria um executor de remarcação dentro de `confirmActionBatch` e mudanças em arquivos
   fixados sem arquivamento (`visit-scheduling.ts`, `appointment-service.ts`).
2. O cancelamento é uma intenção própria do dono, com motivo literal. O sucesso dele não depende da remarcação.
3. O caminho sequencial nunca gera marcação dupla nem perde agendamento.

Como funciona:

- **Preparação.** Com uma referência de horário provada a um cancelamento pendente, o backend deriva a aresta de
  execução cancelamento → remarcação (`releaseAfter`; recusada se fechar um ciclo). A remarcação é validada numa
  visão da agenda sem o agendamento que será cancelado (`releasedAgendaView`, `src/lib/scheduling-released-slot.ts`,
  a mesma projeção que o par atômico usa; só leituras de `appointment` e `resourceBooking`). A visão é aplicada em
  `inspectSchedulingMove`, `schedulingActionSnapshot` e `proposeSchedulingAction`. Uma referência só de dia não
  libera horário e não deriva aresta.
- **Execução.** Um único "confirmar" executa o cancelamento e depois a remarcação. O executor da remarcação não
  recebe a projeção: relê a agenda confirmada sob lock (snapshot novo igual ao proposto, e
  `requestStaffReschedule` confere o horário).

| O que acontece | Resultado |
|---|---|
| Tudo livre | cancelamento DONE, remarcação DONE |
| Alguém ocupou o horário no meio | cancelamento DONE, remarcação FAILED_SAFE (o Fábio continua no horário original) |
| O cancelamento falha | remarcação BLOCKED_BY_DEPENDENCY, nunca executada |
| Descartar o cancelamento | pergunta antes: descarta também a remarcação (dependente) |
| Amanda com dois agendamentos | a remarcação espera a escolha; escolhido um, segue o horário dele |

## 5. Orçamento da requisição

Medido com o diretório realista (8 + 24 nomes), 10 ações ativas + 50 suspensas e saída 8192. O campo custa cerca
de 810 bytes e a flag paga esse custo com a compactação por cópias emitidas (a mesma do C4; o schema resolvido é
idêntico: o wire com a flag, sem `same_as`, é igual ao wire sem a flag).

| Formato | components | JIT | desligada | same_as | margem | polaridade | ambas | margem (ambas) |
|---|---|---|---|---|---|---|---|---|
| estresse | não | não | 62437 | 60577 | 3423 | 60483 | 61290 | 2710 |
| estresse | sim | não | 63048 | 61092 | 2908 | 61096 | 61903 | 2097 |
| estresse | não | sim | 61611 | 59751 | 4249 | 59657 | 60464 | 3536 |
| estresse | sim | sim | 62018 | 60062 | 3938 | 60066 | 60873 | 3127 |
| resposta ao adapter | sim | não | 63687 | 61731 | 2269 | 61735 | 62542 | 1458 |
| resposta ao adapter | sim | sim | 62464 | 60508 | 3492 | 60512 | 61319 | 2681 |
| continuação multiação | sim | sim | 62179 | 60223 | 3777 | 60227 | 61034 | 2966 |
| continuação multiação | sim | não | 66042 | 64086 | −86 | 64090 | 64897 | −897 |

Com a flag, toda forma fica 1860 a 1956 bytes menor que sem ela. A continuação multiação com JIT desligado já
estava acima do limite antes (pré-existente, ver C6) e só cabe com JIT ligado. Teste:
`src/lib/__tests__/secretary-same-as-wire.test.ts` (as linhas `c5SameAsBudget` saem com `--reporter=verbose`).

## 6. Versão do contrato

`sameAs: true` só entra nas flags do contrato quando ligada. Os cinco perfis registrados em
`packages/salon-secretary/contract-version.json` não mudam. Não há perfil com `same_as` registrado; o coordenador
o adiciona depois das baterias (`node scripts/secretary-contract-version.cjs --write`).

## 7. Pendências

- Nenhuma avaliação com a Luna real. A leitura de quem se refere a quem continua sendo da Luna; o backend só
  verifica a estrutura (literal, campos aplicáveis, grafo) e copia valores aceitos.
- Criar no horário de um cancelamento continua sendo o par atômico (`released_slot_of`). Se a Luna usar `same_as`
  nesse caso, a criação não recebe a projeção: o horário aparece ocupado e a Secretária pergunta outro. É seguro,
  mas é uma pergunta a mais.
- A execução de cancelamento → remarcação não é atômica, por decisão: veja a tabela da seção 4.
- Uma cópia de valor retirado (a ação citada perdeu o valor) fica no rascunho dependente, marcada como não usável,
  até o valor voltar.
- Os vínculos e o seu estado (`references` no estado do adapter filho) vivem na memória da sessão, como o resto do
  plano.
