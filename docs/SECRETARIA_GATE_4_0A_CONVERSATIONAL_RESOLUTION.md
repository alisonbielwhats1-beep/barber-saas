# Tópico 14 — Gate 4.0A: contrato conversacional, somente offline

## Estado e limites

23/09/2026. Branch `codex/secretary-conversational-design`, no worktree
`service-create-mvp`. O Router V1 foi aprovado em execução controlada pelo
responsável; continua desligado por padrão. Este Gate não repete essa execução.
GPT-6 Luna é o interpretador geral, GPT-5.6 Luna rollback temporário. Não há
mudança em runtime, Agent, prompts, schema de interpretação, Policy, catálogo,
parser KEEP_STRICT, banco, flags, credenciais ou efeitos operacionais.

Entregues apenas tipos/primitivas puras de avaliação, testes, especificação de
fixtures e 60 cenários congelados. **Não é uma Secretária conversacional já
integrada.** `DESIGN_TARGET` distingue comportamento proposto de capacidade
atual; `CURRENT_CONTRACT` significa contrato existente, não teste real aprovado.
O novo módulo não é exportado pelo pacote nem importado por `src/lib`/`src/app`.
Por isso não há flag nova necessária neste Gate. Uma integração posterior deve
nascer com flag própria false e rollout independente do Router.

## Auditoria do caminho atual

| Parte | Fonte local | Comportamento comprovado no código / lacuna |
|---|---|---|
| Entrada | `src/app/(admin)/servicos/secretaria/actions.ts`, `salon-secretary-runtime.ts` | Ambiente restrito, ator autenticado, chave dedicada, paid gate, modelo oficial e cost guard. |
| Sessão | `src/lib/salon-secretary.ts` | Por usuário/salão, memória de processo, TTL 20 min, 20 turnos, lock busy; filhos para ações independentes. Sem memória distribuída. |
| Fast-path | `secretary-fast-path.ts`, coordenadores Inventory/Communication/Batch | Horário, amanhã, duração, quantidade inteira e canal apenas quando aguardados inequivocamente. Sim/não não executam. |
| Router | `secretary-router.ts` | Duas strings PROVEN, sessão nova; dúvida → Luna. Nenhuma expansão neste Gate. |
| Extração | `packages/salon-secretary/src/index.ts`, `skill-registry.ts` | Uma Function Tool local, fronteira estrita sem refs; até quatro operações independentes; somente dois padrões dependentes publicados. |
| Entidades | `secretary-scheduling.ts`, `secretary-customers.ts`, `salon-secretary.ts`, `secretary-inventory.ts` | Busca por contains pode resolver automaticamente quando sobra uma linha, sem distinguir correspondência exata de aproximação. Isso **não satisfaz** a nova política de aproximação. Não corrigido no runtime neste Gate. |
| Serviços/profissional | `scheduling-catalog.ts` | Catálogo ativo, vínculos de elegibilidade, no máximo 21 resultados; único profissional é escolhido por elegibilidade antes da disponibilidade. Não existe preferência geral cadastrada na Secretária. |
| Disponibilidade | T07 em `scheduling-catalog.ts`, `visit-scheduling.ts` | Motor de intervalos `[start,end)`, duração/etapas/recursos/jornada/bloqueios; até cinco alternativas reais. Não basta início livre. |
| Requisitos | `service-contract.ts`, `customer-contract.ts`, `scheduling-contract.ts`, manuais Financial/Inventory/Communication | Backend decide campos faltantes, defaults publicados e domínio. Não inferir requisitos da UI pública para cadastro administrativo. |
| Propostas | `service-create-mvp.ts`, `secretary-journal.ts`, handlers de cada Skill | Revisão/hash/TTL/snapshot; confirmação autenticada separada da IA, lock, recibo idempotente e transação. |
| Batch | `scheduling-batch.ts`, `secretary-batch.ts` | Cancel→create, duas ações, slot liberado, all_or_nothing. Não é executor de DAG geral. |
| Communication | `communication-actions.ts`, `secretary-communication.ts` | Cancel→mensagem mesma pessoa, proposta única; cancelamento e Outbox locais transacionais. Fake externo posterior não é entrega real. |
| Correção/troca | Coordenadores | Scheduling invalida refs relacionadas; Customers rejeita alvo novo já selecionado; operação diferente gera OPERATION_MISMATCH. Não há troca de intenção uniforme nem retomada customer.create→appointment.create. |
| Usage | `salon-secretary-usage.ts`, Router trace | Telemetria técnica sem mensagem/PII; store=false, tracing off, retries=0, maxTurns=1, parallelToolCalls=false. |

