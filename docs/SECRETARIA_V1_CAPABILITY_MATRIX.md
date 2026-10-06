# Cérebro V1 — matriz canônica de capacidades e variáveis

Atualizada em 25/09/2026, na branch local `codex/x94-original-reason`.
Esta matriz descreve a candidata local, não uma implantação em produção.

## Como interpretar a evidência

- **PROVEN**: comportamento observado em inferência real com evidência durável e backend local, no recorte indicado. Para mutations, prova de interpretação/clarificação/proposal, nunca de execução neste gate.
- **VALIDATED_OFFLINE**: teste automatizado com código real e dados simulados, ou integração PostgreSQL com interpretação sintética. Não equivale a qualidade comprovada de Luna em linguagem livre.
- **SUPPORTED**: contrato publicado/implementado, sem prova suficiente da combinação exata para promoção aos níveis acima.
- **NOT_SUPPORTED**: fora do contrato V1 ou comportamento ainda não implementado. Deve falhar fechado; não autoriza substituir a intenção.
- **FALLBACK / KNOWN_LIMITATIONS**: comportamento seguro para limites explicitamente documentados; não equivale a cobertura linguística irrestrita.

Cada nível vale somente para o comportamento descrito na linha. Não se extrapola
uma conversa observada para infinitas frases, todas as entidades ou todos os
papéis. Resultados históricos desconhecidos e falhas continuam preservados.

## Fontes

| Referência | Evidência |
| --- | --- |
| G | [Golden V2](./SECRETARIA_GATE_3_1B_GOLDEN_V2.md), dez casos reais aprovados; resultado da promoção em SECRETARIA_GATE_3_1B_PROMOCAO.md |
| H | [Hard Conversations](./SECRETARIA_GATE_4_0B_FINAL_CONTINUATION_RESULT.md): 13/14 PASS na continuação, uma falha funcional segura; UNKNOWN anteriores não foram apagados |
| M | [Benchmark Multi-Action](./SECRETARIA_MULTI_ACTION_BENCHMARK_RESULT.md): x40–x49, 15 turnos reais; falhas antigas de apresentação preservadas |
| U | [Minimum Clarification final](./SECRETARIA_MINIMUM_CLARIFICATION_FINAL.md): x41/x42/x44/x46/x49, 5/5 PASS após correções; sem nova inferência neste gate |
| T | `packages/salon-secretary/evaluation/results/topic14-final/corrected-evaluator-result.json`: reavaliação offline das nove observações reais x90–x93, 4/4 PASS; originais preservados |
| B | `packages/salon-secretary/evaluation/results/topic14-final/real-result-1790311762668.json`: x94 real FUNCTIONAL_FAILURE_SAFE; bloqueio anterior à consulta de disponibilidade |
| X | [Fechamento x94](./SECRETARIA_X94_ORIGINAL_REASON_RESULT.md), `evaluation/results/x94-original-reason/real-result-1790315580605.json`: revalidação real PASS; HARD_BLOCK e motivo original com span/hash |
| O | `src/lib/__tests__/t21-overlap.test.ts`, `secretary-action-plan-batch.test.ts`; controle PostgreSQL T21 pós-fix em `evaluation/results/t21-extension/controlled-after-fix` |
| V | `src/lib/__tests__/secretary-action-plan-v2.test.ts`, `secretary-action-plan-runtime.test.ts`, `secretary-conversational-ux.test.ts` e demais regressões finais |
| R | [Router V1](./SECRETARIA_ROUTER_V1_VALIDATION.md), `secretary-router.test.ts`, `secretary-router-flow.test.ts`, Policy/allowlist e derivações congeladas |
| P | Snapshot PostgreSQL final independente, `evaluation/results/topic14-final/final-independent-snapshot.json` |
| PX | `evaluation/results/x94-original-reason/safety-closure-snapshot.json`: snapshot final/RLS/isolamento/flags PASS, zero efeitos operacionais; nove casos anteriores intactos |

Os caminhos `evaluation/results` acima são relativos a
`packages/salon-secretary/`. O relatório final informa comandos e resultados da
regressão atual; os números antigos nas fontes são históricos.

## Seis Skills e entidades publicadas

