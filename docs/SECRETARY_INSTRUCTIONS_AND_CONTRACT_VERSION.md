# Secretária: qualidade das instruções, apêndice por estado e versão do contrato (C6)

28/09/2026. Recomendações 15 e 19 do relatório de arquitetura. Nenhuma chamada à Luna real; nenhum
banco. O objetivo, além de corrigir o texto, é liberar bytes da requisição (limite: bytes + 8192 ≤ 64000)
para as próximas mudanças de contrato (polaridade e `same_as`).

## 1. Lint das instruções compiladas

`src/test/secretary-instruction-lint.ts` compila a requisição real (serialização do SDK, transporte
falso) de 12 estados × 4 combinações de flags (`SALON_SECRETARY_TEMPORAL_COMPONENTS` e
`SALON_SECRETARY_JIT_INSTRUCTIONS`) e lê o texto de regra: instruções, frases do sistema, apêndice JIT,
instruções dentro de `requirements` e descrições do schema. Os dados (plano, diretório, hoje, rascunho)
não contam como regra. Teste: `src/lib/__tests__/secretary-instruction-lint.test.ts`.

Estados: primeiro turno; adapter isolado (CURRENT) com requisitos reais; adapter com plano ativo; plano
com ações abertas; plano só com ações concluídas; cartão de opções; ambiguidade de período; conflito de
calendário; descarte pendente; bloqueio de agenda; plano com suspensos; e o estado de estresse do
orçamento (10 ativas + 50 suspensas).

O que o lint acusa:

| Código | Regra |
|---|---|
| `DUPLICATE_RULE` | Duas frases com a mesma regra (Jaccard de tokens ≥ 0,55, ou uma ≥ 85% contida na outra). |
| `RULE_COUNT` | Regra registrada fora da contagem esperada: 1 no prompt estático; com JIT, 1 só nos estados que a publicam, 0 nos outros. |
| `UNPUBLISHED_REFERENCE` | Modo ou campo citado que o estado não publica (inclui `supported_fields` dos requisitos). Com JIT é por estado; sem JIT, vale o que algum estado com as mesmas flags publica (o prompt estático descreve todos). |
| `V1_PHRASE` | Frases do contrato V1 (`retorne operations=[]`, `disposition=`, `independent=true`...). |
| `CONTRADICTION` | Pares enumerados que não podem coexistir (ex.: `não calcule datas` com `date value YYYY-MM-DD`). |

### O que ele encontrou antes do C6 e a correção

| Achado | Onde | Correção |
|---|---|---|
| Um seletor de data por papel, papéis origem/destino/fim, literal completo, período sem relógio, exceção de período (`daypart`) e o exemplo `terça weekday=` estavam duas vezes | catálogo (`Agenda:`) e `temporalEvidenceInstructions`, em todo turno de decisão | O catálogo de decisão só mantém os formatos (`Seletores temporais: amanhã day_offset=…; date value YYYY-MM-DD; time value HH:mm.`). O V1 não muda. |
| "Remarcar" repetia o mapeamento origem/destino | catálogo | Fica só o exemplo "de amanhã às 10 para 11". |
| `appointment.change (remarcar) É SUPORTADO` repetia o catálogo | roteamento | Removido. |
| Regra de respostas curtas repetia a frase final do sistema | roteamento | Removida (a do sistema é histórica e fixada por teste). |
| Components: `não calcule datas` junto de `date value YYYY-MM-DD`/`weekday={value`, e `day_offset`, `source_day_offset`, `source_weekday` citados sem estarem no schema | catálogo e contrato temporal (só com a flag) | Com components, o catálogo não traz a cláusula de seletores e o contrato temporal usa `componentsTemporalInstructions` (sem o exemplo de weekday; papéis `date/time`). |
| `supported_fields` do adapter da agenda lista seletores que components não publica | `scheduling-contract.ts` (só com a flag) | Com components a lista traz `components` no lugar deles. |

Achado de medição (não de texto): as requisições reais de continuação passavam do limite, porque o teste
de orçamento media `fields {}` e `requirements {}`. A continuação multi-ação repete no rascunho todas as
ações que o contexto já publica e manda uma instrução de 600 bytes; a resposta ao adapter da agenda soma
o contexto do cartão e os requisitos. Ver a seção 4.

## 2. Apêndice por estado (`SALON_SECRETARY_JIT_INSTRUCTIONS=true`, padrão desligado)

