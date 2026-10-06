# P3 e fonte literal: causas verificadas após o Golden v2

Data: 2026-09-26. Trabalho local, sem Production ou inferência paga nesta correção.

## Causas

1. A presença de qualquer temporal_evidence ativava exigência global de evidência para todos os campos temporais. Uma evidência de horário sem entrada repetida da data apagava weekday/source_weekday que Luna tinha estruturado corretamente.
2. Um trecho amplo era reinterpretado como se todas as suas datas fossem o mesmo campo. Em GF12, “hoje está marcada para terça às 14h” tinha source_weekday=2 correto; o guard tratava hoje e terça como datas concorrentes desse mesmo papel.
3. A rejeição de um patch e a invalidação do valor efetivo eram representadas da mesma forma. O guard preservava um horário aceito após um retarget errado, mas adapters e upsertSchedulingDraft o apagavam outra vez.
4. reason de cancelamento não tinha comprovação literal. GF17 forneceu “Ele vai viajar.” onde a fonte dizia “Ele pediu porque vai viajar.”; a proposta precisava ficar indisponível.

## Correção

- Evidência temporal fica local ao campo/papel. Evidência companheira do mesmo papel ou escopo relacional explícito pode comprovar um campo cuja entrada foi omitida, desde que haja testemunho factual inequívoco. Não se reutiliza outro papel.
- A categoria do seletor fornecido por Luna determina o tipo do testemunho factual. Um weekday precisa de uma expressão de dia da semana única no trecho. Qualificadores contíguos, como dia da semana + data absoluta, permanecem inseparáveis e devem concordar. O backend não escolhe entre dois weekdays concorrentes.
- Rejeições de retarget podem registrar retained_value. A persistência só o conserva quando é exatamente o valor da revisão anterior e do estado recebido. Rejeições factuais continuam removendo campos e a referência do agendamento.
- Campos aceitos repetidos sem uma afirmação temporal nova não são apagados por uma correção independente de horário.
- scheduling-literal-source valida reason e override_reason selecionados por Luna contra trecho literal da mensagem. NFC/capitalização só identificam a mesma representação; o valor gravado é o substring original, acompanhado de SHA e offsets. Paráfrase, expansão de sujeito e motivo inventado são rejeitados. Corte de um negador diretamente ligado ao trecho também é rejeitado; negação em ação posterior não contamina a causa.
- source_missing separa o motivo anterior aceito da correção ainda não comprovada. Scheduling e batch persistem NEEDS_INPUT, invalidam proposta, perguntam o motivo e só limpam o campo pendente após nova causa literal aceita.
- A função histórica de original override reason e suas evidências não foram reescritas. O runtime usa a comprovação literal nova; APIs backend históricas sem sourceMessage continuam compatíveis.

## Evidência real preservada

Replay: [.demo/golden-grounding-real-replay.json](../.demo/golden-grounding-real-replay.json). Os arquivos originais do Golden, suas mensagens e expected não foram alterados. O artefato registra hash dos logs, dos argumentos reais por response_id e dos validadores atuais.

- GF11: datas de origem/destino preservadas. time e source_time estavam ausentes no próprio output Luna e continuam pendentes. Nenhum relógio foi inventado nem convertido silenciosamente entre 12h/24h.
- GF12: origem terça 2027-04-13 às 14h e destino quarta 2027-04-14 às 16h preservados.
- GF13: quinta 2027-04-15 às 16h preservados. Seleção de entidade continua pertencendo ao backend; o turno de seleção UI sem output provider é explicitamente excluído desse replay.
- GF15: datas preservadas e correção de source_time 13h → 14h aplicada sem apagar destino 16h.
- GF16: origem preservada e destino quarta → quinta corrigido sem apagar horários aceitos.
- GF17: motivo parafraseado rejeitado; reason fica pendente e precisa de fonte literal.

São 8 verificações de boundary, não 8 conversas concluídas nem uma nova execução do Golden. O resultado original da bateria continua sendo reportado separadamente pelo coordenador.

Replay histórico G/Amanda/H após esta correção: [.demo/historical-replay-final-source-classes.json](../.demo/historical-replay-final-source-classes.json), 16/16 PASS. Mantêm-se os limites do replay histórico: argumentos reais nas Amanda, estado capturado em G, ActionPlans capturados em H; sem nova inferência, consulta de entidades ou prova de execução PostgreSQL nessa camada.

## Fixtures sintéticas

Alguns testes antigos faziam o ScriptedModel fornecer motivo ausente da mensagem sintética. Os originais e hashes foram preservados em [.demo/reason-fixture-provenance](../.demo/reason-fixture-provenance). Novos testes negativos provam que esses inputs antigos são rejeitados. Apenas fontes sintéticas positivas foram alinhadas ao motivo pretendido, mantendo as assertions existentes. Golden, holdout e replay real permanecem intocados.

## Limites

- A prova literal comprova texto, valor e proveniência. Luna continua responsável pela relação semântica entre a causa e a ação; o backend não tenta reconstruir português arbitrário.
- Horários coloquiais com período ausente podem exigir clarificação contextual. Nenhuma conversão por disponibilidade ou módulo 12 foi introduzida.
- Entidades, disponibilidade, overlap, HARD_BLOCK, confirmação, idempotência e RLS continuam revalidados pelo domínio. O coordenador executa as suítes PostgreSQL sequencialmente com backup; esta correção não acessou o banco diretamente.


## Golden v3: metadados, negação e seletores de leitura

O Golden v3 original registrou 9/30 PASS, 21 FAIL e zero safety failure. Os casos congelados e seus outputs não foram alterados. Nesta rodada P3 foram identificadas três causas determinísticas:

1. Uma entrada de temporal_evidence sem valor efetivo era promovida a requisito ausente. No GF13, source_date=quinta estava apenas na evidência, enquanto weekday=4 descrevia o destino; isso bloqueava a consulta de candidatos reais com uma pergunta indevida sobre origem. No GF20, time=de manhã na evidência criava uma exigência de horário exato para uma consulta por período. Evidência agora verifica valores; requisitos continuam vindo do domínio e de fatos temporais ausentes detectados nas cláusulas explícitas. Evidência contraditória de um valor previamente aceito ainda o invalida.
2. O guard de negação global removia data e horário de uma operação explicitamente somente leitura no GF19. Leituras agora distinguem a negação de uma operação da negação diretamente ligada ao átomo temporal. Negação factual, dia da semana incompatível com a data e o fallback conservador de mutações continuam bloqueados.
3. O adapter preservava time nos campos de uma leitura, mas ignorava esse filtro nos resultados. Consultas agora aplicam o horário exato junto do período. O limite da consulta é verificado antes de filtrar, para que uma amostra incompleta não vire uma resposta vazia aparentemente completa.

Validação offline: 117/117 testes focados em cinco arquivos, incluindo 26 casos novos de generalização, papel aguardado, estado persistido, negação factual e consultas. Foram exercitados dois atendimentos do mesmo cliente em horários diferentes, período sem relógio exato e limite de resultado. O teste de adapter usa o journal real com I/O simulado; não é evidência nova de PostgreSQL.

Replay dos outputs reais: [.demo/golden-v3-p3-replay.json](../.demo/golden-v3-p3-replay.json), 8/8 verificações de boundary. O relatório inclui SHA256 dos arquivos originais, argumentos por response_id, relógio por caso e os estados antes/depois. A lógica antiga foi preservada em [.demo/p3-v3-before](../.demo/p3-v3-before); apenas imports relativos foram remapeados para executar o comparativo offline.

- GF13, GF19 e GF20: os outputs corretos deixam de produzir as perdas/pendências artificiais descritas acima.
- GF24: terça versus 14/04/2027 continua rejeitada; nenhum dia alternativo é escolhido pelo backend.
- GF22, GF23, GF25 e GF26: os dados temporais já estavam corretos. A Luna havia escolhido change/read/list em vez de create. O replay conserva essas operações erradas; não representa recuperação da tarefa, validação de HARD_BLOCK ou nova execução do Golden.

Nesta rodada não houve chamada de modelo, acesso ao holdout, execução de banco, alteração de RLS/permissions ou flexibilização de confirmação, idempotência e HARD_BLOCK.


## Golden v4: consent context and independent closure facts

- GF22: Luna returned the correct explicit boolean for the pending overlap question. A legacy source regex required adjacency between an authorization verb and the overlap noun, so a valid continuation failed before draft persistence. The adapter now supplies backend-only decision context: unexpired reviewed draft, matching effective fields, same operation, exact pending field, and an eligible factual review. This permits Luna's typed reply within that context. A simultaneous target/slot change, denied permission, HARD_BLOCK, empty/negated source, or mismatched draft cannot use that path. Legacy calls without this context retain their conservative rule. Literal causal reason remains required before proposal, and domain permission/availability/confirmation checks remain authoritative.
- Batch replies additionally require the entire plan to match the reviewed draft, so a changed cancellation cannot reuse permission for the inherited destination. DAG and fields remain intact.
- GF23: the domain returned OUTSIDE_WORKING_HOURS before checking the independently seeded SalonClosure. The operation already stayed HARD_BLOCK, but the review omitted SALON_CLOSED. The adapter now composes the closure fact from the tenant-scoped day already loaded, retaining both causes. Closure always makes override unavailable. No extra query, permission, domain rule or golden expectation changed.
- Runtime originals and hashes: .demo/p3-v4-conflict-before/manifest.json.
- Permanent regressions: scheduling-conflict-context.test.ts, 29 cases. Singleton and batch adapters, actual journal/domain logic with mocked I/O, varied consent wording, reasons, changed targets, stale context, false/negated consent, permissions, closure overlap boundaries and hard-block insistence. The initial focused set passed 75/75. The expanded run passed 108/109; its sole failure was X94_UNAUTHORIZED_SOURCE_DRIFT in archive verification, requiring the coordinator's historical-source handling. No oracle was weakened to hide it.
- Real-output replay: .demo/golden-v4-conflict-replay.json, 3/3 passed with original argument/source hashes, exact v4 saved state and unchanged fixture facts. GF22 had no recorded third provider turn, so this replay proves the corrected mandatory reason question, not completion of an unseen turn. GF23 proves both observed turns remain unconfirmable with all factual causes. No network, paid calls, database or operational mutation ran in this replay.


### Explicit refusal and a changed destination

Follow-up adversarial testing exposed a related tri-state bug: false was treated as unanswered by a boolean truthiness check. A refusal now remains an accepted decision about that slot. The assistant asks for a real alternative instead of asking for the same consent again. A changed slot or customer invalidates the old consent and reason; a newly conflicting destination requests a fresh decision. Batch handling preserves the prior false contract for a free alternative and drops that prior decision only when a different destination actually needs new conflict consent. A changed cancellation already invalidates its dependent decision through the existing graph logic.

Seven additional cases cover repeated refusal, free alternative, newly conflicting slot, both batch destinations, current permission revocation, current salon closure and positive consent copied to another customer. The permanent suite now has 36 cases. Final focused run: 81/81 across four files (.demo/p3-v4-decline-focused.json). Real v4 replay remains 3/3. TypeScript global and lint with zero warnings passed. Full-suite, real PostgreSQL and the next Golden evaluation remain the coordinator's separate gates; these local results do not declare conversational readiness.
