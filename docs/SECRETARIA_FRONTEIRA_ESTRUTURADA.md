# Auditoria integral da fronteira estruturada — Gate 2.5

## Causa, semântica e representação

Em `packages/salon-secretary/src/skill-registry.ts`, o teste anterior de
`independent` rejeitava `item_key != null` junto com arestas e origem de slot.
Confundia identidade local com relação de dependência. O coordenador em
`src/lib/salon-secretary.ts` já remove item_key/depends_on/released_slot_of antes
de produzir patches e gera suas próprias referências de sessão/operação.

`item_key` é rótulo local opcional, validado pelo regex `[a-z][a-z0-9_]{0,31}`.
É preservado quando fornecido, sem gerar IDs, conceder acesso ou virar referência
de banco. Ausência/null continuam representando falta de rótulo; não se inventa
rótulo. Rótulos presentes precisam ser únicos no plano, inclusive independente.

`independent=true` significa nenhuma aresta e nenhuma origem `released_slot_of`.
Pode haver de zero (fora do catálogo) a quatro operações, com ou sem rótulos.
`independent=false` exige identidades locais, ao menos uma aresta, destinos neste
plano, sem duplicatas/ciclos/self-reference. Não é inferido da presença de rótulos
nem corrigido automaticamente em caso de inconsistência.

Representação canônica das arestas: sempre `depends_on: string[]`; ausência/null/[]
viram []. Uma lista não vazia nunca é apagada ou convertida em operação independente.
Campos e rótulos dos itens são preservados, sem mutar o objeto recebido.

`validateSelection` agora valida a coerência estrutural do grafo antes dos handlers.
O executor existente continua sendo a autoridade para o padrão suportado: duas
operações Scheduling, cancelar → criar, origem de slot igual à dependência,
disponibilidade projetada, confirmação e atomicidade. `validateBatchPlan` não foi
alterado. Grafos de outras combinações não ganham executor. Uma referência local
precisa existir no mesmo objeto; nenhuma sessão externa é consultada para resolvê-la.

## Matriz completa dos campos de descoberta

O = obrigatório no transporte; P = opcional; N = null aceito. Objetos são strict.
Não há coerção de strings em número/boolean, nem normalização global de null.

