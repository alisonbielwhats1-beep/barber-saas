# Fontes do banco de exemplos da Secretária (few-shot)

Criado em 28/09/2026. Registra de onde vêm os exemplos de
`packages/salon-secretary/src/examples/`, as licenças das fontes públicas usadas como inspiração, a
atribuição devida e a regra anti-contaminação que separa este banco das baterias de avaliação.

## 1. O que é o banco

| Arquivo | Prefixo | Exemplos | Conteúdo |
|---|---|---|---|
| `bank-single.json` | `S` | 84 | Um pedido por mensagem: marcar, remarcar, cancelar, bloquear, consultar |
| `bank-multi.json` | `M` | 56 | Várias ações na mesma mensagem, dependências, correções e descartes de plano |
| `bank-answers.json` | `R` | 65 | Respostas curtas a uma ou várias perguntas pendentes, escolhas, correções e limites do catálogo |
| `bank.json` | — | 205 | Concatenação exata dos três arquivos acima, na ordem S, M, R |

O banco ensina a Luna a transformar mensagens reais e bagunçadas do dono do salão (digitação no
celular e ditado por voz: sem acento, abreviações como pq/q/vc/tb/hj, muletas como "é", "tipo",
"né", autocorreções como "não pera", números por extenso, erros como "orario") no contrato
estruturado da Secretária. O código em `packages/salon-secretary/src/examples/` só mostra exemplos à Luna com
`SALON_SECRETARY_EXAMPLES` ligada (seção 8); desligada, nenhum exemplo entra no pedido.

Todos os exemplos usam o relógio fixo `2027-04-12T09:00` (segunda-feira, 12/04/2027). Todos os
nomes de clientes e profissionais são fictícios. Nomes que coincidem com pessoas públicas conhecidas
foram trocados na revisão. Desde o G1 (seção 10) o banco não guarda mais nomes: pessoas e serviços são marcadores
(`{cliente}`, `{profissional}`, `{servico}`...) preenchidos na hora de montar cada pedido.

## 2. Fontes e licenças

O campo `source` de cada exemplo diz de onde veio a ideia da frase.

| `source` | Exemplos | Fonte | Licença | Como foi usada |
|---|---|---|---|---|
| `own` | 174 | Escrito para este projeto | Do projeto | Frases, nomes, serviços e respostas esperadas originais |
| `pattern:duckling` | 13 | Duckling, corpus de expressões de tempo em português (`Duckling/Time/PT/Corpus.hs`) | BSD-3-Clause | Só inspiração de como se fala data e hora ("meio dia e meia", "quinze pras três", "semana que vem"). Nenhuma frase foi copiada |
| `pattern:recognizers` | 6 | Microsoft Recognizers-Text, especificações de DateTime em português (`Specs/DateTime/Portuguese`) | MIT | Só inspiração de formas informais de data e hora ("daqui 3 dias", "dez e meia"). Nenhuma frase foi copiada |
| `pattern:sgd` | 7 | Schema-Guided Dialogue (SGD / DSTC8), serviços de cabeleireiro e agenda | CC BY-SA 4.0 | **Somente estrutura**: que tipos de pedido existem (marcar, procurar profissional, ver horários livres) e que informação cada um pede. Nenhum texto, diálogo ou anotação foi copiado ou traduzido |

### Atribuição

- **Duckling**: Copyright (c) Facebook, Inc. e afiliadas (hoje Meta Platforms, Inc.). Licença
  BSD-3-Clause. <https://github.com/facebook/duckling> (arquivo
  `Duckling/Time/PT/Corpus.hs`).
- **Microsoft Recognizers-Text**: Copyright (c) Microsoft Corporation. Licença MIT.
  <https://github.com/microsoft/Recognizers-Text/tree/master/Specs/DateTime/Portuguese>.
- **Schema-Guided Dialogue (SGD / DSTC8)**: Google Research. Licença Creative Commons
  Attribution-ShareAlike 4.0 International (CC BY-SA 4.0).
  <https://github.com/google-research-datasets/dstc8-schema-guided-dialogue>.

### Regras de uso das fontes

1. Das três fontes públicas usamos só **padrões**, nunca texto. Os exemplos `pattern:*` são frases
   novas, de salão, em pt-BR informal, escritas para este projeto.
