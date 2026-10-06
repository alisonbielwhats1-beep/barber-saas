# Secretária — checkpoint da Agenda (27/09/2026)

Continuação do trabalho do Astra (worktree `service-create-mvp`, branch
`codex/secretary-conversation-stabilization`, base `9b92138` + 435 alterações).
O estado exato foi copiado para este worktree
(`.claude/worktrees/secretary-mobile-investigation-8658bb`, branch
`claude/secretary-mobile-investigation-8658bb`, mesma base `9b92138`) porque a
sessão não podia editar o worktree original. O `service-create-mvp` ficou intacto.

Escopo desta etapa: **Agenda funcionando na prática** (criar, remarcar, cancelar,
profissional, disponibilidade, bloqueio, conflitos/encaixe/HARD_BLOCK, multi-turn e
multi-ação). Estoque, Financeiro e Comunicação ficaram em segundo plano.
Nada em Production, nenhum deploy, nenhuma migration, nenhum efeito externo real.

## Arquitetura mantida

Luna interpreta linguagem e intenção; o backend resolve entidades, disponibilidade,
duração, conflitos, permissões e executa só após confirmação autenticada.
Não houve reescrita: as mudanças são correções estruturais pontuais sobre o
contrato existente (ActionPlan V2, drafts, prova literal por papel, journal).

## Causas encontradas e correções