Desligada, a requisição é o prompt estático (com as correções da seção 1). Ligada, só em turnos do
envelope de decisão:

- As instruções viram um prefixo estável por conjunto de flags (bom para cache do provedor): catálogo
  inteiro (os manuais de domínio ficam; tirá-los causou recusas antes), regras sem estado e o contrato
  temporal sem as exceções de pendência. Esse prefixo nunca cita ADD, PATCH, RESUME, DISCARD ou CURRENT.
- O sistema termina com `Regras do estado atual:` e só as regras que o estado publica, depois da frase
  "Os dados e a resposta anterior são contexto…":

| Regra | Quando entra |
|---|---|
| ADD e "criar no horário de um cancelamento do plano" | há plano ativo |
| PATCH e DISCARD (+ "alvo ambíguo: AMBIGUOUS" com 2+ ações abertas) | há ação aberta |
| `pending_discard` aceito | o backend perguntou um descarte |
| RESUME (+ "o plano ativo usa PATCH" com ação aberta) | há plano suspenso |
| Respostas curtas via `clarification` | alguma ação aberta (ou o rascunho do adapter) tem clarification |
| Delta do adapter isolado | CURRENT publicado |
| `choice={option_id,literal}` | cartão com opções |
| Exceção de período (`daypart`) | `pending_temporal_ambiguities` |
| Conflito de calendário (`calendar_reference`) | `WEEKDAY_DATE_CONFLICT` |
| Seletores antigos só para pendências; `DATE_CHOICE`; `stated_weekday` em components | components + pendência correspondente |

- Estreitamento do estado: a continuação multi-ação manda no rascunho só `item_keys` (o contexto do plano
  já traz cada ação completa) e não manda a instrução em `requirements`; o turno de roteamento também não.
  Os requisitos não repetem `supported_fields` (a lista é o próprio schema). A descrição do AMBIGUOUS só
  cita PATCH quando PATCH é publicado.
- Não foram movidas: as regras de intervalo/data do bloqueio (`das 10 às 11 do dia 28`, `end_date` só
  quando dito, horário ausente = null). Um bloqueio pode ser criado em qualquer turno NEW/ADD, então o
  estado anterior não diz quando elas valem; tirá-las do prefixo perderia o primeiro turno.

## 3. Versão do contrato (`secretaryContractVersion()`)

sha256 de: modelos de instrução (decisão, V1, manuais das Skills, sistema e rascunho com marcadores,
regras JIT, instruções de requisitos, cabeçalho e banco de exemplos quando ligados), schemas compilados
sob um contexto canônico fixo (plano com todas as operações, cartão, pendências, descarte e um suspenso;
mais primeiro turno, adapter CURRENT e V1), id do modelo, limite de saída e flags de contrato
(components, JIT, exemplos, multi-action V2, overlap). Dados do turno nunca entram.

- Telemetria: `outcome.contract_version` na linha `SECRETARY_ROUTER` (só hex de 64).
- Relatórios: `contractVersion` no cabeçalho de cada cenário e no `report.json` da prática (o pass^k o
  expõe), e no `results.json` da Golden (run e tentativas).
- Arquivo: `packages/salon-secretary/contract-version.json`, com a versão e o hash de cada parte
  (templates, wires, runtime) dos perfis `v2`, `v2+components`, `v2+jit`, `v2+components+jit` e
  `v2+components+jit+examples-selected`. O teste `secretary-contract-version.test.ts` falha dizendo o
  perfil e a parte que mudou. Só o coordenador atualiza, depois das baterias:

```
node scripts/secretary-contract-version.cjs            # versões atuais e a diferença
node scripts/secretary-contract-version.cjs --check    # sai com 1 se mudou
node scripts/secretary-contract-version.cjs --write    # coordenador, depois da Golden e da prática
```

O arquivo foi gravado no C6 com as versões novas, **ainda sem baterias**.

Limite: a versão cobre o que chega ao modelo como texto e schema. Mudança de lógica do backend que monta
dados (contexto do plano, requisitos) não muda a versão; para isso existe a ficha do candidato.