2. SGD é CC BY-SA 4.0: um conjunto de dados derivado dele teria de ser publicado com a mesma licença.
   Por isso o SGD só pode servir de modelo de organização. Não copie, traduza nem adapte frases,
   diálogos ou anotações do SGD (nem da tradução automática XSGD) para este banco.
3. Duckling (BSD-3-Clause) e Recognizers-Text (MIT) permitem uso comercial com crédito. Mesmo assim,
   o banco não copia frases deles, só a ideia da forma de falar.
4. Não usados: MASSIVE original (português de Portugal), MultiWOZ-PT (português de Portugal, sem
   licença), MetaLWOz (licença aparentemente só para pesquisa), MASSIVE pt-BR (adaptação por IA sem
   revisão humana).
5. Esta é uma leitura das licenças feita para o projeto, não um parecer jurídico.

## 3. Regra anti-contaminação

O banco de exemplos ensina; as baterias medem. Os dois precisam ser independentes, senão a medida
passa a dizer só que a Luna decorou as frases do teste.

1. Quem escreve ou revisa exemplos do banco **não lê** as baterias de avaliação:
   `packages/salon-secretary/evaluation/agenda-practice-*.json`,
   `docs/SECRETARY_GOLDEN_FREE_USE_30.md` e qualquer arquivo em
   `D:/Projetos/secretary-holdout-sealed`. Os autores e o revisor deste banco não leram esses arquivos.
2. Nenhuma frase das baterias, do Golden 30 ou dos holdouts entra no banco, nem literal nem
   parafraseada. O caminho inverso também é proibido: frases do banco não viram casos de teste.
3. Um exemplo novo segue as mesmas regras e declara seu `source`. Se uma frase de avaliação vazar
   para o banco, ela é removida e o vazamento é registrado.
4. A checagem de sobreposição entre banco e baterias (Jaccard de tokens ≥ 0,6 reprova) é automática no portão de validação
   (`packages/salon-secretary/src/examples/validate.ts`) e relata só o id do exemplo, o caso da bateria e a nota, nunca o
   texto da bateria. Quem corrige um exemplo reprovado reescreve a frase sem ler a bateria.
   Desde C7 (28/09/2026) a checagem também mede a **estrutura**: o mesmo Jaccard depois de mascarar nomes de pessoas,
   dígitos, números falados e dias da semana (`maskedTokens` da metodologia de avaliação), porque trocar o nome ou a hora
   não torna diferente uma frase copiada. Falas com menos de 5 tokens mascarados ("às 10", "com a <nome>") combinam
   com quase tudo e ficam só com o Jaccard simples (mesmo corte de moldura da metodologia). O limite continua 0,6.
5. Exemplos futuros vindos do uso real (pedidos que a Luna entendeu e o dono confirmou) só entram sem
   dados pessoais: nomes trocados por fictícios, sem telefone, e-mail ou texto de mensagem do cliente.
6. Nenhum exemplo nomeia uma pessoa das fixtures ou baterias de avaliação (clientes e profissionais declarados, com
   sobrenomes), na mensagem, na pergunta, nos resumos, nas opções ou nos valores (`EVALUATION_NAME`, só a contagem é
   relatada). Os arquivos selados ficam fora do repositório e nunca são lidos pelo portão.

## 4. Regras de segurança que todo exemplo respeita

- Todo `literal` é um trecho exato da mensagem, com as letras, acentos e maiúsculas que o usuário usou.
- Nenhum valor é inventado. Dia novo sem hora não ganha hora: a operação fica sem `time` e a
  Secretária pergunta. Hora de 1 a 7 sem "da tarde"/"da manhã" fica ambígua e é confirmada.
- O motivo de cancelamento só existe se o usuário disse; senão a Secretária pergunta. O motivo é o
  trecho literal, com a negação que houver ("ela nao pode mais").
- Apelidos, homônimos e nomes com erro de digitação de clientes são passados como escritos
  ("fabinho"). A Secretária pergunta ou sugere; nunca troca por um nome completo que não foi dito.
- Negação nunca vira ação afirmativa ("nao cancela a bia nao" não gera cancelamento).
- "Fechar/travar/bloquear a agenda de um profissional" é `schedule.block`. "Fechar o salão" ou mudar o
  expediente é `UNSUPPORTED` (`salon_hours`) e não vira bloqueio nem cancelamento.
- Desbloquear agenda e trocar o profissional de um agendamento não são suportados.
- Estoque é contado em unidades: "uma caixa" ou "2 pacotes" ficam com o literal da embalagem e a
  Secretária pergunta quantas unidades; nada é convertido.
