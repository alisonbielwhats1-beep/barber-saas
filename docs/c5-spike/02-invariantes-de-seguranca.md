# Invariantes de segurança da Secretária: da saída da Luna até a escrita

A maioria das barreiras de escrita vale igual com saída RESOLVIDA. As três camadas que dependem do texto do dono precisam de adaptação e não podem ficar redundantes:

- **Prova literal de data e hora:** hoje o backend calcula o valor a partir do literal. Com data e hora absolutas, ele precisa recalcular e comparar.
- **Prova de menção de entidades:** hoje o backend busca pelo nome que o dono escreveu.
- **Sem escolha automática entre homônimos:** este é o maior risco. Hoje a regra é estrutural, porque o schema recusa ids vindos da Luna (`scheduling-contract.ts:24`, `conversation-routing.ts:360`).

Existe um precedente no código para "saída resolvida": o `choice={option_id, literal}`. Ele liga a escolha ao card publicado na rodada, exige que o literal aponte uma única opção e reconsulta o tenant (`salon-secretary.ts:1713-1761`, `secretary-options.ts:185-223`). O spike deve generalizar esse mecanismo, não contorná-lo.

Os caminhos abaixo são relativos a `D:/Projetos/barber-saas/.claude/worktrees/secretary-mobile-investigation-8658bb/`. Nenhum arquivo foi criado ou alterado, e nada foi executado além de leitura e grep.

Flags do candidato C4 (`.demo/agenda-core/candidate-flags*.sh`):
- **Ligadas:** NAME_SUGGESTIONS, CUSTOMER_OVERLAP_GUARD, SCHEDULING_OVERLAP_ENABLED, EXCEPTION_RULES_V2, DATE_RULES_V2, REFERENCES_V2, MULTI_SERVICE, ALTER_APPOINTMENT, MULTI_ACTION_V2.
- **Desligadas por padrão:** COMBO_GUARD e BLOCK_OVERLAP_GUARD (commit `c3d33de`) e PROPOSAL_CHECK (`proposal-check.ts` ainda não está no git).

## 1. Tabela de invariantes

Na última coluna: "Mantém" = vale sem mudança; "Adaptar" = precisa de mudança no spike; "Redundante" = pode sair.