**Revisão (28/09): textos do backend.** O backend também escreve texto que a Luna lê como dado: rótulos das
perguntas (`temporalFieldLabels`, "Informe …"), prévias das propostas (o `previous_response` de cada ação), a linha
"Use Confirmar para executar.", a leitura adiada, o lote bloqueado, as perguntas da mensagem e a proposta expirada.
`src/lib/secretary-presentation-contract.ts` monta esses modelos com entradas sintéticas fixas e gera um sha256
(dígitos e dia da semana mascarados, espaços normalizados: o ano, o calendário e o ICU não mudam o valor). Ele entra
como parte `presentation` de `secretaryContractParts` em todo lugar que registra a versão (telemetria do roteador,
prática, Golden, exportação de fine-tuning e `contract-version-profiles`). Consequência: as cinco versões
registradas em `contract-version.json` divergem agora só na parte `presentation`. O coordenador roda a Golden 30 e
os braços da prática com as flags desligadas e então grava as versões novas (`--write`). A cobertura é a lista acima;
outro texto do backend que chegue ao modelo precisa entrar em `backendPresentationTexts`.

## 4. Bytes

Corpo da requisição + 8192, limite 64000. "Antes" = depois do C7.

| Medição | Antes | JIT desligado | JIT ligado |
|---|---|---|---|
| Pior caso dos testes de orçamento (components, diretório 8+24, 10 ativas + 50 suspensas) | 63960 (margem 40) | 63048 (margem 952) | 62018 (margem 1982) |
| O mesmo sem components (com diretório) | 63282 | 62437 | 61611 |
| `secretary-capability-wire` (sem diretório) | 61835 | 60990 | — |
| Residual com 3 conflitos (teto free-use), sem / com components | 60533 / 61384 | 59688 / 60472 | — |
| Real: continuação multi-ação, components | 66954 (**acima**) | 66042 (**acima**) | 62179 (margem 1821) |
| Real: resposta ao adapter da agenda, components | 64707 (**acima**) | 63687 (margem 313) | 62464 (margem 1536) |
| Real, sem components: continuação / adapter | 66276 / 64029 | 65431 / 63129 | 61772 / 62057 |

Com JIT desligado, a continuação multi-ação real continua acima do limite (é pré-existente). Com JIT
ligado, todas as formas medidas ficam abaixo; a menor margem é 1536 bytes. Para as próximas features,
medir com JIT ligado e com as formas reais do teste `secretary-instruction-lint.test.ts`.

## 5. C4 polaridade (flag `SALON_SECRETARY_TEMPORAL_POLARITY`)

Com a flag ligada o wire publica `excluded` e usa a compactação por cópias emitidas, que paga esses bytes
(cerca de 1950 bytes a menos em toda forma medida). A flag só entra na versão quando ligada; os perfis
registrados não mudam. Detalhes e medições: `docs/SECRETARY_TEMPORAL_POLARITY.md`.

## 6. C5 referências entre ações (flag `SALON_SECRETARY_SAME_AS`)

Com a flag ligada o wire publica `same_as` nas operações NEW/ADD que podem seguir o valor de outra ação (a regra
fica na descrição do campo) e usa a mesma compactação por cópias emitidas, que paga esses bytes (1860 a 1956 bytes
a menos em toda forma medida; com a polaridade também ligada, cerca de 810 bytes a mais que só a polaridade). A
flag só entra na versão quando ligada; os perfis registrados não mudam. Detalhes, a decisão de V27 e as medições:
`docs/SECRETARY_SAME_AS.md`.

## 7. B7 contexto estruturado (flag `SALON_SECRETARY_STRUCTURED_CONTEXT`)

Com a flag ligada, `clarification` troca o texto da tela (`previous_response`) por um `question_code`
(`FIELD`, `FIELDS`, `OPTION`, `DAYPART`, `CALENDAR`) e uma frase curta e estável ("Pedi o horário."), sem nomes,
datas ou horários. Não há campo novo no wire nem texto novo nas instruções: só os dados do contexto mudam. A flag
entra na versão (`structuredContext:true`) só quando ligada; os perfis registrados não mudam. Detalhes e medições:
`docs/SECRETARY_B7_PRESENTATION_AND_FEEDBACK.md`.

## 8. Orçamento da requisição: montagem com degradação (28/09/2026)

Evidência real: requisições gravadas chegaram a 55.012 bytes com exemplos `full` (p90 54.903), contra o teto de
requisição + 8192 ≤ 64000; nos testes de orçamento, a continuação multiação (65.431/66.042) e a mistura realista (até
74.220) passavam do teto na configuração padrão. O teto não mudou e o guarda de custo continua igual.