- Mensagem para todas as clientes não é suportada; só mensagem individual, com confirmação.
- "sim" digitado não confirma nada; só o botão Confirmar autenticado executa.
- Nenhum ID, referência interna, telefone completo ou dado real.

## 5. Formato e convenções

Cada item tem `id`, `message`, `clock`, `state` (`NEW`, `ANSWER` com a pergunta pendente, ou `PLAN`
com as ações abertas), `expected` (`mode`, `operations`, `secretary_should`), `requires` opcional,
`tags` e `source`.

- Os nomes de operação e de campo são os do contrato publicado (`skill-registry.ts`,
  `scheduling-skill.ts`, `inventory-skill.ts`, `conversation-routing.ts`).
- Em estado `ANSWER` a ação pendente é sempre `item_key: "a"`. Com várias perguntas abertas ao mesmo tempo, o estado usa
  `questions: [{item_key, operation, requested_field, question}, ...]` (chaves a, b, ...) e a resposta curta corrige só o campo
  que ela responde.
- Datas trazem `components` (o significado: dia relativo, dia da semana, dia do mês, daqui N dias) e
  `legacy` (o seletor do wire atual). `legacy: null` quer dizer que a data ou a hora é ambígua e a
  Secretária pergunta.
- `requires` lista recursos que ainda não existem no wire atual: `components` (datas ambíguas, semana
  que vem, fim de bloqueio relativo), `same_as` ("no mesmo horário", "com ele"), `polarity`
  (`excluded`, negação e autocorreção) e `discard` (modo `DISCARD`). Um carregador que só suporte o
  wire atual deve ignorar os exemplos que dependem desses recursos. `discard` já existe no wire (B3): o modo
  `DISCARD` é publicado sempre que o plano ativo tem ações abertas e o exemplo é renderizado como
  `{mode:'DISCARD',item_keys:[...]}` (as chaves de `operations`); notação `examples-render-v3`.
- Extensões do formato, além do pedido original: `period` (manhã/tarde/noite), `selection` (escolha
  de um candidato publicado), `inventory`, `target_name`/`priceCents` como `{value, literal}` e
  `unavailable_capability` em todo `UNSUPPORTED`. Também `response` (a resposta curta do modo `CONVERSATION`, exigida pelo
  wire) e `source_scope` opcional por operação (a oração de um pedido composto; o renderizador a deriva quando ausente e
  `null` quer dizer nenhuma).
- `requires` também aceita `selection`: a escolha entre candidatos publicados. Existe no wire desde a B4: um item
  com cartão de opções aberto publica `choice={option_id,literal}`, com `option_id` limitado aos ids daquele cartão
  (`opt_1` = primeira opção). Esses exemplos só são elegíveis quando o estado atual tem um cartão aberto. O
  contexto do exemplo mostra as opções com o id (`opções: opt_1 Ana Souza | opt_2 Ana Paula Lima`), e a escolha é
  renderizada como `{item_key,choice:{option_id,literal},fields}`. Candidatos de uma pergunta temporal (manhã ou
  tarde, data) continuam valores de seletor e aparecem sem id. Notação `examples-render-v4`.
- Os limites dos literais de hora variam entre as partes ("10" e "as 10" aparecem). As duas formas são
  trechos exatos; o banco não impõe uma só.

## 6. Revisão e validação (28/09/2026)

Os três rascunhos foram unidos, revisados e validados:

- Duplicatas: `S021` removido (mesma mensagem de `R032`, Jaccard 1,00). `R053` e `R034` removidos por
  repetirem o mesmo modelo de `S066` e `S065`, mudando só o nome fictício ou a hora.
- Segurança: 19 `secretary_should` reescritos para "propõe/prepara", sem dar a entender execução;
  `S058` e `R044` deixaram de sugerir bloquear profissionais como substituto de fechar o salão;
  `S076` deixou de inventar "a partir das 18h"; `R041` passou a dizer que pergunta dia e hora da nova
  ação; `S004` trocou um nome que coincidia com pessoa pública.
- Contrato: `unavailable_capability` adicionado a 4 exemplos; o fim de bloqueio de `M039` passou para
  data absoluta (o wire não tem dia da semana de fim); `requires` de `M038` e `R013` corrigidos.