| # | Sintoma real (Luna real, banco local) | Causa | Correção |
|---|---|---|---|
| 1 | "Cancela o João das 14h, ele não vai poder vir" perdia o horário; "Passa para 11h, não 10h" idem | Guarda de negação global: qualquer "não" na frase rejeitava toda data/hora de mutação | Negação passa a valer só na oração do literal (`temporalLiteralNegated`); leituras mantêm a regra de negação colada ao literal. Recusa real ("Não marca a Amanda amanhã às 10h") continua rejeitada |
| 2 | V216/V217 do holdout V2 | Mesma causa (negação em outra frase/oração) | Resolvidos pela correção 1, sem prova sintética e sem alterar o expected (`consumed-replay` passa) |
| 3 | 80 testes quebrados | Integração em andamento do campo `temporal_negative_context` no wire do SDK (migração incompleta de fixtures) | Publicação no SDK revertida para os arquivos anteriores preservados pelo Astra; caminho de prova do backend mantido dormente e tipado localmente. Evidência em `.demo/agenda-core/reverted-negative-context-sdk/` |
| 4 | Passo 1: 31/32 adversariais | Frame temporal vinculava só os campos do item do batch, não o grafo | Frame compara também o plano inteiro (`sameGraph`) → 32/32 |
| 5 | "Cancela Amanda e coloca Fábio no lugar" falhava sempre com a flag de encaixe desligada | `SAME_RELEASED_SLOT`/`override_requested:false` (valores neutros) eram tratados como exceção de encaixe | Valores neutros não exigem a capacidade de encaixe; exceções reais continuam recusadas com a flag desligada |
| 6 | "No lugar" perguntava "Qual profissional?" | O batch só aceita o mesmo profissional do horário liberado, mas perguntava | Padrão = profissional do horário cancelado quando nenhum foi dito |
| 7 | "Cancela o João" → (turno seguinte) "Coloca o Fábio no lugar" dava `INVALID_DEPENDENCY_GRAPH` | ADD validava a nova ação isolada; não podia referenciar o cancelamento do plano ativo | `validateAddSelection` aceita exatamente um `appointment.create` com `released_slot_of` de um cancelamento do plano ativo; backend promove o cancelamento pendente ao par atômico cancelar→criar, ou, se já confirmado, cria no horário liberado a partir do recibo |
| 8 | "Qual horário a Tatiana tem amanhã?" classificava Tatiana como cliente | Luna não sabia quem é equipe | Contexto com nomes da equipe e serviços ativos (sem clientes, sem IDs) e a data de hoje do salão |
| 9 | "Amanhã." respondendo "Para qual dia?" gerava laço (data absoluta alucinada 2025-04-11) | Luna não sabia a data de hoje | Data de hoje no contexto + orientação `day_offset` para hoje/amanhã |
| 10 | Resposta truncada no meio do JSON (`MODEL_REQUEST_FAILED`) | Limite padrão V2 de 1.200 tokens de saída (raciocínio consome o mesmo orçamento); baterias validadas usavam 8.192 | Padrão V2 = 8.192 (só tokens gerados são cobrados; admissão de 64k preservada) |
| 11 | No modo de decisão V2 a Luna não recebia as regras completas de evidência temporal | Correção "SDK global" do Astra deixou `temporalEvidenceInstructions` de fora | Regras temporais completas incluídas uma vez nas instruções globais |
| 12 | ~~"Muda ela para amanhã" perguntava o horário~~ | — | **Descartada.** Herdar o horário quando só o dia muda gerou proposta confirmável com horário não dito (Golden v15 GF14, falha de segurança). Revertido ao comportamento original: "passa para 11h" mantém o dia; "muda para sexta" pergunta o horário (SAFE_CLARIFICATION) |
| 13 | "Marca a Amanda e a Carla às 10h" (única profissional) gerava duas propostas no mesmo horário | Disponibilidade de cada ação só vê a agenda gravada | Sobreposição dentro do mesmo pedido: a ação posterior vira pergunta de horário, sem CTA |
| 14 | Pedido composto: "sexta" da Carla fazia o Fábio "perder" uma data | Cláusula de destino ia até o fim da frase | Literais temporais de ações irmãs são mascarados (mesmo comprimento) antes do aterramento de cada ação |
| 15 | Conflito/HARD_BLOCK respondia "há um conflito a revisar" | Apresentação escondia causa e alternativas | Mensagens com causa real (salão fechado, fora do expediente, já existe atendimento) e horários livres; com a flag desligada, conflito vira pergunta de horário |
| 16 | Perguntas secas ("Pode informar motivo?") e consultas com horário cru | Redação genérica | "Qual o motivo do cancelamento?", "Para qual dia é o bloqueio?", "Para qual dia e horário devo passar o Fábio?", "Horários livres de Tatiana para Escova em 28/09: 09h, 09h15…", agenda do dia em lista legível |
| 17 | Golden v15 GF10: "O Corte Longo." (escolha entre serviços) → "não foi possível preparar este item" | Import dinâmico `await import("./scheduling-catalog")` adicionado ao validador de menções **depois** da Golden v14 (herdado do estado do Astra); falha no runtime `tsx/cjs` das baterias (`ERR_MODULE_NOT_FOUND`) | Import estático; o teste unitário do validador passou a mockar o catálogo (sem mudar asserções; original em `.demo/agenda-core/contract-migration/`) |
| 18 | Golden v15 GF13: "O das 14h." (escolha entre agendamentos) → "Pode informar data original?" | A Luna copia a data da opção escolhida para `source_date` com literal que não a comprova. A/B com a Luna real no mesmo pedido: 6/8 com o contexto atual, 2/8 sem diretório/data, 6/8 sem diretório e sem as regras temporais globais (≈ configuração da v14) — tendência antiga; a v14 passou por amostragem | Numa escolha entre agendamentos **publicados**, a coordenada não comprovada nunca vira evidência: é descartada só se as coordenadas comprovadas já selecionam exatamente uma opção e essa opção concorda com ela. Divergência, empate ou nada comprovado → continua perguntando (4 testes PG novos) |
| 19 | Golden v16 GF24: "na terça, dia 14 de abril de 2027" → turno inteiro recusado (`TEMPORAL_SELECTOR_CONFLICT`, resposta vazia) | A Luna divide uma única referência de calendário em `date` + `weekday` com literais separados. A/B com a Luna real: 4/8 com o contexto atual, 4/8 sem a orientação de seletor, 5/8 sem diretório/data — tendência antiga; a v14 passou por amostragem | O transporte recebe a mensagem atual e junta **só** data explícita + dia da semana cujos literais são exatos, únicos e contíguos (espaço, vírgula, parêntese ou "dia"), ou um contém o outro; mantém a data e o literal passa a ser o trecho exato da mensagem. O backend compara data × dia da semana e pergunta qual vale (caminho de conflito de calendário já existente). Separados, repetidos, relativos ou sem mensagem → continua recusado |