| # | Invariante | Onde é aplicada | Entrada de que depende | Com saída RESOLVIDA |
|---|---|---|---|---|
| 1 | A Luna nunca executa | `packages/salon-secretary/src/index.ts:163,188-205`: a ferramenta só devolve `*_NOT_EXECUTED`, com toolChoice fixo e `parallelToolCalls:false`. `conversation-routing.ts:359` ("Nenhum modo executa operações"). Toda confirmação passa só por server actions: `src/app/(admin)/servicos/secretaria/actions.ts:44-49,62-67,83-95` → `salon-secretary.ts:1861-1879,1990-1998,2164-2221`. Nenhum caminho de turno chama confirm (verificado por grep). | contrato da ferramenta | **Mantém.** As ferramentas de leitura do spike não podem chamar `prepare`/`upsertSchedulingDraft` (gravam AuditLog, `scheduling-actions.ts:170`) nem `propose*`. |
| 2 | Limite de chamadas ao modelo | `index.ts:236-252` (MODEL_CALL_LIMIT: uma interpretação e um reparo de literal) | contador | **Adaptar.** O spike prevê 2–3 consultas; o contador precisa continuar fechado. |
| 3 | Confirmação autenticada, com token exato | `actions.ts:10-16` (sessão e papel). `salon-secretary.ts:2167-2221`: `proposal_ref` e `draft_revision` precisam ser iguais aos da proposta viva, senão PROPOSAL_MISMATCH. `:314`: filho de plano só confirma pelo grupo (CONFIRMATION_GROUP_REQUIRED). `action-plan.ts:125-136`: grupo só fica pronto com `proposal_token` e preview. `:217-255`: `plan_ref`, `revision` e `fingerprint`. `salon-secretary.ts:1880-1891`: token vivo diferente do aprovado não executa. | clique na UI com ids do backend | **Mantém, sem tocar.** |
| 4 | "sim" digitado nunca confirma | Não existe rota de texto para confirm (linha 1). `salon-secretary.ts:806-812`. `secretary-options.ts:146-152,185-223`: "sim", "essa" ou ordinal sozinhos não resolvem card. `secretary-scheduling.ts:1204-1206`: alias só por clique. Prompt em `scheduling-skill.ts:136,186` e `services-skill.ts:29`. | texto do dono | **Mantém.** A saída não pode ter campo de aprovação. |
| 5 | Idempotência e journal | `secretary-journal.ts:7-18` (advisory lock) e `:27-55` (revisão, payload_hash, CONFIRMED anterior vira duplicate, expiração). `scheduling-actions.ts:40` (hash), `:192` (proposta vale até 10 min). `:96,:102` e `scheduling-mutations.ts:240` (idempotencyKey = proposal_ref). Recibos de grupo em `salon-secretary.ts:1839,1854,1907-1935`. | ids do backend | **Mantém.** |
| 6 | Frescor na hora de confirmar | `scheduling-actions.ts:184,234-239` e `scheduling-mutations.ts:231-235` (o snapshot é refeito; se mudou, SCHEDULE_CHANGED) | linhas do tenant | **Mantém.** |
| 7 | HARD_BLOCK e encaixe | `scheduling-catalog.ts:130-151`: salão fechado, horário passado ou violação que não admite encaixe viram CONFLICT_HARD_BLOCK com `plan=null`. `appointment-overlap-policy.ts:2-9`: encaixe só em SLOT_TAKEN contra agendamentos, só para OWNER/MANAGER, motivo com pelo menos 3 caracteres. `scheduling-actions.ts:91-99`. Consentimento: `scheduling-conflict-contract.ts:37-62,66-70,79-85`, `salon-secretary.ts:1166-1167`; trocar o horário derruba o consentimento (`scheduling-actions.ts:134`). | linhas do tenant e papel; o consentimento precisa ser literal | **Mantém.** O status nunca vem da Luna. `override_requested` resolvido não pode substituir o literal. |
| 8 | Isolamento de tenant e permissões | `actions.ts:10-16`. `secretary-rollout.ts:12-22` (allowlist; nega `VERCEL_ENV=production`). `salon-secretary.ts:306-311` (sessão presa a salonId+userId), `:312-323` (reautoriza por skill), `:866-867`. `prisma-tenant.ts:84-93` (GUC por transação; `:8-10` avisa que, sem RLS aplicado, o isolamento vem só do filtro `salonId`; se o RLS está aplicado: **não verificado**). `scheduling-mutations.ts:76-81` (cancelar e bloquear só OWNER/MANAGER). Filtros `salonId` em `scheduling-catalog.ts:112-116,183-194` e `scheduling-mutations.ts:95,105,165,169`. | sessão e linhas do tenant | **Mantém** a autorização. **Adaptar** a regra "a Luna não envia ids": aceitar só id publicado nesta rodada para esta ação (como `optionBinding`, `salon-secretary.ts:1723-1725`) e reconsultado no tenant (como `selectScheduling`, `secretary-scheduling.ts:1113-1237`). |
| 9 | Prova literal de data e hora | `scheduling-temporal-source.ts:431-523`: cada valor precisa de citação presente, não negada, no papel certo, completa, cuja leitura dê o mesmo valor; a evidência não cria valor ausente (`:440-443`); rejeição em `:502-505`. `:509-520`: resposta curta não troca de papel. `:539-612`: caminho sem evidência. `scheduling-temporal-mode.ts:239-329`: o backend calcula o valor a partir do componente `{value, literal}`; SELECTOR_CONFLICT em `:227-237`. Cobertura: `:731-744` (escopo) e `:773-802` (dia mantido). | `temporal_evidence` da Luna, literal, fuso e "hoje" do salão | **Adaptar, nunca Redundante.** O validador tem de recalcular as leituras do literal no fuso do salão e exigir que o valor absoluto seja a leitura única. Senão vira escolha do modelo ("às 2" → 14h). |
| 10 | Prova literal do motivo | `scheduling-literal-source.ts:16-49`: trecho literal, negador colado recusa, guarda original, sha256 e offsets. `scheduling-actions.ts:121-122`, `scheduling-mutations.ts:178`. | texto e mensagem | **Mantém.** |
| 11 | Prova de menção de entidades | `scheduling-entity-mentions.ts:14-33,56-95` (serviço literal, fora do nome da cliente). `secretary-scheduling.ts:811-829`: nome de cliente ou profissional fora da mensagem vira card de confirmação (só com NAME_SUGGESTIONS, `:824`). `:876-889`. `secretary-alteration.ts:61-106,144-155`. `secretary-multi-service.ts:127-141`. | nomes da Luna, mensagem e diretório do tenant | **Adaptar:** literal do dono → busca no tenant → o id escolhido está no resultado e é o único que o literal singulariza. **Lacuna:** no par atômico T21 (`secretary-batch.ts:86-118`, `scheduling-batch.ts:95-149`) não encontrei prova literal de nome, só busca no catálogo (grep; impacto não testado). |
| 12 | Sem auto-escolha entre homônimos | `secretary-scheduling.ts:440` (só com exatamente 1 linha), `:441-452` (card até 20), `:469,:503`, `:532,:546-551` (só o agendamento único do dia), `:437-439`. `secretary-alteration.ts:192-202`. `scheduling-batch.ts:95-112`. `scheduling-contract.ts:70` (`auto_assign_only_single_eligible`). `secretary-options.ts:185-223`. | número de linhas do tenant para o literal | **Adaptar, maior risco.** Se o literal do dono casa com 2 ou mais linhas, a escolha da Luna é descartada e vai para card. |
| 13 | Negação nunca vira ação | Prompt: `conversation-routing.ts:359`. Backend, só de forma indireta (por valor): `scheduling-temporal-source.ts:139-152,219-236,269-274`, `secretary-sibling-scope.ts:245-253`, `scheduling-literal-source.ts:23`, `salon-secretary.ts:1728-1729`, `secretary-same-as.ts:181`, `secretary-alteration.ts:56-65,83`, `scheduling-temporal-mode.ts:322`. | literais e negadores | **Adaptar.** Não há portão por verbo negado. Uma operação sem literal temporal (ex.: cancelamento localizado só pela cliente) depende do prompt, do motivo literal e do Confirmar (não testado). Com valores resolvidos, é preciso um portão explícito na cláusula. |
| 14 | Dia novo sem horário pergunta (GF14) | `scheduling-contract.ts:43-51,66-69`. `scheduling-mutations.ts:143-144` (só dia ou só hora dá NEEDS_INPUT). `secretary-scheduling.ts:583-589` (só a hora herda o dia, nunca o contrário), `:554-563`, `:570-582`. `secretary-same-as.ts:341-390` ("mantém o horário" só com forma provada). | presença de `time` provado | **Adaptar.** A estrutura continua, mas só vale se `time` exigir literal ou um "mantém" provado. Hora absoluta copiada da origem não basta. |
| 15 | Sobreposição da mesma cliente | `secretary-scheduling.ts:129` (flag), `:663-666` (criação), `:616-622` (alteração). `scheduling-actions.ts:189-193`. | linhas do tenant | **Mantém.** Não é refeita no confirm (`scheduling-actions.ts:217-244`); se o domínio recusa: **não verificado**. |
| 16 | Guarda de combo (C5) | `secretary-combo-guard.ts:9-36`. `secretary-alteration.ts:240-243`, `:266-289` (o combo absorve a parte; parte não dita só entra com clique, `:278-283`; `combo_chosen` em `:431`), `:303-308`. | catálogo, serviços do atendimento e palavras do dono (`change.service_name`) | **Mantém no essencial.** **Adaptar:** `unsaidComboParts` precisa do literal do serviço. Só cobre INCLUDE em alterações; a criação usa `singleServiceCombo` (`secretary-multi-service.ts:251`). |
| 17 | Guarda de bloqueio (C5) | `secretary-scheduling.ts:634-639` e `:1125-1128`. `secretary-block-guard.ts:25-73`. Linhas afetadas: `scheduling-mutations.ts:169`. Sem a flag, o preview só avisa (`scheduling-mutations.ts:207`). | linhas do tenant | **Mantém.** |
| 18 | Eco não é evidência | `secretary-scheduling.ts:750-768,830-838,864-866,910-916,946-950`. `salon-secretary.ts:1161-1163` (o slot liberado define dia, hora e profissional). | valores que a Luna copia | **Adaptar e reforçar.** Com ferramentas, quase todo valor da Luna é cópia de dado de ferramenta. |
| 19 | Referências entre ações (same_as) | `secretary-same-as.ts:163-187`. `packages/salon-secretary/src/same-as.ts:84-98`. `salon-secretary.ts:1148-1153` (o valor vem da proposta aceita, nunca da Luna). | literal e proposta aceita | **Adaptar:** exigir o literal de referência e trocar pelo valor aceito do backend. |
| 20 | Recorrência nunca vira uma ocorrência silenciosa | `secretary-scheduling.ts:697-702`, `salon-secretary.ts:1730-1734`, `secretary-batch.ts:97` | palavras do dono | **Mantém.** |