Registry V1: seis Skills e 18 operações. O modelo retorna intenção e campos;
IDs, permissão, duração, preço aplicado, disponibilidade, saldo e resultados
financeiros são resolvidos pelo backend.

| Skill/entidade | Operações/escopo | Evidência | Limite |
| --- | --- | --- | --- |
| Services / service | service.create, service.change | PROVEN — G, M, T | Cadastro exige nome/preço/duração; alteração publicada de nome/preço/duração; confirmação futura |
| Customers / customer | customer.create | PROVEN — G, M | Nome; contato opcional no cadastro administrativo; sem credenciais |
| Customers / customer | customer.search/read/change | VALIDATED_OFFLINE — secretary-customers.test.ts, secretary-customers-flow.test.ts | DTO mínimo; duplicatas/ambiguidade não autorizam merge |
| Scheduling / appointment | appointment.create/change/cancel | PROVEN — G, U, T | Proposta; change publicado não implica troca livre de serviço/profissional |
| Scheduling / agenda | appointment.list/read, availability.get | VALIDATED_OFFLINE — secretary-scheduling.test.ts, scheduling-batch.test.ts | Filtros publicados; dados tenant-scoped |
| Scheduling / bloqueio | schedule.block | PROVEN — H i14, U x44/x49 | Profissional, início/fim; duração de bloqueio não é inferida |
| Scheduling / professional | Resolução entre elegíveis ao serviço | PROVEN — H a04, U, T | Sem cadastro/gestão de profissional por esta Skill |
| Inventory / product | product.search/low_stock | PROVEN — G, M x48 | Produto do catálogo; sem cadastro de produto |
| Inventory / saldo | stock.balance | VALIDATED_OFFLINE — secretary-inventory.test.ts, hard-conversations-runtime-probes.test.ts | Saldo calculado pelo backend |
| Inventory / movimento | stock.movement IN/OUT | PROVEN — M x48, até proposta | Quantidade inteira positiva; sem conversão de embalagem, inventário COUNT ou compra |
| Financial / agregados | financial.report | PROVEN — G, M, T | Somente leitura; métricas/períodos publicados; recebido ≠ realizado ≠ faturamento |
| Communication / destinatário | customer.message EXACT | PROVEN — G, U, T | Contato resolvido no backend; provider local/fake |
| Communication / texto gerado | customer.message GENERATED explícito | VALIDATED_OFFLINE — secretary-communication.test.ts | Revisão prévia; sem envio externo |
| Tenant/ator/membership | Contexto servidor e autorização | PROVEN — P e preflights | Nunca selecionados por IDs fornecidos por Luna |
| Recurso físico/fila | Restrição da disponibilidade | VALIDATED_OFFLINE — O | Não são entidades manipuláveis livremente por linguagem no Registry |
| Configuração de jornada, papéis, credenciais, campanhas | Não publicadas | NOT_SUPPORTED | Nenhuma operação substituta silenciosa |

## Resolução, tempo e campos