`runServicesTurn` (`packages/salon-secretary/src/index.ts`, `request-budget.ts`) mede o corpo **exato** que o SDK envia
(`secretaryRequestBodyBytes`: mesmas chaves e valores; o id do modelo é lido do modelo do provedor e, se desconhecido, usa o
maior id permitido). O teste confere byte a byte contra o corpo real em todos os estados e flags do lint. Se a requisição
configurada cabe, ela é enviada exatamente como antes: nenhum passo é calculado e nada é registrado (evidência: 124 de 128
corpos de referência, estados do lint × flags × contexto estruturado, iguais byte a byte antes e depois; os 4 diferentes são
as continuações que passavam do teto). Se não cabe, degrada nesta ordem fixa, cada passo só quando se aplica e só enquanto
continua acima do teto:

1. `EXAMPLES_DROPPED`: tira o bloco de exemplos few-shot (o modo configurado pedia um);
2. `STRUCTURED_CONTEXT` e/ou `JIT_APPENDIX`: converte as clarificações em prosa para a forma estruturada do B7 (mesmo
   resultado que a flag produziria; a redação vive em `structured-context.ts`, fonte única) e troca o prompt estático pelo
   JIT desta requisição (instruções, wire, rascunho de continuação só com as chaves e requisitos sem a instrução de
   continuação, exatamente como a flag os constrói);
3. `SUSPENDED_TRIMMED`: cada plano suspenso fica só com `plan_ref` e, por ação, `item_key`, `operation` e `status` (o que a
   rota e a validação do RESUME leem).

Se ainda não coube, a requisição é recusada antes do transporte com `SECRETARY_REQUEST_TOO_LARGE`, marcada como falha de
leitura (B5): com plano ativo, o plano fica intacto (nenhuma ação falha nem perde a proposta; a ação endereçada, se houver,
volta para revisão como em toda resposta não lida) e a resposta é "Esse pedido ficou grande demais para eu processar de uma
vez; pode dividir em partes?". Sem plano, a Server Action mostra o mesmo texto. As conversões mudam só o texto enviado; o
contexto de decodificação continua o completo.

Medidas (bytes + 8192; diretório 8+24; configurado → enviado):

| Forma | legado, padrão | components, padrão | passos |
|---|---|---|---|
| Continuação multiação | 65.431 → 60.632 | 66.042 → 61.039 | estruturado + JIT |
| Mistura realista (ativas perguntam, suspensas preparadas), stress / resposta ao adapter | 73.671 → 62.953 / 74.363 → 63.422 | 74.281 → 63.359 / 74.920 → 63.828 | estruturado + JIT |
| Toda ação pergunta, stress / adapter | 67.846 → 56.103 / 68.538 → 56.572 | 68.456 → 56.509 / 69.095 → 56.978 | + suspensos aparados |

Com JIT e contexto estruturado ligados (candidato de produção) nada muda nas formas que já cabiam; "toda ação pergunta"
(até 67.528) passa a caber aparando os suspensos. Telemetria (códigos e contagens): `outcome.request_budget = {requests,
rejected, steps, initial_bytes, final_bytes}` na linha `SECRETARY_ROUTER`, presente só quando algum pedido da mensagem não
coube como configurado. A degradação não muda a versão **configurada** (os perfis registrados e a versão de cada mensagem
que coube continuam iguais), mas a mensagem cujo pedido foi reescrito ou recusado registra a **sua** versão:
`secretaryContractVersion({..., requestBudget: passos})` inclui os passos (na ordem fixa) nas flags do contrato, então
`outcome.contract_version`, o `lastOutcome` do feedback e as baterias distinguem um pedido reescrito do configurado. A prática
já grava a linha do router de cada turno; a Golden grava `requestBudget = {steps, rejected, contractVersion}` no turno (só
quando houve degradação; os demais turnos mantêm o formato histórico). Vale mesmo com todas as flags desligadas: um pedido
que antes era enviado acima do teto agora é reescrito ou recusado. **Pendente (coordenador):** medir com a Luna real as
variantes reescritas (estruturado + JIT, suspensos aparados) antes de depender delas em Produção. Testes:
`secretary-request-budget.test.ts` (limites exatos de cada passo, conteúdo de cada nível, formas de produção, telemetria) e
`secretary-request-budget-runtime.test.ts` (plano preservado pelo orquestrador, versão própria do turno reescrito, registro
da Golden).