- Validação: `node .demo/agenda-core/check-bank.cjs` (validador local, fora do Git) confere formato,
  literais exatos, datas e horas contra o relógio fixo, nomes de operação e de campo lidos do código
  do contrato, e as regras de segurança acima. Resultado: 185 exemplos, 0 erros.
- Os rascunhos originais ficaram guardados em `.demo/agenda-core/examples-drafts/` (fora do Git).

## 7. Corpus de teste de componentes temporais (C1, 28/09/2026)

Arquivo: `src/test/fixtures/temporal-component-phrasings.json` (150 frases: 96 datas, 50 horários, 4
intervalos). Uso **exclusivo de teste unitário** da verificação de componentes temporais
(`src/lib/scheduling-temporal-reference.ts`, testado em `scheduling-temporal-reference.test.ts`):
cada frase com o componente esperado deve ser aceita, e o mesmo componente com um número trocado deve
ser recusado. Nenhum código de produção, prompt, instrução ou banco de exemplos (few-shot) carrega este
arquivo; ele também não entra nas baterias de avaliação.

| Coluna `source` | Fonte | Licença | O que foi reutilizado |
|---|---|---|---|
| `duckling` | Duckling, `Duckling/Time/PT/Corpus.hs` | BSD-3-Clause | Só o texto curto de expressões de data/hora do corpus português (ex.: "quarta da semana que vem", "meio dia e meia") |
| `recognizers` | Microsoft Recognizers-Text, `Specs/DateTime/Portuguese` (DateParser, TimeParser, TimePeriodParser) | MIT | Só o trecho extraído (`Text`) de cada caso, nunca a frase completa nem a resolução |

Os componentes e os valores esperados são **deste projeto**, calculados para a data de referência do
arquivo (segunda, 28/09/2026). Eles divergem das fontes onde as nossas regras divergem: ano omitido só
avança até cerca de meio ano (senão a data já passou e a Secretária pergunta), "que vem"/"próximo(a)"
que nomeiam dois dias diferentes viram pergunta de escolha, e hora de 1 a 7 sem manhã/tarde/noite é
confirmada. As frases foram lidas das páginas públicas dos dois repositórios, sem dependência npm e sem
cópia dos arquivos originais.

### Avisos de licença

**Duckling** — Copyright (c) Facebook, Inc. and its affiliates. BSD License:

> Redistribution and use in source and binary forms, with or without modification, are permitted
> provided that the following conditions are met: (1) Redistributions of source code must retain the
> above copyright notice, this list of conditions and the following disclaimer. (2) Redistributions in
> binary form must reproduce the above copyright notice, this list of conditions and the following
> disclaimer in the documentation and/or other materials provided with the distribution. (3) Neither
> the name Facebook nor the names of its contributors may be used to endorse or promote products
> derived from this software without specific prior written permission.
> THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR
> IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
> FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR
> CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
> DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
> DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
> CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE
> USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

**Microsoft Recognizers-Text** — Copyright (c) Microsoft Corporation. MIT License:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
> associated documentation files (the "Software"), to deal in the Software without restriction,
> including without limitation the rights to use, copy, modify, merge, publish, distribute,
> sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions: The above copyright notice and this
> permission notice shall be included in all copies or substantial portions of the Software.
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
> NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
> OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
> CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

A regra 3 da seção 2 (o banco de exemplos não copia frases) continua valendo para o banco few-shot;
este corpus é outro artefato, só de teste, e registra a origem de cada frase na coluna `source`.

## 8. Portão de validação e injeção (C2, 28/09/2026)

Código: `packages/salon-secretary/src/examples/`: `bank.ts` (formato e carregador), `render.ts` (conversão para o wire
ativo e notação compacta), `select.ts` (modos, seletor e orçamento) e `validate.ts` (portão; CLI
`npx tsx packages/salon-secretary/src/examples/validate.ts`). Testes: `secretary-example-bank.test.ts` e
`secretary-examples-injection.test.ts`.

**Portão.** Cada exemplo:

1. é convertido para o wire vivo ativo (seletores legados com `SALON_SECRETARY_TEMPORAL_COMPONENTS` desligada, `components`
   com ela ligada), completado com `null` pelo próprio esquema publicado e validado pelo esquema compilado
   (`z.fromJSONSchema`) e por `decodeConversationTurn` (que roda `validateSelectionV2`, `validateAddSelection` ou
   `validateExistingPlanPatches`), sem precisar de reparo de literal;
