# MULTI-ACTION V2 — CONTROLLED VALIDATION

Atualização de 24/09/2026: o recorte de Controlled Validation solicitado no
benchmark conversacional foi executado e passou **15/15 turnos** com SDK/runtime
e PostgreSQL reais, respostas sintéticas e zero OpenAI/JEV. Após esse PASS, a
bateria real explicitamente autorizada realizou 15 inferências. Ver
[resultado](SECRETARIA_MULTI_ACTION_BENCHMARK_RESULT.md), incluindo limitações,
falhas de clarificação mínima e flags finais OFF. A matriz abaixo é a preparação
histórica mais ampla; nem todos os ramos de execução/confirmação foram exercitados
em PostgreSQL, pois o benchmark proibiu confirmações e efeitos operacionais.

Estado original: preparado, NÃO EXECUTADO. Este documento, sozinho, não é
autorização de inferência.

## Escopo proposto

1. Revisar o delta V2, seus limites e os resultados offline do Tópico 14.
2. Fixar manifest próprio V2 com hashes atuais, fixtures e expectativas separadas
   de Hard Conversations/Ultimate históricos. Não atualizar seus selos anteriores.
3. Verificar payload strict real gerado pelo SDK e dimensionar orçamento de saída
   para 5/7/10/12+ ações, sem aumentar orçamento/custo silenciosamente.
4. Instrumentar diagnóstico sanitizado: JSON parse, nome da tool, caminho/código
   Zod ou guarda semântica específica, contagem de ações/arestas, stop reason,
   request_id/usage quando presentes. Nunca guardar segredo/raw pessoal.
5. Com autorização e ambiente descartável inequivocamente identificado, validar
   adapters reais PostgreSQL: projeção cancel→create, Outbox EXACT, falha/replay,
   tenant/role, expiração e revisão. Não iniciar container neste Gate preparatório.
6. Somente após autorização explícita de modelo, casos, requests, orçamento e stop
   conditions, conduzir inferências controladas Multi-Action V2. JEV fica OFF;
   compound DIRECT_LUNA. Provider OpenAI store=false, hosted tools/containers zero.

## Matriz preparada

| Caso | Evidência exigida |
| --- | --- |
| 1/3/4 | Compatibilidade e confirmação sem efeitos na interpretação |
| Equivalente novo de u02 | Quatro ações; Corte Completo literal; componente + independentes |
| 5 | NORMAL_REVIEW e faltantes por item |
| 7/10 | ADVANCED_REVIEW, seis Skills e preview completo |
| 12–14 | SPLIT_REVIEW com cobertura integral e componentes intactos |
| Cadeia >10 | SPECIAL_REVIEW, execução comum recusada |
| Falha A→B/C | Dependentes não executam; independentes só com aprovação explícita |
| Correção | Mesmo plano; aprovação anterior revogada; irmãos preservados |
| Ciclo/referência inválida | INVALID_DEPENDENCY_GRAPH, zero execução |

Critérios de parada futuros: primeira falha de segurança, erro de isolamento,
mutation sem confirmação, afirmação EXACT sem pré-requisito, tool desconhecida,
store/hosted/container drift, truncamento ou estouro de orçamento. Sem retry oculto.

Este Gate não repete u01/u02, não inicia u03–u10, não promove resultado estrutural
a PASS de modelo e não altera evidência histórica. Não iniciar Front/Meta ou deploy.
Ao encerrar a preparação, PARAR.