Ler este documento junto de `SECRETARIA_MVP2.md`, `SECRETARIA_GATE_2_1.md` a
`SECRETARIA_GATE_2_7.md`, `SECRETARIA_FRONTEIRA_ESTRUTURADA.md`,
`SECRETARIA_RECONCILIACAO_TEMPORAL.md` e `SECRETARIA_ROUTER_V1.md`.
Capacidade do painel não implica capacidade publicada no Agent: fechamento geral,
edição de produto, delta de preço, troca de serviço/profissional na remarcação e
DAG de cinco ações não podem ser inventados pela nova camada.

## Arquitetura mínima proposta

`extrair → validar fronteira → resolver no backend → recomputar lacunas →
perguntar fronteira mínima → validar domínio → propor → confirmação autenticada → executor existente`.

Uma futura camada de coordenação deve envolver as entradas/continuações de
`SalonSecretary`, consumindo resultados dos resolvedores existentes; nunca
duplicar SQL, disponibilidade, cálculo ou autorização. Ela mantém foco do item,
pergunta pendente e evidência por campo. Não implementamos um novo Agent nem
um segundo executor. Fast-path existente precede IA. Contexto ambíguo não usa
fast-path; incompleto/compound/mutation vai para Luna, sem pré-router JEV.

## Hierarquia e provenance

| Nível | Evidência necessária | Decisão |
|---|---|---|
| EXACT | Nome completo corresponde de forma única no conjunto completo autorizado | Resolver backend; ainda validar domínio. |
| DETERMINISTIC_BACKEND | Regra publicada + snapshot completo provam única solução | Resolver com regra/versão registradas. Ex.: única profissional habilitada e disponibilidade revalidada. |
| APPROXIMATE_SINGLE_CANDIDATE | Um candidato plausível, sem igualdade exata | Perguntar “Você quis dizer Corte Completo?”; não usar ref como autoridade antes de resposta escopada. |
| AMBIGUOUS | Mais de um candidato ou busca truncada | Opções mínimas/refinamento; nunca primeiro resultado. |
| MISSING_REQUIRED_INPUT | Campo não informado e não resolvível | Perguntar; NOT_FOUND é motivo distinto de ABSENT, não repetir inutilmente “qual cliente?” sem explicar. |
| DOMAIN_CONFLICT | Entidade resolvida mas regra/intervalo/snapshot impede | Explicar e oferecer alternativas exclusivamente calculadas. |
| UNSUPPORTED | Sem contrato publicado/fora da capacidade | Recusar parte não suportada, não substituir operação. |

São estados por campo/item, não uma escala de confiança: pode haver entidade EXACT
e conflito de agenda simultaneamente. Conflito/unsupported impedem proposta válida.
Falha de leitura não equivale a NOT_FOUND. Busca incompleta não prova unicidade.

Proveniência mínima: USER_EXPLICIT; FAST_PATH; LUNA; JEV;
DETERMINISTIC_DERIVATION; BACKEND_EXACT; BACKEND_DETERMINISTIC;
USER_CONFIRMED_APPROXIMATION. Separar `informedByUser` de `extractedBy`: “15h”
foi informado pelo usuário mesmo quando Luna extraiu `15:00`. Refs continuam
backend; confidence do modelo não migra para refs/duração/preço/alternativas.
Guardar dependências e revisão da evidência. Não registrar texto pessoal em
telemetria geral. Snapshots/labels completos só no estado autorizado e mínimo.

A política de busca proposta usa a busca atual como **geradora de candidatos**,
não como autorização. Igualdade exata futura pode ignorar somente caixa e espaços
externos conforme regra documentada; não retirar acentos/sobrenomes, não fazer
fuzzy automático. Neste módulo o adapter de avaliação fornece match EXATO ou
APROXIMADO explicitamente; nenhum algoritmo de similaridade foi introduzido.
Confirmação de aproximação exige pergunta, item, usuário, tenant, revisão, prazo
e candidato atuais; reconsultar antes de vincular no backend real. Não é
confirmação operacional. “A outra Amanda” só pode identificar a única alternativa
de um conjunto apresentado e com escolha anterior conhecida; senão perguntar.

## Matriz de campos por operação publicada

Refs abaixo são pré-condições do **backend**, nunca argumentos autorizados da IA.
“Humano” significa somente se ausente/não resolvível, não perguntar tudo sempre.