## 2. Regras do dono 1–12

| Regra | Onde é aplicada | Com saída RESOLVIDA |
|---|---|---|
| 1. Criação ou consulta sem dia pergunta o dia | `scheduling-contract.ts:68-69` (data obrigatória), prova literal da data (linha 9 da tabela), `secretary-scheduling.ts:716-717` | **Adaptar:** a data exige literal; a Luna não pode preencher "hoje". |
| 2. Mudar só o dia pergunta o horário (GF14) | Linha 14 da tabela | **Adaptar** (idem). |
| 3. Bloqueio sem fim pergunta o fim | `scheduling-contract.ts:69`, `scheduling-mutations.ts:164` | **Adaptar:** `end_time` exige literal; nunca o fim do expediente. |
| 4. Cancelar e remarcar a mesma cliente é uma remarcação só | Nenhuma trava de backend encontrada por grep; depende da Luna (**não verificado**) | Continua sendo decisão do modelo. Risco: o par cancelar+criar da mesma cliente passa. |
| 5. Primeira pessoa usa a agenda do próprio usuário | `secretary-first-person.ts:13-19`, `scheduling-catalog.ts:69`, `secretary-scheduling.ts:328-329,470-474,505-508,689-692`, `secretary-alteration.ts:182-187` | **Mantém** se o backend resolver o "eu". Um id vindo da Luna só vale com literal de primeira pessoa e igual ao cadastro do próprio usuário. |
| 6. Próximo atendimento, sem dia, olha o próximo dia de trabalho | `scheduling-catalog.ts:239`, `secretary-scheduling.ts:590-595,747-748` | Só leitura, sem risco de escrita; pode ir para uma ferramenta (**Redundante** como trava). |
| 7. Pronome após mover uma cliente é a cliente movida | `salon-secretary.ts:1169-1173`, `secretary-same-as.ts:648-714` | **Adaptar:** a escolha da Luna só vale se concordar com a regra de tópico do backend; senão pergunta. |
| 8. Bloqueio "entre" dois horários bloqueia só o vão livre | `salon-secretary.ts:1112-1147` (valores das propostas aceitas; `:1141-1146` só vão livre) | **Mantém** se o backend semear os valores; horários da Luna precisam ser iguais ao vão e o vão precisa estar livre. |
| 9. Combos: o catálogo decide | `secretary-multi-service.ts:42,225-260`, `secretary-scheduling.ts:437-439`, `scheduling-batch.ts:145-148`, `secretary-alteration.ts:213-243,349-360` | **Adaptar:** com combo e serviços separados cadastrados, continua card; o id escolhido pela Luna não é aceito. |
| 10. Bloqueio com atendimento dentro pergunta | Linha 17 da tabela (flag desligada) | **Mantém.** |
| 11. Combo substitui a parte que o atendimento já tem | Linha 16 da tabela (flag desligada) | **Mantém / Adaptar** (literal do serviço). |
| 12. Conferente | `packages/salon-secretary/src/proposal-check.ts:4-10` (flag desligada; não adotado pela Etapa 1 do plano C5) | Irrelevante para a escrita; se usado, só barra. |