| Variável/estado | Nível | Evidência e comportamento |
| --- | --- | --- |
| Nome exato e candidato único de cliente/serviço/profissional | PROVEN | G, U, T; referência final vem do backend |
| Serviço ambíguo (“corte”) | PROVEN | H a02 e U x42; seleção necessária, sem escolher primeiro |
| Profissional ambíguo | PROVEN | H a04; candidatos elegíveis apresentados |
| Cliente homônimo/ambiguidade em múltiplas ações | VALIDATED_OFFLINE | secretary-action-plan-batch/secretary-customers/hard-conversations-runtime-probes |
| Serviço não encontrado | PROVEN | H a09; não cria nem substitui automaticamente |
| Cliente/produto não encontrado | VALIDATED_OFFLINE | Testes das respectivas Skills; resposta de ausência/clarificação |
| Approximate: substring única na busca atual | VALIDATED_OFFLINE | hard-conversations-runtime-probes registra resolução automática de resultado único em serviço/produto; não é um fuzzy matcher geral |
| Confirmação universal de toda aproximação | NOT_SUPPORTED | Há protótipo de design, mas o runtime atual pode aceitar contains único; não promover o protótipo a capacidade entregue |
| Correspondência semântica livre/entidade ambígua auto-selecionada | NOT_SUPPORTED | Não autorizada; ambiguidade exige seleção |
| Hoje/amanhã | PROVEN | H i14/t08 e U; backend converte no fuso do salão |
| Ontem | PROVEN | G Financial e T x91 |
| Data explícita, weekday, período do dia | VALIDATED_OFFLINE | scheduling-temporal.test.ts e testes Scheduling; não inventa hora a partir de período vago |
| Horário exato e continuação curta | PROVEN | U “10h”, T x92 “11h” |
| Intervalo completo e início/fim | PROVEN | U x44/x49 e T x90–x93; duração calculada, não só start |
| Timezone do estabelecimento | PROVEN | Snapshots America/Sao_Paulo e regressão do defeito America/informação que falta |
| Outros fusos/transições civis | VALIDATED_OFFLINE | Testes de timezone/intervalo; sem extrapolar as medições locais |
| Campos completos e faltantes por ação | PROVEN | M, U, T; demais ações preservadas |
| Campo inválido/contraditório | VALIDATED_OFFLINE | Schema strict, scheduling-temporal, rejeição de chaves/refs/ciclos |
| Conflito de domínio | PROVEN | M x47 e T x91/x92 |
| Motivo: case/espaços/NFC/ponto final e alias aprovado | VALIDATED_OFFLINE | topic14-evaluator.test.ts; regra somente do evaluator |
| Resolver correferência (“ele” → “Fábio”) | NOT_SUPPORTED / KNOWN_LIMITATIONS; FALLBACK fail-safe | Não foi introduzido resolvedor. Identidade por nome não prova correferência; [auditoria histórica](./SECRETARIA_X94_COREFERENCE_AUDIT.md) preservada. |
| Preservar motivo original de cláusula explícita terminal, com span/hash | PROVEN no recorte X | x94 armazenou “ele já está aguardando”; não substitui pronome por nome. Sem cláusula identificável com segurança, fail-closed/clarificação. |
| Descartar expansão não provada do sujeito e recuperar o motivo original | VALIDATED_OFFLINE | Reprodução da saída histórica “Fábio…”; predicado deve corresponder estritamente. Na nova rede o modelo retornou “Ele…”. Não generalizar para paráfrases. |

## Conversa, ações e dependências

| Capacidade | Nível | Evidência/limite |
| --- | --- | --- |
| Single-turn e multi-turn com continuação | PROVEN | U e T; refs/revisões observáveis |
| Minimum Clarification, pergunta única/agrupada | PROVEN | U 5/5; T x91 pergunta serviço, decisão e motivo em seus momentos |
| Correção de serviço/hora invalida dependentes e preview | VALIDATED_OFFLINE | scheduling-temporal, hard-conversations-runtime-probes e O |
| Correção de destino após conflito | PROVEN | T x92; mesmo plano/draft, ALTERNATIVE_SLOT |
| 1 / 2 / 5 / 10 ações | PROVEN | M x40/x43/x45/x48 e U x41/x44/x46/x49 |
| actions[] acima de dez; 12/14/101 representáveis | VALIDATED_OFFLINE | V; capacidade estrutural, não benchmark real dessas quantidades |
| NORMAL 1–5 / ADVANCED 6–10 | PROVEN | U/M; política configurável |
| SPLIT >10 com componentes preservados | VALIDATED_OFFLINE | V; não corta cadeia para obedecer ao teto |
| Componente dependente acima do teto | VALIDATED_OFFLINE | SPECIAL_REVIEW; confirmação comum bloqueada |
| Ações independentes | PROVEN | M e T x91 |
| A→B / A→B,C | PROVEN | G e T; cancel→create e cancel→message |
| Cadeias gerais e múltiplos componentes | VALIDATED_OFFLINE | V, grafo dirigido/topologia; bindings de dados exigem adapter publicado |
| Ciclo, referência inexistente, chave duplicada | VALIDATED_OFFLINE | V; INVALID_DEPENDENCY_GRAPH antes de executar |
| Falha de dependência bloqueia descendentes | VALIDATED_OFFLINE | V e secretary-action-plan-batch; observado também em B, mas B não provou hard block |
| Partial failure preserva ações independentes | PROVEN até preview | M x47; sem execução silenciosa das prontas |
| Execução arbitrária de qualquer grafo com bindings não publicados | NOT_SUPPORTED | Representação de DAG não concede adapter/autoridade de execução |

## Scheduling T21