| Operação | Obrigatório / condição | Opcionais publicados | Resolvido no backend | Entrada humana restante | Confirmação |
|---|---|---|---|---|---|
| service.create | name, durationMin, priceCents | Nenhum extra no MVP | Validação BRL, duplicidade, normalização conservadora nome | Nome, duração 5–600 min, preço se ausentes | Individual |
| service.change | Alvo resolvido + patch não vazio | name, priceCents, durationMin (pelo menos um) | service_ref, snapshot/preço anterior | Alvo ambíguo; campo/valor novos | Individual |
| customer.search | termo para localizar cliente | Nome/telefone como seletor; não listagem geral vazia | Candidatos tenant-scoped, até 21 | Termo/refinamento/seleção | Não |
| customer.read | cliente único resolvido | Mesmo seletor da busca | customer_ref, cadastro permitido | Desambiguação | Não |
| customer.create | name | phone, email nullable válidos | Duplicidade, regras administrativas | Nome; contato só se desejado, não obrigatório aqui | Individual |
| customer.change | cliente resolvido + patch não vazio; requested_fields pendentes preenchidos | name, phone, email; clear_fields phone/email explícitos | Ref/snapshot/duplicatas | Novo valor; ausência nunca apaga | Individual |
| appointment.create | customer_ref, service_ref, professional_ref, date, time | Seletores nominais/temporais publicados | Refs, timezone, duração/preço/recursos, profissional único, disponibilidade | Cliente/data/hora/serviço não resolvidos; profissional se vários | Individual |
| appointment.change | appointment_ref, date, time | Seletores da origem (cliente/data/hora/profissional/serviço) | Origem única, data original para mudança só de hora quando provada, snapshots | Origem ambígua; novo dia/hora ausentes | Individual; só dia/hora |
| appointment.cancel | appointment_ref, reason | Seletores da origem | Agendamento e status/revisão | Origem ambígua; motivo | Individual |
| schedule.block | professional_ref, date, time, end_time | end_date, reason | Ref, intervalo e jornada compatíveis | Profissional/dia/início/fim ausentes | Individual; não fecha salão |
| availability.get | service_ref, professional_ref, date | time, period | Duração, elegibilidade, intervalos/alternativas | Serviço/data e profissional se ambíguo | Não |
| appointment.list | date | customer/professional/service, time/period conforme filtros do handler | Referências/agenda autorizada | Data/filtros ambíguos | Não |
| appointment.read | date; seleção do appointment no coordenador | mesmos seletores | T05/T06 e detalhes autorizados | Data/seleção | Não |
| financial.report | period salvo outstanding_receivables atual | metrics (default contratual service_revenue), compare_period, group_by limitado | Datas absolutas, agregados, diferenças, percentuais | Métrica/período se insuficientes; forma não suportada requer reformulação | Não |
| product.search | Sem campo obrigatório para lista global | product_name/query, low_stock | Lista atual stock<=minStock, inclusive inativos, até 21 | Nome/refinamento quando filtro explícito | Não |
| stock.balance | product resolvido | product_name como seletor | product_ref, saldo real e unidade un | Produto ausente/ambíguo | Não |
| stock.movement | product, mode IN/OUT, quantity inteira 1–100000 | reason (default publicado Ajuste rápido), kind ADJUSTMENT backend | Ref, snapshot, saldo/delta/projeção, plano | Produto/mode/quantidade se ausentes; caixas não convertem | Individual |
| customer.message | recipient, channel, message_mode, content + contato válido | dependência somente cancelamento conhecido | customer_ref, telefone/contact_revision, elegibilidade | Destinatário/canal/modo/texto; GENERATED só por solicitação | Individual ou grupo cancel→message |

Financial: seis métricas publicadas, seis períodos relativos; saldo atual não
admite período/comparação. Grouping somente service_revenue, sem compare_period;
ranking até dez pelo backend; filtros por entidade/lucro/estorno não publicados.
Communication EXACT preserva bytes; GENERATED exige pedido explícito e preview.
WHATSAPP é fake local, não Meta. Nenhum novo campo de contato é enviado ao JEV.
`action.batch` é coordenador especial de duas ações, não décima nona operação
livre do Registry.

## Minimum clarification e disponibilidade

A fronteira mínima contém campos humanos independentes cujos pré-requisitos
estão resolvidos. Resolver primeiro todo lookup backend já acionável; recomputar
a fronteira antes da pergunta. Ex.: Alisson/amanhã conhecidos → serviço e horário
juntos. Com 10h conhecido → somente serviço. Com serviço conhecido → duração e
elegibilidade calculadas; só perguntar profissional se ainda houver opções.

