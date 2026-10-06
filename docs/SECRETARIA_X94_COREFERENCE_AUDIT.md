# x94 — auditoria de correferência e parada segura

25/09/2026, branch local `codex/x94-coreference-audit`.

| Frente | Resultado desta etapa |
| --- | --- |
| Correferência segura | NOT_IMPLEMENTED — vínculo inequívoco não demonstrado com a provenance disponível |
| Adversariais do novo mecanismo | NOT_RUN — não foi criado um resolvedor para testar |
| Regressão focada existente | PASS — 30 testes, evaluator e T21/overlap |
| x94 | FUNCTIONAL_FAILURE_SAFE histórico preservado; revalidação não iniciada |
| HARD_BLOCK E2E | NOT_PROVEN; permanece VALIDATED_OFFLINE |
| Segurança da investigação | PASS — banco e evidências preservados; zero inferências/efeitos |
| Tópico 14 | INCOMPLETE |

Foi acionada a condição de parada expressa no item 20: não implementar uma solução que dependa de heurística insegura. Não se alterou runtime, evaluator, prompts, expected, fixtures, permissões, schema, migrations ou regras de Scheduling. Não se abriu outra bateria.

## O que existe e o que falta

| Informação | Implementação e limite observado |
| --- | --- |
| Source text | `startBatch(..., sourceMessage)` recebe a mensagem; o resultado real e o journal preservam a mensagem original. |
| Mention spans | `scheduling-entity-mentions.ts` localiza menções literais com limites de tokens para impedir confusão entre serviço e nome de cliente. Não vincula pronomes a pessoas. |
| Entity resolution | `customer-catalog.ts/searchSalonCustomer`, dentro de `withTenant`, retorna candidatos autorizados. `scheduling-batch.ts/assess` seleciona automaticamente apenas candidato único ou exige seleção. |
| Resolved refs | `assess` preenche `customer_ref` no draft. Identificam o cadastro, não o referente de um pronome. |
| Field provenance | ActionPlan registra `intention=LUNA` e `assessment=BACKEND`. Isso indica origem, não spans ou prova semântica de cada campo. |
| Explicit/implicit subject | Não foi encontrado contrato de binding de sujeito/pronome usado por esse fluxo. |
| Grounding metadata | `groundSchedulingException` recebe patch, estado anterior e mensagem. Não recebe antecedente validado, conjunto de candidatos ou prova linguística. |
| Dados linguísticos | `ClientProfile.gender` é opcional. O catálogo publicado não o seleciona. O seed não o preenche; consulta diagnóstica confirmou NULL para Amanda e Fábio em x94. Gênero cadastral, mesmo quando preenchido, não deve ser automaticamente equiparado a preferência de pronome sem contrato. |

Não é correto afirmar que Fábio já havia sido resolvido pelo backend na execução que falhou. O modelo extraiu `customer_name="Fábio Santos"`; o guard interrompeu `startBatch` antes de `prepareBatch`/`assess`. Nesta auditoria, a consulta read-only pelo mesmo catálogo demonstrou um único cadastro para Fábio e um para Amanda. Isso prova identidade por nome, não correferência.

## Evidência específica de x94

Original: “Cancela Amanda Souza amanhã às 10h por pedido dela e coloca Fábio Santos no lugar para Corte Completo, mesmo que dê conflito, porque ele já está aguardando.”

Motivo original: **“ele já está aguardando”**.

Motivo retornado na execução anterior: **“Fábio já está aguardando”**.

As pessoas explicitamente nomeadas são Amanda Souza e Fábio Santos. O cadastro identifica ambas univocamente. Não há, porém, binding persistido que exclua um referente concorrente e comprove a compatibilidade de “ele” com Fábio. “Dela” também é um pronome: não foi tratado como uma declaração explícita ou um binding já validado de Amanda.

Não se conclui que a leitura humana ou a interpretação do modelo esteja errada. Conclui-se que a prova exigida pelo novo contrato não está disponível no caminho atual. Usar o primeiro nome como evidência de gênero, escolher o nome mais próximo ou escolher o cliente de `appointment.create` introduziria precisamente os atalhos proibidos. A substituição `ela → Fábio` também não pode ser rejeitada por um suposto gênero inferido do nome enquanto `ele → Fábio` é aceita pelo mesmo atalho.

Classificação da limitação: **provenance/contrato insuficiente para aceitar a expansão**, com rejeição determinística do runtime. Não foi demonstrado um bug que possa ser corrigido com mera normalização ou serialização. A reprodução offline continua produzindo `OVERRIDE_REASON_NOT_GROUNDED`.

O motivo original e o texto observado foram registrados lado a lado em `audit.json`, com posição no enunciado e `resolution=NOT_PROVABLE_FROM_EXISTING_PROVENANCE`. Isso é evidência diagnóstica; não foi injetado um certificado fictício de resolução no ActionPlan.