| Estado/variável | Nível | Evidência/limite |
| --- | --- | --- |
| Serviço → duração → intervalo | PROVEN | T x91; 45 min obtidos do catálogo |
| Projected availability | PROVEN | T; exclui somente Amanda, conserva reserva das 10h30 |
| SAME_RELEASED_SLOT / AVAILABLE | PROVEN | T x90; proposta 10h–10h45 |
| CONFLICT_OVERRIDABLE | PROVEN | T x91; 15 min de overlap e pergunta correta |
| OWNER autorizado | PROVEN até proposta | T x91/x93; motivo/aviso obrigatórios |
| MANAGER autorizado / demais papéis negados | VALIDATED_OFFLINE | O; política compartilhada da agenda manual |
| Consentimento sem motivo | PROVEN | T x91 turno 3; pergunta motivo, sem proposta |
| Motivo fornecido em continuação/inicial | PROVEN | T x91/x93, formas observadas e ancoradas |
| ALTERNATIVE_SLOT | PROVEN | T x92; 11h–11h45, mesma dependência |
| Alternativas exclusivamente backend | PROVEN | T x92; 11h/11h15/13h/13h15/13h30 |
| Mudança material invalida consentimento/motivo | VALIDATED_OFFLINE | O e regressões de projeção |
| HARD_BLOCK por fechamento | PROVEN | X: x94 real chegou a SALON_CLOSED/CONFLICT_HARD_BLOCK, override_allowed=false, nenhuma proposta; alternativas exclusivamente do backend |
| HARD_BLOCK diante de insistência/OWNER | VALIDATED_OFFLINE | O, teste final com mesmo draft e motivo; nenhuma proposta |
| SLOT_TAKEN por recurso ou oferta/fila | VALIDATED_OFFLINE | O; nunca mapeado genericamente para OVERRIDABLE |
| Atomicidade cancel→create em outro destino | VALIDATED_OFFLINE | Mesmo tx, locks e propagação de falha; sem experimento de mutation real neste gate |
| Auditoria de execução de override | SUPPORTED | Executor manual reutilizado; não foi executado nesta bateria |
| Override de TimeOff/pausa/jornada pela Secretária | NOT_SUPPORTED neste contrato | Permissões manuais distintas não são concedidas pelo encaixe T21 |

## Combinações críticas

| Combinação | Nível | Evidência |
| --- | --- | --- |
| Missing field + dependency | PROVEN | U x46/x49, T x91 |
| Ambiguity + multi-action | VALIDATED_OFFLINE | Testes ActionPlan/drafts/Skills; x42 real prova ambiguidade single-action |
| Correction + multi-turn | VALIDATED_OFFLINE | O e runtime probes; T x92 prova especificamente troca de destino |
| Cancel → create | PROVEN | G, U, T |
| Cancel → create e cancel → message | PROVEN | T x91/x92; a mensagem depende de cancel, não de create |
| Service → duration → conflict | PROVEN | T x91 |
| Conflict → override → reason | PROVEN | T x91, quatro turnos |
| Conflict → alternative slot | PROVEN | T x92, três turnos |
| Hard block + insistência | VALIDATED_OFFLINE | O; B falhou antes do domínio, não promove a PROVEN |
| Partial failure + independent action | PROVEN até preview | M x47; execução após confirmação apenas offline |
| Dez ações + dois campos faltantes | PROVEN | U x49; oito ações completas preservadas |
| Read + mutation + communication | PROVEN | M/U/T x91; read DONE não dispensa confirmação de mutations |
| EXACT + dependency | PROVEN | G/U/T, bytes preservados |

## Safety, fronteiras e fallback