2. tem todo literal como trecho tolerante e único da mensagem;
3. passa o lint de segurança: nome como foi dito, hora só com número dito, motivo copiado, negação que governa a ação só com
   `polarity`, nenhum id; nome de pessoa **sem artigo** no início (`NAME_WITH_ARTICLE`: "a carla" é Carla); um pronome de
   tratamento dito fica ("dona cida"), porque a busca o usa mas não o exige (ver `docs/SECRETARY_NAMES_AND_VOICE.md`, C7);
4. tem Jaccard < 0,6 com toda mensagem das baterias de desenvolvimento e do Golden 30, simples e estrutural (nomes,
   dígitos e dias da semana mascarados, com pelo menos 5 tokens dos dois lados);
5. não nomeia pessoa das fixtures e baterias de avaliação (`EVALUATION_NAME`).

**Higiene C7 (28/09/2026).** O portão estrutural reprovou 17 exemplos cuja frase repetia a moldura de uma fala das
baterias de desenvolvimento (por exemplo "marca a <nome> amanhã às <hora> pra escova com a <nome>"). Eles foram
reescritos com a mesma lição, operações e valores, em outra construção: S001, S004, S005, S008, S009, S010, S013, S015,
S022, S023, S029, S050, S055, S084, M003, M027 e M056. Outros 25 usavam nomes das fixtures de avaliação (carla, joao,
rodrigo, amanda, fábio/fabinho, souza, lima, mendes) e ganharam nomes fictícios (celina, luiz felipe, heitor, noemi,
otávio/tavinho, barros, freitas, teles). O original está em
`.demo/agenda-core/contract-migration/examples-bank.before-c7/`. **Registro de desvio da regra 1:** o agente que fez
essa reescrita viu as falas das baterias de desenvolvimento (não os holdouts selados) na saída do portão enquanto
afastava as frases; as reescritas só reduziram a semelhança, e o portão (simples e estrutural) passa para os 205.

**Datas absolutas (revisão da fase 3a).** No wire legado, um dia que sairia como data absoluta calculada para o relógio
fictício (12/04/2027) nunca é servido: o modelo poderia copiar o mês/ano para um "dia N". Esses exemplos exigem
`components` (o backend calcula o dia); escolher um candidato publicado da pergunta continua valendo. Versão da notação:
`examples-render-v2`. O backend legado também só aceita, para "dia N" sem mês, o dia deste mês ou a próxima ocorrência.

O teste também aterra cada exemplo renderizado no backend real (`groundSchedulingTemporalTurn`): nenhum pode ensinar um dia
ou horário que o backend leria diferente. Onde o backend ainda pergunta, o exemplo continua correto e o caso fica listado na
saída do teste. Exemplos: "hj" e "3 da tarde" sem "às" na gramática legada; "quinze pras três" e "outra semana" nos
componentes.

**Correções exigidas pelo portão.**

- R007: minuto desconhecido não cabe no wire; agora é "umas 4 e meia", que a Secretária confirma.
- R010, R018, R024, R025, R026 e R056: reescritos por sobreposição com as baterias.
- M029: literais repetidos; agora "aninha" × "ana paula".
- M047: data repetida.
- M051: "dessa semana" é `THIS_WEEK`.
- S067: "da tarde" dito uma vez vale para o intervalo.
- S031 e R036: passam a exigir `polarity`, porque a negação governa a oração da data/hora para o backend.
- R024–R030: passam a exigir `selection`.
- Os cinco exemplos `CONVERSATION` ganharam `response`.

**Acréscimos.**

- S079–S085 e M056: a família "passa/joga/puxa/adianta/muda/remarca <cliente> pra <dia/hora>" é `appointment.change`.
  Evidência real: um pedido desse tipo virou `appointment.create`.
- R056–R062: duas perguntas abertas e uma resposta curta que responde só uma delas (`PATCH` só desse campo), inclusive uma
  palavra só como motivo. Evidência real: a resposta curta a duas pendências voltou `AMBIGUOUS`.
- R063–R067 (revisão 2b): contraexemplos do `DISCARD`. Um "não" sozinho diante da prévia é `AMBIGUOUS` (pergunta o que
  corrigir; R063, R064); "deixa" com dia ou profissional é correção `PATCH` (R065, R066); desistir e fazer um novo pedido na
  mesma mensagem é `NEW` (R067). Motivo: a seleção K=4 mostrava só `DISCARD` e `PATCH` para "Não." e para "deixa com a ...".

