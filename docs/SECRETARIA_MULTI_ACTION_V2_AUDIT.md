# Multi-Action V2 — auditoria anterior à alteração

24/09/2026. Base local `9b92138`, worktree `service-create-mvp`, com Gates
anteriores ainda não commitados. `origin/master` atualizado via fetch; não se
misturou a release posterior com esta base. Branch `codex/multi-action-v2`.
Sem inferência, banco, containers, Meta, publicação ou deploy.

## Runtime anterior

| Área | Evidência local | Contrato observado |
|---|---|---|
| Seleção | `packages/salon-secretary/src/skill-registry.ts` | Objeto estrito skills/independent/operations; máximo 4 Skills e 4 operações. Campos nullable não equivalem a remoção. requested_fields/clear_fields obrigatórios. |
| Registry | mesmo arquivo | 6 Skills, 18 operações publicadas; operationSkill valida operação e Skill. loadSkills deduplica manuais/version/hash. |
| Dependências | validateSelection | item_key local opcional para independentes, obrigatório para dependentes; depends_on null/ausente normaliza []; máximo 2 pais no transporte. Rejeita duplicatas, ciclos, refs ausentes, Skills/campos incompatíveis. |
| Coordenação independente | `src/lib/salon-secretary.ts`, sendAutomatic | Sessões-filhas, confirmação individual, até 4; erro na preparação cancela todos os filhos. Sessão em memória, journal de domínio persistente. Limite de sessões por usuário também restringiria N filhos. |
| Batch | `src/lib/scheduling-batch.ts` | items[], mas BATCH_MAX_OPERATIONS=2 e destructuring cancel/create. Apenas cancel→create/released_slot_of, all_or_nothing. |
| Draft | upsertBatchDraft/patchBatch | Revisionado, expira; campos e refs por item. Retorna primeiro faltante (prefixado pela chave), snapshot conjunto ou BLOCKED. |
| Proposta/confirmação | proposeActionBatch/confirmActionBatch, `secretary-journal.ts` | Hash, revisão, prazo, lock, revalidação backend; replay de recibo e mesma transação tenant-scoped. |
| Disponibilidade projetada | assess → schedulingSnapshot | Exclui apenas a reserva que será cancelada. Duração, preço, profissional, recursos, buffer e [start,end) vêm do backend; mesmo profissional do slot liberado. |
| Ordem | validateBatchPlan/confirmActionBatch | Ordenação topológica restrita ao par, cancelamento antes de createVisit; falha reverte ambos. |
| Comunicação | `secretary-communication.ts`, `communication-actions.ts` | Outro par especial cancel→message, mesmo cliente. Cancelamento + Outbox atômicos; despacho fake depois do commit. EXACT extraído de aspas, sem normalização. |
| Partial failure | coordenação e batch acima | Indep.: invalida filhos no catch global. Batch: all_or_nothing, sem status arbitrário por ação. Falha de despacho fake não desfaz negócio. |
| Router | `secretary-router.ts` | Somente duas entradas exatas PROVEN. Compound direto Luna. Guard, store=false, zero hosted tools/containers permanecem. |

## u02: causa específica UNKNOWN

Evidência read-only: `evaluation/results/ultimate-10-continuation-u02-u10.jsonl`,
request `req_ea8a32d21b0146589039cb04a9e91981`: HTTP 200, JSON de argumentos
válido, uma select_capabilities, status completed, selection_schema_valid=false,
SDK_RESPONSE_CREATED e AGENT_MODEL_RESPONSE_CREATED. Não houve draft/proposta
nem efeito operacional. O status canônico anterior não incorporava essa tentativa;
deve ser complementado, sem editar os journals históricos.

O booleano chama **validateSelection**, não apenas selectionSchema.safeParse
(`ultimate-10-post-http.ts`, summarize). Assim, pode significar violação Zod OU
regra semântica. Não registra issue.path, código ou argumentos. O campo exato é
UNKNOWN, sem atribuição automática ao GPT-6 Luna.

Possibilidades auditáveis, não diagnóstico histórico: chave desconhecida; campo
obrigatório ausente/null indevido; enum/formato/data/hora/range; mais de 4 operações
ou Skills; mais de 2 dependências; operação fora do Registry; Skill divergente;
chave repetida/inexistente, ciclo, released_slot_of sem aresta; independent com
dependências; mistura de campos entre Skills; combinação Scheduling/Communication
fora do par permitido. Quatro ações em si NÃO violam max(4). Um cancel→create +
service.change + financial.report pode passar validateSelection e ainda ser
recusado depois por sendAutomatic/UNSUPPORTED_BATCH. Não confundir essa restrição
posterior com a causa desconhecida do booleano. O novo teste será uma fixture
sintética equivalente à intenção, nunca uma reconstrução dos argumentos históricos.

## Overlap / override manual: SUPPORTED_CURRENTLY

`src/app/(admin)/agenda/actions.ts` valida confirmação/motivo/papel; passa
canOverride, canOverrideWorkingHoursBreak, canOverrideTimeOff, canOverrideSchedule.
`src/lib/appointment-service.ts`, requireOverrideReason e createAppointment,
revalida exceções separadas e audita. Overbooking de dono/gerente só após conflito;
TimeOff exige motivo, pausa confirmação própria, autonomia de jornada validada
pela operação manual. Fechamento geral e recurso físico continuam bloqueios.
`visit-scheduling.ts`, findVisitPlan, mantém overlap a<d && b>c, jornada,
fechamentos, reservas e recursos. Secretária não publica campos de override;
sua interpretação desses pedidos é NOT_MAPPED. Nenhuma nova exceção será criada.

## Decisão de contrato

Manter select_capabilities como representação intermediária estrita. O backend
constrói actions[], grafo, estados e grupos; o modelo não escolhe prontidão,
confirmação, refs, autorização ou disponibilidade. V1 preservada por flag OFF.
Generalizar coordenação e revisão sem generalizar automaticamente os executores
atômicos especializados; adapters sem semântica comprovada falham fechados.