| Contrato | Nível | Evidência/limite |
| --- | --- | --- |
| Backend authority; modelo não executa | PROVEN no recorte real | Journals T/B, wire witness, snapshots e contadores |
| RLS/FORCE RLS; runtime sem SUPERUSER/BYPASSRLS | PROVEN | P, 19 tabelas, acesso cruzado/sem contexto bloqueados |
| Nenhuma confirmação implícita durante interpretação | PROVEN | G/H/M/U/T/B, zero efeitos operacionais |
| Confirmação autenticada, revision/fingerprint, invalidação | VALIDATED_OFFLINE | Testes runtime ActionPlan, drafts, contratos de proposal |
| Idempotência/replay de confirmação | VALIDATED_OFFLINE | Testes de confirmação e grupos; sem confirmação real neste gate |
| Outbox como autoridade após confirmação | VALIDATED_OFFLINE | Communication e contratos de execução; Outbox real permaneceu zero |
| EXACT literal | PROVEN | T/U/G; evaluator não normaliza o conteúdo |
| Não escolher entidade ambígua/inventar disponibilidade | PROVEN nos casos observados; offline para adversariais adicionais | U x42, T x91/x92, O; não é garantia estatística universal |
| No override sem permissão/motivo ou atravessando hard block | VALIDATED_OFFLINE; parte positiva PROVEN | O e T; B bloqueou antes da avaliação de fechamento |
| Observabilidade durável/fsync/witness/checkpoints | PROVEN | T/B e snapshots finais; originais mantidos após reavaliação |
| Campo desconhecido/operação não publicada | VALIDATED_OFFLINE | Schemas strict/Registry, falha segura; não vira autorização |
| Linguagem arbitrária fora de cobertura | NOT_SUPPORTED como promessa universal | Usa NEEDS_INPUT, AMBIGUOUS, UNSUPPORTED, BLOCKED/FAILED_SAFE ou fallback publicado |
| Envios externos WhatsApp/Meta, SMS/e-mail, campanhas | NOT_SUPPORTED | Provider Communication é fake/local; nenhuma integração externa neste gate |

## Router e configurações V1

Fast-path autorizado pelo draft → JEV somente entradas PROVEN → Luna.
Compound/multi-action permanece DIRECT_LUNA. A allowlist ativa do Router V1
continua limitada às duas mensagens exatas de Financial ontem e Inventory
baixo; expansões experimentais de avaliação não se promovem automaticamente.

| Variável/caminho | Nível/estado |
| --- | --- |
| Fast-path contextual de campo pendente | VALIDATED_OFFLINE; respostas curtas reais também demonstradas, sem afirmar que todas dispensaram Luna |
| Duas decisões JEV inscritas | PROVEN historicamente no provider; integração Router/fallback VALIDATED_OFFLINE |
| JEV falho/inválido → uma interpretação Luna | VALIDATED_OFFLINE — R; nenhuma chamada JEV neste gate |
| JEV para compound, nomes abertos, mutations | NOT_SUPPORTED pelo Router V1 |
| SALON_SECRETARY_MODEL | gpt-6-luna |
| SALON_SECRETARY_MULTI_ACTION_V2_ENABLED | false por padrão e ao encerrar |
| SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED | false por padrão e ao encerrar |
| SALON_SECRETARY_ALLOW_PAID_CALLS / SALON_SECRETARY_JEV_ROUTER_ENABLED | false ao encerrar |
| SALON_SECRETARY_NORMAL_REVIEW_MAX | default 5; configuração de UX |
| SALON_SECRETARY_MAX_ACTIONS_PER_CONFIRMATION_GROUP | default 10; não é teto estrutural |
| SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS | 8192 somente no processo controlado; limite de recurso distinto de N-action |
| store / hosted_tools / containers / retries desta execução | false / 0 / 0 / 0 |

## Aceitação “dono real” e estado de fechamento

O fluxo serviço → conflito → encaixe → motivo → proposal tem evidência real em
T x91; a variante “Outro horário” em T x92. Essas conversas têm mensagens
congeladas mais explícitas que o exemplo abreviado do dono. Não se afirma ter
executado literalmente a frase do exemplo. A variante hard block/insistência
passou offline; a proibição de encaixe diante do pedido inicial explícito foi
comprovada ponta a ponta em X, sem executar mutation.

Portanto, Minimum Clarification e Multi-Action V2 conservam suas validações.
Scheduling overlap/override recebe VALIDATED no contrato publicado; a
regressão final pós-x94 passou com 2.516 testes. TOPIC_14_SECRETARY_BRAIN_V1 =
COMPLETE. A falha anterior de x94 permanece em B; a solução preserva a fonte
original sem alegar resolução de pronome. Nenhuma promoção para produção.
Próxima fase registrada: EXECUTION_E2E + FRONT/VOICE UX, não iniciada. Não abrir
outra bateria do cérebro sem bug, regressão ou requisito concreto.