**Modos.** `SALON_SECRETARY_EXAMPLES` (padrão `off`; vazio, `false`, `0` e `off` em qualquer caixa também desligam, e só um
valor desconhecido recusa o turno com `INVALID_EXAMPLES_MODE`) e `SALON_SECRETARY_EXAMPLES_K` (padrão 4, de 1 a 8):

- `off`: o pedido é idêntico, byte a byte, ao de antes.
- `selected`: os K exemplos mais parecidos (BM25 sobre tokens dobrados, sem rede). Filtros: estado (sem plano → `NEW`;
  pergunta aberta → `ANSWER`; plano sem pergunta → `PLAN`/`ANSWER`), operações publicadas e recursos disponíveis. No
  máximo 2 por operação, desempate por id. Entram no contexto de sistema depois das linhas de equipe/hoje.
- `full`: todos os elegíveis em ordem de id, no fim das instruções (prefixo estável, bom para o cache do provedor). Turnos
  no mesmo estado compartilham o prefixo. Desde o G1, turnos do mesmo estado **no mesmo salão** (os nomes preenchidos
  dependem do salão, seção 10).

Os dois modos respeitam o teto (bytes do pedido + 8192 ≤ 64000): entra só o que cabe (em `full`, o maior prefixo por id).
A telemetria registra `examples_mode`, `examples_count`, `examples_bytes`, `examples_eligible` e os ids do banco. O
reparo de literal nunca leva exemplos. O hash do banco e o modo entram na versão do pedido do harness de prática.

**Tamanhos medidos** (notação compacta, bytes no corpo JSON):

| Medida | Wire legado | Wire com componentes |
|---|---|---|
| Banco inteiro renderizável | 141 exemplos, 43.202 bytes | 153 exemplos, 56.935 bytes |
| Só estado `NEW` / `ANSWER` / `PLAN` | 31.660 / 8.517 / 3.025 | 43.377 / 10.328 / 3.230 |

- `selected` típico: K=4 de 1,8 a 2,7 KB; K=8 de 3,4 a 4,6 KB.
- `full` no primeiro turno (pedido-base de 30,3 KB): 63 de 96 elegíveis (25,0 KB). Com uma pergunta aberta: 36 de 36
  (8,8 KB).
- Caso de estresse (10 ações ativas + 50 suspensas): cabem 7 (`selected`, K=8) ou 4 (`full`) no wire legado e nenhum com
  componentes, porque a margem ali é de 215 bytes.

## 9. Exportação para fine-tuning (sem treino)

O banco fica pronto para um ajuste supervisionado caso surjam um modelo treinável e orçamento. **Nada é treinado e nada vai
à rede**: `npx tsx packages/salon-secretary/evaluation/ft-export.ts` (`--seed`, `--out`, `--check`) lê `bank.json` (só
leitura) e grava `.demo/agenda-core/ft-export/<hash16 do banco>.jsonl` e `<hash16>.manifest.json`. Saída determinística:
mesmo banco, pools, contrato e semente dão os mesmos bytes.

**Formato.** Uma linha por exemplo, no formato de chat com ferramentas da OpenAI: `messages` = instruções de decisão
(system), contexto da conversa com diretório fictício e o relógio dos exemplos (system), rascunho (user), mensagem (user) e a
chamada da ferramenta com os argumentos esperados (assistant); `tools` = o schema publicado daquele estado;
`parallel_tool_calls: false`. Cada linha é o pedido **real** montado por `runServicesTurn` atrás de um `fetch` falso que
responde com os argumentos esperados, que ainda passam no parser ao vivo e no decodificador estrito. Perfil: V2 +
componentes + overlap, exemplos few-shot **desligados**. Estados `ANSWER` usam o pedido de continuação do plano.

**Elegibilidade** (taxonomia de falhas, §3): só estados `NEW`/`ANSWER`, saída esperada completa, nenhum recurso de
`requires` indisponível no wire atual, nada só fora de escopo (`UNSUPPORTED`) e sem quase-duplicados (Jaccard de tokens
≥ 0,6 com mesmo estado, modo e operações; fica o primeiro na ordem do banco). O manifesto traz contagens por transição,
operação, grupo, origem e tipo de salão, e cada id excluído com o motivo. Em 28/09/2026: 140 de 205 entradas; excluídas 25
`PLAN`, 11 `UNSUPPORTED`, 33 por `polarity`/`same_as` ainda indisponíveis e 2 quase-duplicadas (R003 ≈ S019, R059 ≈ R019).
Quando `polarity` e `same_as` forem publicados, uma nova exportação os inclui sem mudar o script.