Testes permanentes novos: `scheduling-temporal-negation-scope.test.ts` (15),
`secretary-agenda-core.test.ts` (28) e `secretary-option-echo.integration.test.ts`
(4, PostgreSQL). O teste unitário do validador de menções passou a mockar o
catálogo (import estático, #17). Asserções antigas que afirmavam o
comportamento substituído foram migradas com o original preservado em
`.demo/agenda-core/contract-migration/` (negação cross-clause, exceção neutra,
redação de duas mensagens). O arquivo de fontes históricas recebeu o original
exato de `conversational-presentation.ts` (hash conferido contra o manifesto
Topic14). Nenhum oráculo da Golden/holdout foi alterado.

## Resultado final

### Estado da Agenda

| Capacidade | Resultado | Evidência (Luna real) |
|---|---|---|
| Criar | PASS | A01, A12–A14, B03, B04, C01, C11, C12; Golden GF08–GF10, GF25, GF26 |
| Remarcar | PASS | A01, A02, B06, B13, C02; Golden GF11–GF16 |
| Cancelar | PASS | A03, B07, C03; Golden GF17, GF18 |
| Profissional (escolha, correção, atribuição única) | PASS | A13, C01, C12, A01 |
| Disponibilidade / agenda do dia | PASS | B01, B02, B12, C04, A05; Golden GF20, GF21 |
| Bloqueio | PASS | A06, B09, C05 |
| Multi-turn | PASS | A06, A07, A09, A12, A15, B08; Golden GF02, GF09, GF13, GF14 |
| Multi-ação Agenda | PASS com 1 pendência | A04, A07, A08, A09, B08, B11, C09 PASS; C06 ("no mesmo dia") pergunta o dia com segurança |
| Conflitos / encaixe / HARD_BLOCK | PASS | A10, A11, B05, B11, B13, C07; Golden GF22–GF24 |

### Bateria prática final (Luna real, 40 cenários, código final)

- Oráculo de estado final: **39/40** (A 15/15, B 13/13, C 11/12).
- Revisão semântica turno a turno: 38/40 concluídos corretamente; C06 fez a pergunta
  segura correta mas o cenário não tinha resposta programada; C08 (Comunicação,
  secundário) não conclui a sugestão de texto. **0 comportamentos inseguros**
  (nenhuma data/horário/entidade inventada, nenhuma mutação sem Confirmar).
- ANTES (baseline1, antes das correções): 10/14 no oráculo, ~8/14 semântico.
- Latência por turno ANTES → DEPOIS: média 3,9 s → 3,9 s; p50 3,3 s → 3,6 s;
  p90 6,5 s → 6,0 s. Tokens por chamada: entrada 5.761 → 6.051 (+5%, diretório e
  data), saída 313 → 323; 60% da entrada em cache.

### Golden 30 (oráculo congelado, sem alteração)

| Rodada | Resultado | Observação |
|---|---|---|
| v14 (Astra, antes desta etapa) | 30/30 | referência |
| v15 (primeira com as mudanças) | parou em SAFETY_FAILURE: 11/14 | GF10 (#17), GF13 (#18), GF14 (#12, falha de segurança) — todas corrigidas |
| v16 | 29/30, 0 falhas de segurança | GF24 (#19) — corrigida |
| v17 (código final) | **30/30**, 0 falhas de segurança, 0 perguntas desnecessárias, 9 esclarecimentos corretos, 0 efeitos/escritas | mesmas métricas da v14 |

Replay offline (sem rede) das saídas reais gravadas da Luna no código final:
v14 → 30/30 e v16 → 30/30 pelo mesmo avaliador da Golden
(`.demo/agenda-core/golden-replay-all.ts`).

### Teste real pela interface (local)

Login na tela `/login` com a conta sintética local → Secretária → "Marca a Carla
amanhã às 11h com a Tatiana para Escova." → conflito com a Rosa explicado e
alternativas reais → "Então às 14h." → proposta → **Confirmar** → "Concluído" e
agendamento gravado no banco local (Carla 28/09 14h, CONFIRMED). O primeiro login
falhou porque o papel restrito do banco local não tem UPDATE em `User`; o script
de preparação agora grava `passwordSetAt` pelo papel admin. Evidência:
`.demo/agenda-core/ui-smoke-2026-09-27.md`.

### Gates

- `npm test` (sem integração, como o projeto define): 364/364 arquivos, 4524/4524.
  O arquivo `hard-conversations-durable.test.ts` estoura 5 s sob carga paralela
  (processos-filho, pré-existente) em algumas rodadas; isolado passa 18/18.
- `npm run typecheck` e `npm run lint` globais: exit 0.
- Regressão PostgreSQL de domínio (runtime sem SUPERUSER/BYPASSRLS, rede proibida,
  backup antes/depois): 12 arquivos, 185/185 (inclui os 4 testes novos de eco de opção).
- E2E de execução (PostgreSQL, modelo roteirizado, sem rede): 20/20, linhas legadas
  preservadas, 0 chamadas externas. A execução pelo lançador padrão (limite de 30 s
  por teste) estourou o tempo no caso 3 sem falha de asserção: cada etapa faz hash de
  tabelas inteiras e o banco descartável cresceu com as baterias do dia (todos os
  casos ~30% mais lentos que às 16h27). O STOP foi revisado e arquivado
  (`STOP-reviewed-2026-09-27T17-27-16-906Z.json`) e o mesmo arquivo passou com limite
  de 120 s (`.demo/agenda-core/run-execution-e2e-long.cjs`, evidência
  `execution-e2e/2026-09-27T17-30-44-276Z`).
- Adversariais do frame temporal: 32/32.

## Arquitetura final, Luna, Skills e Tools

- Arquitetura mantida (P1–P5): Luna é autoridade semântica; o backend é autoridade
  factual/operacional (entidades, prova literal por papel, disponibilidade, conflitos,
  permissões, RLS, confirmação, idempotência). Nenhuma reescrita.
- Luna: `gpt-6-luna`, uma chamada por turno + reparo literal restrito (inalterado),
  `max_output_tokens` V2 padrão 8.192 (antes 1.200; a Golden já usava 8.192),
  `store=false`, sem ferramentas hospedadas, esforço de raciocínio inalterado.
- Contexto por turno: plano ativo/suspensos (inalterado) + nomes da equipe (≤40) e
  serviços ativos (≤80), sem clientes nem IDs + data de hoje do salão com dia da semana.
- Envelope V2: `ADD` aceita exatamente um `appointment.create` com `released_slot_of`
  apontando para um cancelamento do plano ativo; nada mais pode referenciar ações
  externas.
- Skill de Agenda: instrução "no lugar/na vaga/no horário dele = SAME_RELEASED_SLOT".
- Transporte temporal: literal idêntico para dois seletores do mesmo papel é aceito;
  data explícita + dia da semana contíguos na mensagem viram um literal exato (#19);
  qualquer outro par diferente continua recusado.
- Backend: negação por oração (#1), exceções neutras (#5), profissional do horário
  liberado (#6), promoção cancelar→criar (#7), conflito dentro do mesmo pedido (#13),
  mascaramento de literais irmãos (#14), eco de opção (#18), mensagens com causa (#15/#16).

## Alternativas testadas e descartadas

1. Publicar `temporal_negative_context` no wire do SDK (trabalho em andamento do
   Astra): 80 testes quebrados; revertido. Escopo de negação resolvido no backend (#1).
2. Herdar o horário quando só o dia muda (#12): falha de segurança na Golden (GF14);
   revertido.
3. Descartar qualquer coordenada de origem não comprovada: risco de entidade errada;
   substituído pela regra restrita de eco de opção (#18).
4. Retirar diretório/data do contexto: A/B com a Luna real não mostrou efeito sobre os
   desvios de GF13/GF24; mantidos porque corrigem #8 e #9.
5. Tratar "no mesmo horário"/"no mesmo dia" por frase: proibido (patch por frase);
   fica como pergunta segura e lacuna de contrato.
6. Remover o zero à esquerda dos horários ("09h"): mantido "09h", convenção existente.

## Pendências e regressões

Regressões abertas: nenhuma. As encontradas nesta etapa (Golden v15 GF10/GF13/GF14,
v16 GF24) foram corrigidas e cobertas por testes.

Agenda (próximas melhorias, todas hoje com comportamento seguro):
- "no mesmo horário" / "no mesmo dia" (manter coordenada ou anáfora entre ações):
  a Secretária pergunta. Futuro: sinal estruturado no contrato (ex.: manter horário
  do original, "mesmo dia da ação X"), nunca por frase.
- Primeira pergunta de pedido composto com vários campos ainda genérica
  ("Pode informar data e horário final?", A08).
- Encaixe recusado de antemão (C07): resposta começa por "Tenho 10h30…" sem dizer
  que o horário pedido está ocupado.
- Outros pares de seletores (ex.: "amanhã, terça") ainda recusam o turno inteiro.
- Caminho dormente `temporal_negative_context` no backend: candidato a limpeza.
- Memória de sessão da Secretária é do processo (pré-existente).

Secundárias isoladas (não bloqueiam a Agenda):
- Comunicação (C08): "peça uma sugestão" não gera texto e a pergunta se repete
  (a duplicação na lista foi corrigida; o laço continua).
- "Não, deixa" (C10) responde certo, mas o plano fica suspenso sem modo DISCARD.
- Estoque/Financeiro: só cobertos pela Golden (GF27–GF29 PASS); sem bateria própria.

## Custo

Autorização desta etapa: US$ 7 adicionais (journal próprio
`packages/salon-secretary/evaluation/results/agenda-core/stage-budget.jsonl`).

| Uso | Chamadas | Reservado (teto) | Gasto real estimado |
|---|---|---|---|
| Prática com Luna real (15 rodadas, 40 cenários na final) + A/B GF13 e GF24 | 346 | US$ 2,78 | ≤ US$ 0,26 (≈ US$ 0,15 com cache) |
| Golden v15 + v16 + v17 (journal da missão anterior, teto US$ 5) | 109 | US$ 1,01 (missão: US$ 4,77 de 5) | ≈ US$ 0,08 |
| Teste de UI local | 2 | — | < US$ 0,002 |

Total real desta etapa: **≈ US$ 0,25–0,35**, muito abaixo dos US$ 7 autorizados.
Tokens por chamada (prática final): ~6.050 de entrada (60% em cache) e ~320 de saída.
Nenhuma chamada fora de `api.openai.com/v1/responses`; nenhum WhatsApp, pagamento,
deploy ou acesso a Production.

## Como testar a Secretária de Agenda (local)

Pré-requisito: o PostgreSQL descartável em `127.0.0.1:55441`
(`%TEMP%\everflair-service-mvp-dumpcheck-20260924-uxbaseline\data`). Se estiver
parado, inicie com o caminho longo da pasta:

```powershell
& "C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe" -D "$env:LOCALAPPDATA\Temp\everflair-service-mvp-dumpcheck-20260924-uxbaseline\data" -o "-p 55441 -h 127.0.0.1" -w start
```

1. Criar um salão sintético novo com agenda relativa a amanhã (gera login só no
   arquivo `.demo/agenda-core/LOCAL-LOGIN.txt`, ignorado pelo Git):
   `node scripts/setup-agenda-manual-test.cjs`
   O mesmo comando cria (idempotente) o papel local `local_app_runtime`, com os
   privilégios de tabela do `app_runtime` de produção (derivados duas vezes dos SQL
   do repositório, com concordância total), sem SUPERUSER/BYPASSRLS e com RLS valendo.
   Tabelas que em produção têm RLS mas no banco local não têm ficam sem acesso. O
   papel restrito `mvp_service_runtime` dos testes de segurança não é alterado. Provas
   de isolamento: `node .demo/agenda-core/probe-local-app-role.cjs` (16/16).
2. Subir o app com a Secretária ligada só nesse processo:
   `node scripts/dev-agenda-test.cjs` (porta 3157) — ou, no app, a configuração
   `agenda-test` do `.claude/launch.json`.
3. Abrir `http://localhost:3157/login`, entrar com o login do arquivo e usar o botão
   da Secretária (ou `/servicos/secretaria`).
4. Frases para testar (e o que esperar):
   - "Marca a Amanda amanhã às 10h para Corte Completo" → pergunta a profissional
     (Tatiana ou Ricardo) e mostra a proposta.
   - "Passa a Amanda para 11h" → mesma data, ANTES/DEPOIS.
   - "Muda ela para depois de amanhã" → pergunta o horário (não assume).
   - "Cancela o João das 14h" → pergunta o motivo; depois "Coloca o Fábio no lugar".
   - "Qual horário a Tatiana tem amanhã?" / "Quais horários livres a Tatiana tem
     amanhã para Escova?"
   - "Bloqueia a Tatiana das 14h às 18h" → pergunta o dia.
   - "Cancela Amanda e coloca Fábio no lugar" → motivo e serviço, depois um único
     Confirmar para as duas ações.
   - "Remarca João para sexta às 15h e bloqueia Tatiana depois das 17h".
   - "Marca a Carla amanhã às 11h com a Tatiana para Escova" → conflito com a Rosa,
     alternativas; responda "Então às 14h" ou "Pode encaixar, ela é cliente antiga".
   - "Marca a Carla domingo às 10h para Escova" → indisponível (fora do expediente).
5. Depois de Confirmar, o cartão mostra "Concluído" e o link "Ver na agenda".
   Limitação local conhecida: `/dashboard` (tela de entrada depois do login) e
   `/relatorios` mostram "Algo deu errado", porque o cartão "Oportunidades" lê
   `FlexibleWaitlist`, que no banco local está sem o RLS da migration manual 019. O
   preflight da 019 só autoriza o banco do CI (`salon_schema_ci`), então ela não foi
   aplicada aqui. Use a barra lateral (Agenda, Hoje, Clientes…) — as outras 19 telas
   do painel abrem sem erro.
   Para encerrar o app: Ctrl+C no terminal do passo 2.

Cada mensagem custa cerca de US$ 0,0005 (Luna). Nada executa sem o botão
Confirmar. O banco é local e descartável; nenhuma mensagem externa é enviada.

Para reproduzir a bateria prática automatizada (Luna real, journal próprio de
US$ 7 em `packages/salon-secretary/evaluation/results/agenda-core/stage-budget.jsonl`):
`AGENDA_PRACTICE_REAL_APPROVED=true node scripts/run-agenda-practice.cjs --scenarios packages/salon-secretary/evaluation/agenda-practice-scenarios.json`
e `node packages/salon-secretary/evaluation/agenda-practice-check.cjs <pasta-do-resultado>` (transcrição legível: `agenda-practice-print.cjs`).