## 3. O que o spike não pode tocar

1. **Caminho de escrita:**
   - server actions de confirmação (`actions.ts:44-95`);
   - `salon-secretary.ts:1834-1939,1990-1998,2164-2221` e `:314`;
   - `secretary-journal.ts` (inteiro, arquivo congelado);
   - `scheduling-actions.ts:40,91-105,179-244`;
   - `scheduling-mutations.ts:160-244`;
   - `scheduling-batch.ts:264+`;
   - `action-plan.ts:125-136,201-255`.
2. **Autoridade do domínio:**
   - `scheduling-catalog.ts:108-172` (revisão de disponibilidade e HARD_BLOCK);
   - `appointment-overlap-policy.ts`;
   - `createVisit`/`createAppointment`;
   - `scheduling-conflict-contract.ts:25-85` (escopo, consentimento literal, contradição).
3. **Tenant e permissões:** `actions.ts:10-16`, `secretary-rollout.ts`, `salon-secretary.ts:281-323,866-867`, `prisma-tenant.ts:84-93`, `scheduling-mutations.ts:76-81`, e todo filtro `salonId`.
4. **Reconsulta de seleção:**
   - `selectScheduling` (`secretary-scheduling.ts:1113-1237`), incluindo alias só por clique;
   - `selectAlteration`, `selectServiceList`, `blockOverlapSelection`;
   - `applyOptionChoice` (`salon-secretary.ts:1720-1761`), `choiceVerdict` e `writesOptionName`.