**Anti-overfitting.** O treino nunca ensina nomes específicos. Na exportação, cada nome de pessoa (valores, mensagem,
pergunta, opções, resposta) é trocado com semente fixa, por entrada, por um nome do lado **DEV** dos pools multi-salão.
A troca preserva gênero, honorífico, caixa, acentuação e pares apelido/nome formal. Nunca entram nomes do lado holdout, das
fixtures, das baterias de desenvolvimento, do Golden 30 nem do próprio banco. O diretório fictício lista o profissional
citado pelo **nome completo** (mais distratores e, às vezes, um homônimo), com serviços apenas dos tipos de salão DEV. Assim
a linha ensina a copiar o nome como foi dito. Uma linha com qualquer nome original ou reservado é excluída (`NAME_LEAK`).
Diversidade atual: 125 valores de nome, 86 distintos, nenhum nome em mais de 5 linhas.

**Limites.** Todas as linhas usam o relógio fixo (segunda-feira, 12/04/2027). Respostas a uma pergunta só, em produção, vão
ao pedido do adaptador, não ao de continuação. `strict` fica fora do arquivo porque os argumentos já são o objeto estrito
completo. Refaça a exportação quando mudarem o banco, os pools, o contrato (instruções, wire, flags) ou a semente. Se um dia
houver treino, a medida continua sendo o holdout multi-salão e os holdouts selados, nunca estas linhas. Teste:
`src/lib/__tests__/secretary-ft-export.test.ts`, com banco e pools sintéticos.

## 10. Marcadores de nomes: o banco ensina estrutura, não nomes (G1, 28/09/2026)

O dono atende muitos salões, com muitos nomes e estilos. Um banco com nomes fixos ("tati", "celina", "bia" repetidos em
dezenas de exemplos) ensina nomes; o objetivo é ensinar a **estrutura** do pedido. Por isso todo nome de pessoa e todo
serviço dito virou marcador, preenchido só na hora de montar cada pedido à Luna.

**Formato** (`bank.ts`, `fill.ts`):

- Marcadores: `{cliente}`, `{cliente2}`..., `{profissional}`, `{profissional2}`..., `{servico}`, `{servico2}`, na mensagem, nos
  valores, nos literais, na pergunta pendente, nos resumos do plano, nas opções, na resposta e no `secretary_should`.
- A caixa da primeira letra é o estilo: `{cliente}` sai como se digita no celular (minúsculas, sem acento: "noemi");
  `{Cliente}` sai como o backend escreve ("Noemi"). Partes: `{x.nome}` e `{x.sobrenome}` de um nome completo; `{x.formal}` o
  nome formal de um apelido (ex.: a lista de profissionais "Keila, Rafaela ou Priscila" diante de "com a rafa").
- `slots` declara cada pessoa: gênero gramatical (`f`/`m`/`u`: artigos e pronomes concordam) e forma (`first`, `full`,
  `nickname`). Pronomes de tratamento ficam no texto ("dona {cliente}", "seu {cliente}"). Serviços não precisam de declaração.