| Campo(s) | Classe / transporte | Vazio, null e omissão | Validação semântica |
|---|---|---|---|
| skills | O, array de enum publicado, até 4 | [] só acompanha operations=[]; null/omissão inválidos | conjunto deve corresponder às operações; U01/autorizações independentes |
| independent | O, boolean, discriminador do plano | null/omissão/string inválidos | arestas e origem de slot incompatíveis com true |
| operations | O, array de objetos, até 4 | [] é fora do catálogo; null/omissão inválidos | nenhuma execução quando vazio; Batch tem limite próprio de 2 |
| operation | O, enum/discriminador publicado | null/omissão/"" inválidos | pertence à Skill; requisitos/autorização do domínio |
| item_key | P/N, identificador local | ausência/null sem rótulo; "" inválido | único no plano; obrigatório em dependentes; nunca ID de domínio |
| depends_on | P/N, array de strings, até 2 | ausência/null/[] → [] | sem tipos mistos; arestas únicas, destino local existente, sem ciclos/self; Batch exige aresta real |
| released_slot_of | P/N, referência LOCAL | ausência/null sem origem; "" não é normalizado | exige aresta correspondente; domínio exige chave válida e slot real derivado |
| target_name | O/N, string até 200 | null preserva; omissão inválida; "" não é convertido | busca/resolução e tamanho mínimo no domínio; não é ref |
| name | O/N, string até 200 | null preserva; omissão inválida; "" não é convertido | normalização Services / validação Customers; não é ref |
| priceCents, durationMin | O/N, números | null preserva; omissão inválida; strings/boolean/arrays inválidos | inteiros/faixas/requisitos no domínio; proibidos no Scheduling |
| phone, email | O/N, strings até 32/320 | null preserva; omissão inválida; "" não significa autorização de clear | regras reais de contato; remoção explícita por clear_fields |
| requested_fields | O, array enum name/phone/email | [] sem pedido; null/omissão inválidos | Customers: campo pedido sem novo valor solicita informação |
| clear_fields | O, array enum phone/email | [] sem remoção; null/omissão inválidos | Customers: remoção explícita permitida pelo domínio; nunca inferida de string vazia |
| customer_name, service_name, professional_name | P/N, strings trim 2–200 | null/omissão preservam; "" inválido | resolução tenant-scoped, homônimos e elegibilidade no backend |
| date, source_date, end_date | P/N, string YYYY-MM-DD | null/omissão preservam; "" inválido | validade de calendário/timezone no domínio; precedência e reconciliação temporal |
| day_offset, source_day_offset | P/N, inteiro 0–365 | null/omissão preservam; 0 válido | seletor relativo resolvido pelo backend |
| weekday, source_weekday | P/N, inteiro 0–6 | null/omissão preservam; 0 válido | mutuamente exclusivo com outros seletores do mesmo lado |
| time, source_time, end_time | P/N, string HH:mm | null/omissão preservam; "" inválido | intervalo, jornada, disponibilidade, reconciliação temporal |
| period | P/N, enum morning/afternoon/evening | null/omissão preservam; "" inválido | coerência com hora; nunca inventa hora concreta |
| reason | P/N, string trim até 200 | null/omissão preservam; "" não vira default | motivo não vazio obrigatório para cancelamento; regra existente no domínio |
| financial | P/N, objeto strict | null/omissão não traz patch; []/"" inválidos | permitido somente financial.report |
| financial.metrics | P/N, array de 1–6 enums de métricas | null/omissão usam requisito/default existente; [] inválido | vazio não vira silenciosamente outra métrica |
| financial.period, financial.compare_period | P/N, enum de 6 períodos | null/omissão preservam; []/"" inválidos | recebível é saldo atual; comparação/intervalo calculados no backend |
| financial.group_by | P/N, enum professional/service | null/omissão sem agrupamento; []/"" inválidos | somente service_revenue, sem comparação agrupada |
| timezone, salonId, tenant, role, *_ref, IDs, SQL | proibidos no output | rejeitados mesmo vazios/null | contexto e referências exclusivamente do servidor |

Campos de outras Skills não podem carregar dados: validações cruzadas existentes
rejeitam nome/preço/contato genéricos em Scheduling/Financial, dados Scheduling
fora da Skill e objeto Financial fora dela. A normalização de dependências não
altera essas condições. Nomes são critérios de busca, nunca IDs.

Enums publicados: Skills services/customers/scheduling/financial; operações
service.create/change, customer.search/read/create/change,
appointment.create/list/read/change/cancel, availability.get, schedule.block e
financial.report. Financial.metrics: service_revenue, realized_revenue,
received_revenue, completed_count, average_ticket, outstanding_receivables.
Financial.period/compare_period: today, yesterday, this_week, last_week,
this_month, last_month. Nenhum valor fora desses enums é reinterpretado.

Arrays requested_fields/clear_fields são decisões explícitas do protocolo atual,
não campos opcionais. Mantidos estritos: não foi necessário ampliá-los para corrigir
os outputs reais. Strings vazias não são transformadas em ausência; algumas passam
no transporte e são rejeitadas/solicitadas como faltantes pelo domínio. Isso evita
confundir “não informado” com apagar um valor existente. A auditoria não promete
que todo JSON plausível é válido: a matriz acima é a fronteira publicada.

## Contratos de continuação do mesmo Agent

Fonte: `packages/salon-secretary/src/index.ts`, `scheduling-skill.ts`,
`financial-skill.ts`. Não foram alterados.

| Contrato | Campos / diferenças em relação à descoberta |
|---|---|
| Services | name/priceCents/durationMin obrigatórios nullable; operation P/N enum create/change; target_name P/N string 2–200. Null removido antes de U03. |
| Customers | operation obrigatório nullable enum search/read/create/change; target_name/name/phone/email obrigatórios nullable; requested_fields/clear_fields arrays obrigatórios. |
| Scheduling | operation obrigatório nullable enum de agenda; todos os campos schedulingFields P/N com os mesmos tipos/faixas da matriz. Operação null preserva a atual. |
| Scheduling Batch | item_key obrigatório não-null, regex local; schedulingFields P/N. patchBatch resolve somente item existente no plano atual; não há edição de arestas via continuação. |
| Financial | quatro campos do objeto financial P/N conforme matriz. Sem números calculados, SQL, refs ou escrita. |