## Banco e preservação

Consulta somente leitura em `127.0.0.1:55441/everflair_service_mvp`. Role runtime `mvp_service_runtime`, sem SUPERUSER/BYPASSRLS, 19 tabelas com RLS/FORCE RLS. Precheck de fixture/isolamento passou usando os cinco AuditLogs técnicos aprovados de x94, sem apagá-los.

Snapshots completos de x94 antes/depois coincidem com o fechamento anterior. Snapshots de x90–x93 e x41/x42/x44/x46/x49 também permaneceram idênticos. Outbox=0, confirmations=0, operational writes=0. Nenhuma mensagem externa ou chamada OpenAI/Luna/JEV foi feita. Nenhum draft/proposal novo foi criado.

As quatro flags permaneceram OFF, inclusive no finally do script. `.env.local`, resultado real anterior, snapshot anterior, guard, casos e normalizador do evaluator tiveram hashes conferidos antes/depois. Não houve preflight para liberar inferência: os checks do banco foram usados somente na investigação, e não substituem o guard de implementação não satisfeito.

## Testes e resultado consolidado

Comando executado nesta etapa:

```text
npx vitest run src/lib/__tests__/topic14-evaluator.test.ts src/lib/__tests__/t21-overlap.test.ts --maxWorkers=2
```

PASS: 30 testes / 2 arquivos. Inclui reprodução da rejeição real de x94, distinção de campos estritos/EXACT, evaluator e hard block diante de insistência. Não se apresenta essa rodada como validação dos 15 requisitos de um novo mecanismo de correferência, que não foi implementado.

Suíte geral de 2.506 testes, lint, TypeScript e build PASS continuam evidência do gate anterior; não foram repetidos nem alegados como uma nova regressão final. A parada ocorreu antes da implementação e da rede.

| Caso | Resultado preservado |
| --- | --- |
| x90 | PASS |
| x91 | PASS |
| x92 | PASS |
| x93 | PASS |
| x94 | FUNCTIONAL_FAILURE_SAFE; não reexecutado |

Novas requests=0; tokens novos=0; custo novo=US$0. A latência histórica de x94 permanece HTTP 7,025 s / E2E 7,616 s, 3.706 tokens, US$0,000662800. Não há conversa, ActionPlan ou medição de modelo novos para reportar.

## Correção mínima e evidência necessária

Uma aceitação futura precisaria reutilizar a resolução tenant-scoped existente e levar ao guard um binding demonstrável entre span original, referente e motivo estruturado. Deve manter texto original/resolvido, validar a mesma entidade, preservar o predicado e a negação, registrar a origem da prova e invalidá-la após mudança material. A busca por nome sozinha não fornece essa prova.

Sem um binding linguístico confiável no contexto, o caminho seguro é manter fail-closed ou coletar esclarecimento explícito do referente. Isso é uma alternativa funcional a decidir, não uma correção aplicada nem uma alteração silenciosa de x94. Não se propõe preencher gênero por suposição, modificar a fixture congelada ou aceitar automaticamente “Fábio” só para passar o caso.

Para fechar exatamente o x94 congelado é necessária uma regra determinística de binding cuja evidência exista nesse enunciado/contexto e que também exclua os adversariais exigidos. Esta auditoria não demonstrou essa regra; não inventou uma. Nenhuma nova inferência será útil para suprir a ausência de prova por si só.

Impacto: pedidos com motivo literalmente ancorado mantêm o comportamento anterior. Expansões pronominais podem falhar antes do domínio, bloqueando este fechamento funcional; não autorizam execução insegura. Nenhuma alteração foi implantada e as flags continuam OFF. Rollback de runtime não é necessário. Preservar os artefatos; não restaurar banco nem excluir logs.

## Arquivos desta etapa

- `scripts/audit-x94-coreference.cjs`: auditoria read-only, HTTP bloqueado, snapshots e escrita exclusiva/fsync de evidência.
- `packages/salon-secretary/evaluation/results/x94-coreference-audit/audit.json`: consultas, motivo original/observado, hashes, flags e snapshot.
- `packages/salon-secretary/evaluation/results/x94-coreference-audit/regression.log`: 30 testes PASS.
- Este relatório, nota em `STATUS_ATUAL.md` e atualização pontual da matriz V1.

`MINIMUM_CLARIFICATION_UX = VALIDATED` e `MULTI_ACTION_V2 = VALIDATED` preservados. `SCHEDULING_OVERLAP_OVERRIDE = NOT_VALIDATED`; `TOPIC_14_SECRETARY_BRAIN_V1 = INCOMPLETE`. Sem Front, Voice, Meta, deploy ou novo gate aberto automaticamente.