- Continuam literais: produtos de estoque, os três cortes de R030 (a opção "o feminino" depende de "Corte feminino") e o erro
  de digitação de R031 ("progresiva", a lição é passar o serviço como escrito). M003 foi reescrito ("bota ... c/ a ... e sexta
  de 13h ate 15h fecha a agenda do ...") porque, com alguns serviços preenchidos, a frase antiga passava o corte de
  semelhança com a bateria de desenvolvimento; a reescrita seguiu a regra 4 da seção 3 (o autor viu só id e nota).
- A conversão foi feita com o detector de nomes da exportação (seção 9) e revisada entrada por entrada (papéis de nomes que só
  aparecem em resumos e perguntas, gêneros, apelidos). Originais: `.demo/agenda-core/contract-migration/examples-bank.before-g1/`.

**Preenchimento** (`exampleFills`/`fillExample`, chamado por `composeExamples`):

- Determinístico por semente + id do exemplo: o mesmo pedido mostra sempre os mesmos nomes; exemplos diferentes, nomes
  diferentes. Semente: `selected` = a mensagem; `full` = o salão (hash do diretório), para o bloco continuar um prefixo estável
  por salão (cache do provedor).
- Pessoas nunca repetem uma palavra da equipe do salão atual (o diretório que a Luna já vê), de outra pessoa do exemplo nem do
  texto fixo do exemplo; o gênero é respeitado (apelidos unissex servem aos dois).
- Serviços vêm do catálogo do salão atual quando ele publica um; sem diretório, de uma lista genérica (os serviços que o banco já
  usava: corte, escova, hidratação, coloração, luzes, progressiva, manicure, pedicure, barba, sobrancelha, pigmentação, unha em
  gel, corte masculino, mão e pé).
- Depois de preencher, todo literal continua um trecho único e exato da mensagem; se nenhuma tentativa (4, determinísticas)
  mantiver isso, o exemplo não é servido naquele pedido.

**Lista de nomes** (`packages/salon-secretary/src/examples/names.json`): 24 nomes femininos, 24 masculinos, 4 unissex, 20
apelidos e 24 sobrenomes, até 8 letras. É gerada, nunca editada à mão, por `packages/salon-secretary/evaluation/example-names.ts`
(teste: o arquivo é exatamente a saída do gerador): só o lado de desenvolvimento dos pools da avaliação, sem nomes-palavra
(data, serviço, vocativo...), sem nenhum token que apareça em qualquer nome do lado reservado ao holdout (pessoas, variantes,
apelidos e seus nomes formais, sobrenomes) e sem pessoas das fixtures, das baterias de desenvolvimento e do Golden 30. As
instâncias de desenvolvimento geradas usam o mesmo lado (treino) e não são excluídas, ou quase nenhum nome sobraria. O runtime
só **preenche** exemplos com a lista; nada a usa para reconhecer, validar ou resolver nomes.

**Portão.** Cada entrada com marcadores passa pela consistência (todo marcador declarado, todo `slot` usado, partes compatíveis
com a forma) e é validada **preenchida**, uma vez por variante: 3 sementes × sem salão / um salão sintético cuja equipe tem nomes
da lista e serviços longos (`GATE_DIRECTORY`). Todos os filtros anteriores (wire, literais, segurança, contaminação simples e
estrutural, `EVALUATION_NAME`) valem para cada variante. Resultado: 205 entradas, 0 problemas. O teste do G1 roda mais 3
sementes com um salão lotado de nomes da lista, confere determinismo, ausência de palavras da equipe e, com o detector de
nomes da avaliação, que nenhum nome ficou fora dos marcadores.

**Tamanho** (bytes no corpo JSON de todas as linhas renderizáveis; antes = nomes fixos):

| Wire / estado | Antes | Depois, sem salão | Depois, salão com serviços longos |
|---|---|---|---|
| legado NEW / ANSWER / PLAN | 28.810 / 10.650 / 4.814 | 28.893–29.017 / 10.672–10.700 / 4.823–4.847 | 29.867–29.930 / 10.696–10.740 / 4.842–4.887 |
| components NEW / ANSWER / PLAN | 43.394 / 12.665 / 5.457 | 43.436–43.594 / 12.688–12.715 / 5.460–5.491 | 44.531–44.652 / 12.711–12.755 / 5.488–5.531 |

Variação de +0,1% a +3,9%; o bloco continua limitado pelo teto do pedido. O teste fixa ≤ +2% sem salão e ≤ +5% com serviços
longos.

**Avaliação.** `exampleBankCorpus` passou a devolver as mensagens com o preenchimento canônico, os nomes que a lista pode mostrar
mais os nomes fixos de antes do G1 (`evaluation/example-bank-names-pre-g1.json`: as rodadas anteriores os viram, então continuam
fora das medições do holdout) e os serviços genéricos (`seenServiceNames`). O portão de sobreposição com os corpora multi-salão
mede as mensagens preenchidas. A exportação para fine-tuning preenche os marcadores (semente fixa por entrada) antes de trocar
os nomes pelos pools: 139 linhas (antes 140; uma entrada cai em `RENAME_NICKNAME_RELATION`), 124 valores de nome, 69 distintos,
no máximo 10 linhas por nome (a lista do G1 também fica reservada ali, o que reduz o pool de troca).

**Versão.** O hash do banco (e a etiqueta `examples:*`) inclui a lista de nomes e a notação passou a `examples-render-v5`; o
perfil de contrato com exemplos muda de versão e precisa da revalidação do coordenador antes de atualizar
`contract-version.json`.