Não declarar slot livre sem duração, profissional, recursos e intervalo validados.
Serviço de 45 min às 10h conflita com reserva às 10h30 mesmo sem início igual.
Alternativas vêm do motor existente e expiram/revalidam na confirmação; não são
promessa de reserva. Não inventar 10h45/11h30 sem consulta. Não reduzir duração,
remover bloqueio, mover ocupante nem adicionar override de painel não publicado.
Se única profissional habilitada estiver indisponível, oferecer outro horário/dia,
não chamar outra pessoa não habilitada. Escolha explícita incompatível exige
esclarecimento, mesmo se há substituta possível.

## Draft multi-turn, correções e troca de intenção

Contrato proposto: conversation_id/tenant/user backend-only; active_item_key;
draft_ref/revision; campos com evidência; pending_question (id, tipo, campos,
candidate_snapshot, revision, expires); estados ACTIVE/PAUSED/ABANDONED;
histórico append-only. Não persistir nova tabela neste Gate. A integração futura
deve reutilizar journal e TTL/locks, com nova versão de metadados se necessária.

As primitivas puras implementam somente a revisão/invalidação em memória de teste:
correção mantém item/operação, incrementa revisão, retira pergunta/preview e
invalida transitivamente evidências dependentes. Serviço novo invalida ref,
duração, preço, profissional e disponibilidade; cliente novo invalida ref e
appointment/recipient dependente. Alteração de horário invalida disponibilidade.
Não reaproveitar derivado velho enviado junto de correção. Patch ainda precisa
passar pelo schema real da operação antes do helper.

“Sim” confirma significado somente com pergunta de aproximação atual; nunca chama
confirmador. “Não” recusa a hipótese/preview, não cancela Appointment. “15h”,
“amanhã”, “45 minutos” usam fast-path existente se único campo aguardado; “não,
16h”, “o completo”, “Tatiana”, “a outra Amanda” precisam contexto de opções e/ou
Luna. Não implementar um novo parser permissivo neste Gate.

“Esquece isso” explícito abandona draft pendente (preserva histórico, revoga
preview); novo pedido recebe item novo. Nova intenção sem abandono pausa o antigo,
informa isso brevemente e inicia item novo. Retomada exige foco explícito e nova
resolução/snapshot/preview; nunca ressuscita autorização. Intenção incerta pede
“Quer corrigir o agendamento ou iniciar outro pedido?”. Não inferir troca a partir
de uma resposta curta. O runtime atual ainda rejeita trocas incompatíveis; essa
política é **design**, não comportamento já ativado.

Cliente inexistente: oferecer customer.create administrativo separado. Aceitar a
oferta autoriza preparar o cadastro, não gravá-lo; nome obrigatório e contato
opcional conforme contrato. Exibir proposta e exigir confirmação autenticada.
Só após recibo de sucesso re-resolver cliente no tenant e retomar appointment,
revalidando hora/disponibilidade. Falha/recusa bloqueia dependente. Não implementar
genericamente essa dependência no executor atual; dataset mede baseline/gap.

## Multi-action, falha parcial e confirmação

Cada item proposto tem item_key estável, operation publicada, depends_on e
independent (true somente sem dependências), estado e revisão próprios.
Grafo sem ciclos/arestas externas/duplicadas, limite de **design** cinco. O
Registry atual continua max quatro e dois padrões dependentes; não truncar cinco
nem serializar dependências não suportadas como independentes para caber.

Plano independente não é transação global. Leituras autorizadas podem retornar
na ordem do pedido, com resultados claramente separados de propostas de escrita.
Read+write não implica read após write; “depois” exige dependência explícita e,
se não publicada, pedido dividido/esclarecido. Nenhuma leitura autoriza mutation.

Três itens, dois READY e um inválido: mostrar todos os estados. Oferecer corrigir
inválido, cancelar plano, ou confirmar **explicitamente** um item/grupo pronto;
nunca executar dois silenciosamente. Confirmação seletiva já existe por filho
independente; seleção geral de subconjunto/DAG é contrato futuro, não nova API.
Dependente só pode avançar após sucesso comprovado do predecessor, não “proposto”
ou “HTTP 200”. Falha A → B bloqueado. Padrões existentes cancel→create e
cancel→message preservam sua unidade transacional/proposta única. Não prometer
rollback global nem compensação automática de grupos independentes.

Exemplo obrigatório “Cancele a Amanda amanhã, feche meu estabelecimento hoje das
14h às 15h e aumente o preço do Creme em R$10”: cancelamento precisa origem/motivo;
fechamento geral não é schedule.block por profissional; Creme pode ser serviço
ou produto, edição de produto não publicada e preço relativo não é priceCents=1000.
Expor três intenções com bloqueios; não inventar operation nem aplicar parte.