Em todos: objeto strict; exatamente uma Function Tool por resposta; status do
provedor completed quando informado; uma inferência no Runner; nenhuma hosted tool.
Dados semânticos passam depois por requisitos, validação e autorização existentes.

## Golden outputs reais (15)

`src/test/fixtures/secretary-real-outputs.json` contém somente argumentos do modelo,
nome da Tool, modo, proveniência relativa e SHA-256 dos argumentos originais.
Nenhuma chave, project/request/response/session/tenant ID ou usage foi copiado.
Nomes são os sintéticos das fixtures, não dados reais. Os argumentos JSON não foram
“corrigidos” para os testes passarem; apenas formatados.

- Gate 2.1: Services, continuação Services, Customers, composto independente e fora do catálogo.
- Gate 2.2: Scheduling create e continuação.
- Gate 2.3: remarcação, cancelamento, bloqueio e interpretação de período.
- Gate 2.4: Batch cancel/create dependente e continuação de serviço.
- Gate 2.5: Financial com depends_on=null e Financial com item_key=a/independent=true.

Cada captura atravessa `runServicesTurn`/Agents SDK com fake e, na descoberta,
`validateSelection`. Os dois outputs Financial também atravessam SalonSecretary →
T09 real com SQL mockado retornando 12000 centavos. T09 não foi alterado.
Casos derivados/mutados para segurança são testes separados, não rotulados como
outputs reais. Fixtures de regressão em arquivo não modificam fixtures do banco.

## Limites e revalidação preparada (não executada)

Testes locais não comprovam banco vivo nem qualidade futura do modelo. Nenhum
validator deduz uma dependência que o modelo omita integralmente (sem aresta nem
origem de slot); não foi introduzido parser textual para isso. Uma dependência
declarada nunca é apagada nem convertida em execução independente.

Após nova autorização: revalidar descartável/OWNER/timezone/fixture R$120 e flag
false; uma única pergunta “Quanto faturei ontem?”, uma inferência, zero retry,
zero confirmação/escrita financeira. Capturar resposta bruta e seleção canônica,
comprovar T09 e período/valor. Retornar flag a false em finally. Não testar os outros
quatro cenários. Usar observação que não lance validação antes do wrapper de usage,
para que eventual rejeição do boundary não oculte o usage já retornado pelo provedor.
Esse cuidado é do futuro roteiro de ensaio; o código de usage não foi alterado.

## Validação local

`npm test`: 1427 testes em 233 arquivos aprovados (integrações PostgreSQL excluídas
pelo comando padrão). Inclui 79 casos adicionais nesta revisão em relação à suíte
anterior de 1348: golden outputs, plano independente com identidade, grafo inválido,
matriz de todos os campos do transporte, opcionais Financial, referências proibidas
nas continuações e segundo output Financial no coordenador/T09. As regressões de
Services/Customers/Scheduling Core/Actions/Batch e Progressive Disclosure passaram.
`npm run lint`, `npx tsc --noEmit --incremental false` e `npm run build`: aprovados.
Build com segredo NextAuth sintético apenas no processo, sem alterar configuração
persistente. Nenhuma chamada OpenAI; flag false. Banco/fixtures reais
não acessados nem modificados; somente nova fixture JSON de regressão.

## Rollback

Reverter somente os blocos de identidade/grafo e a condição de independent em
skill-registry.ts, preservando a correção anterior depends_on null→[]. Reverter as
mudanças deste turno em secretary-selection-boundary.test.ts e remover o novo
secretary-plan-boundary.test.ts, o JSON de golden outputs e este documento.
Não restaurar diretórios completos: contêm Gates anteriores aprovados ainda sem
commit. Sem rollback de banco, credenciais, prompt ou T09.