5. **Travas calculadas no backend:**
   - sobreposição da cliente (`secretary-scheduling.ts:616-622,663-666`);
   - bloqueio (`:634-639` e `secretary-block-guard.ts`);
   - combo (`secretary-alteration.ts:240-308` e `secretary-combo-guard.ts`);
   - regra 8 (`salon-secretary.ts:1141-1146`) e slot liberado (`:1161-1167`);
   - campos obrigatórios, GF14 e `end_time` (`scheduling-contract.ts:43-72`, `scheduling-mutations.ts:143-144,164`);
   - recorrência (`secretary-scheduling.ts:697-702`).
6. **Primitivas de prova literal** (reusar sem afrouxar):
   - `literal-match.ts`;
   - `temporalLiteralNegated`, `temporalQuoteDenied`, `entityQuoteDenied`, `governingNegators`;
   - `groundSchedulingReasons`, `referenceLiteralProven`, `actionScopedSource`.
7. **Contrato do modelo:** execute sem efeito (`index.ts:196-205`), schema strict, orçamento de bytes.

## 4. Checagens que o validador leve precisa manter

Todas rodam no backend, no fuso do salão, contra a mensagem atual:

1. **Portão da cláusula:** o `source_scope` da ação é literal único da mensagem e não tem negador governante (`governingNegators`). Sem isso, a ação vira pergunta.
2. **Todo valor gravável tem origem do dono:** span literal não negado, clique ou opção provada, ou valor derivado pelo backend a partir de literal provado (referência, "mantém", slot liberado). Sem origem, o campo é perguntado, nunca preenchido por padrão. Vale para cliente, profissional, serviço(s), novo profissional, delta de serviços, data, hora, fim, origem, motivo e consentimento de encaixe.
3. **Valor e literal concordam, recalculados:**
   - data e hora: o backend lê o literal (`quoteTemporalFacts`/`componentVerdicts`, `today`, fuso) e o valor absoluto da Luna precisa ser a leitura única;
   - duas leituras (meio-dia/meia-noite, DATE_CHOICE, data já passada): a Luna não escolhe;
   - o horário do salão só decide quando o dono não escreveu período.
4. **Id ligado ao conjunto publicado:** o id foi publicado para esta ação nesta rodada por uma ferramenta de leitura do tenant, e é reconsultado antes de preparar a proposta (senão SELECTION_INVALID).
5. **Unicidade pelo literal:** a busca do tenant pelo literal do dono contém o id; se houver 2 ou mais linhas, os tokens do literal (sobrenome, final do telefone, dia/hora) precisam singularizar o id escolhido, no critério do `choiceVerdict`. Senão, card.
6. **Papel e escopo:** o literal está na cláusula da ação (não na de outra ação) e no papel certo (origem ou destino, início ou fim; `temporalRoles`/`componentRoleRelation`). Resposta curta mantém o papel perguntado.
7. **Cobertura:** todo dia ou hora escrito na cláusula é consumido por um valor ou está negado/excluído (`applyScopeCoverage`, `applyKeptDayGuard`). Nada é descartado em silêncio.
8. **Exclusões:** valor excluído ("não 10h", "menos", "sem barba") nunca é o escolhido. "Menos / só o vazio" num bloqueio vai para o card de bloqueio.
9. **Sem defaults:** dia novo exige hora (GF14), início de bloqueio exige fim, criação exige dia. Copiar a hora ou o dia da origem só com literal "mantém/mesmo horário" provado.
10. **Eco não prova:** cópia de opção, de linha de ferramenta ou de valor aceito não conta como evidência.
11. **Motivo e encaixe:** motivo literal com proveniência; consentimento literal, sem "não"; papel OWNER/MANAGER; HARD_BLOCK nunca pode ser encaixado.
12. **Fatos do domínio recalculados na proposta e no confirm:** disponibilidade, elegibilidade, preço e duração, sobreposição da cliente, linhas afetadas pelo bloqueio, combo/parte. Nunca os valores da Luna.

## 5. Lacunas e itens não verificados

- **Par T21 (cancelar + criar):** não encontrei prova literal de nomes; só busca no catálogo e card para homônimos (grep, sem teste).
- **Regra 4:** nenhuma trava de backend localizada.
- **Negação:** a proteção é por valor, não por operação.
- **Sobreposição da cliente:** não é refeita no confirm; se o domínio recusa, não verifiquei.
- **RLS:** se está aplicado no banco local, não verifiquei.
- **Travas C5 de combo e de bloqueio:** estão desligadas por padrão; com as flags desligadas, as regras 10 e 11 não são aplicadas.