Confirmação operacional permanece chamada autenticada com proposta/hash/revisão/
prazo/snapshot atuais. Uma correção material revoga preview anterior. Confirmação
por grupo só nos dois contratos existentes; nova versão exige nova confirmação.
Texto “sim”, oferta de cadastro, seleção de entidade e resposta de IA não são
autorização. Repetição usa recibo/idempotência existentes por draft/proposta sob
lock; não novo idempotency key por cada retry do usuário. Não repetir efeitos
para cliente, serviço, Appointment, bloqueio, estoque ou Outbox.

## Dataset, métricas e próximo Gate

`packages/salon-secretary/evaluation/hard-conversations.ts` define 60 casos:
15 incompletos, 10 ambiguidades, 10 conflitos, 10 multi-turn, 10 multi-action e
5 adversariais. O JSON congelado contém cada mensagem, turno, fixture,
campos/ações esperados, dependências, pergunta mínima e checkpoint por turno.
Data-base 05/10/2026 09h America/Sao_Paulo, amanhã 06/10. São especificações de
stubs sintéticos, **não fixtures inseridas no banco**. Snapshot limpo por caso;
Alisson/Amandas e serviços não são dados de cliente real. Contatos são apenas
elegibilidade/máscaras no stub; nenhum telefone real. Alteração de snapshot/falha
de dependência é injeção local, não confirmação de mutation.

Métricas e denominadores estão em `conversationMetricDefinitions`: decomposição,
missing-field precision/recall, perguntas desnecessárias, campos inventados,
ambiguidade, resolução de candidato, clarification, continuation, continuidade
de draft, correção, dependências, partial failure, unsafe proposal/execution.
Dados não medidos ficam null; tests de expected não são acurácia de Luna.
Prioridade: invented_field=0, wrong_entity_auto_selected=0, unsafe_execution=0.
Não expor conteúdo sensível na telemetria; apenas categorias/contagens/IDs internos
autorizados. Nenhuma métrica real nova é afirmada neste Gate.

Gate 4.0B será uma bateria controlada de **baseline e contratos**, sem afirmar
que todos os DESIGN_TARGETs já funcionam. Proposta: uma inferência no máximo por
turno em modo avaliação, mocks backend/journal, zero confirmações e zero banco.
Usar o SDK/guard atual para os casos representáveis; limite de cinco ações e
novos estados não representáveis devem ser registrados como GAP/BLOCKED, sem
alterar schema/prompt durante a bateria nem inventar saída. A preparação de um
harness completo e seu dry-run offline ainda é pré-condição do Gate 4.0B;
**este Gate não entrega nem executa um runner pago**. Não usar gabarito como
contexto de extração ou como resposta do modelo. Fixtures fornecem somente
contexto backend permitido; expected fica exclusivamente no scorer.

O manifesto registra máximo conservador de uma inferência para cada turno
congelado, mesmo quando fast-path puder evitá-la, e custo condicional calculado.
Preço é o histórico já aprovado do GPT-6 Luna (não consultado online neste Gate):
input 0,10 / cached 0,01 / cache-write 0,125 / output 0,50 USD/M. Limite futuro
64.000 tokens input e 1.200 output por request; máximo US$0,0086 por inferência
usando maior tarifa de entrada, reasoning incluído no output. Reconfirmar tarifa,
token caps reais, hashes, credencial/projeto e executar dry-run antes da rede.
Flags só no processo futuro; Router false, zero JEV, zero GPT-5.6. Nenhum budget
foi alterado e nenhuma chamada autorizada por este documento.

Parar em campo inventado crítico, entidade errada selecionada, preview inseguro,
efeito indevido, dependência ignorada, mutation sem confirmação, cross-tenant,
hosted tool/container, vazamento de expected/secret/PII, hash drift, orçamento,
timeout/erro provider. Zero retry/correção automática. Gaps conhecidos devem ser
reportados com segurança; não convertidos em aprovação. Finally paid=false,
Router=false. Nova autorização do responsável antes de executar.

## Rollback e limitações

Remover somente os três artefatos `conversational-resolution.ts`,
`hard-conversations.ts`, `hard-conversations-plan.json`, seu teste e documentos
Gate4.0A/4.0B; retirar apenas a entrada deste Gate no STATUS. Não usar reset/clean:
há muitos Gates anteriores ainda não commitados. Não há banco, migration,
permissão, flag ou deploy a reverter. Runtime permanece byte a byte preservado.
RLS/concor­rência PostgreSQL reais não são revalidados por mocks; testes anteriores
continuam como evidência histórica, não nova execução. Cinco ações, intenção
mutável geral e confirmação de aproximação só foram desenhadas/ensaiadas em
primitivas, não integradas à Secretária. Não iniciar WhatsApp, wallet ou Meta.
