# Tópico 14 — auditoria de overlap / encaixe / override

25/09/2026. Branch local `codex/scheduling-overlap-audit`, base `9b92138`.
Alterações anteriores do worktree preservadas. Nenhuma alteração de produto,
fixture histórica, expected histórico, schema, migration, banco ou implantação.

**SCHEDULING_OVERLAP_OVERRIDE = NOT_VALIDATED.** A integração e a microbateria
não foram executadas: a auditoria identificou uma fronteira de contrato que
precisa ser resolvida antes de implementar o fluxo integral pedido.
Minimum Clarification permanece VALIDATED; seu resultado real 5/5 não foi refeito.

## Resultado que impede prosseguir automaticamente

O adapter atômico existente T21 representa exclusivamente **cancelar e criar no
mesmo horário liberado**. `validateBatchPlan`, em `src/lib/scheduling-batch.ts`,
exige `released_slot_of` e rejeita `date`, `time`, `period`, `end_time` e seletores
de origem explícitos na criação. `assess` obtém início e profissional do
cancelamento. `patchBatch(..., {time:"11:00"})` lança `DEPENDENCY_ERROR` e mantém
o plano original intacto. O V2 encaminha esse componente ao mesmo adapter em
`src/lib/secretary-action-plan.ts:actionUnits`.

Assim, continuar esse mesmo batch/draft em **outro horário** não é uma exceção
de agenda já publicada: exige estender o contrato de destino do adapter ou
definir uma transição entre adapters, preservando atomicidade, identidade,
dependência e invalidando a confirmação anterior. Não é correto simplesmente
remover a validação, apagar `released_slot_of`, criar outro draft ou perder o
cancelamento para passar o caso. A instrução deste gate manda parar quando for
necessário inventar um contrato inexistente; nenhuma dessas mudanças foi feita.

Também há um requisito real que precisa aparecer no roteiro: **encaixe exige
motivo, com pelo menos três caracteres**, além da autorização. `Pode encaixar`
não fornece o motivo. Sem um motivo previamente informado, o fluxo correto
precisa perguntar por ele antes de ficar pronto. Não usar essa frase como
motivo automático nem dispensar o requisito. Isso preserva a regra manual.

## Auditoria da autoridade atual

| Item | Autoridade e comportamento observado |
|---|---|
| Duração | `appointment-service.ts:loadServiceSnapshots/inspectAvailabilityUsingServices`: catálogo ativo, vínculo profissional-serviço e soma de `durationMin`; `endAt = startAt + duração`. Preço vigente via `priceServicesForDate`. Visitas calculam cada item em `findVisitPlan` a partir do mesmo catálogo. |
| Intervalo | Semiaberto `[start,end)`, convertido pelo timezone do salão. Contato exato de bordas não sobrepõe; buffer pode tornar a borda indisponível. `scheduling.ts:bufferedWindow` centraliza o buffer. Não há cálculo de duração pelo modelo. |
| Profissional | `availabilityViolation` consulta reservas PENDING/CONFIRMED/IN_PROGRESS do mesmo profissional e tenant com `startAt < fim` e `endAt > início`, incluindo buffer. |
| Jornada | `workingHoursForDate`: jornada semanal e aberturas por data. Pausa, início fora da jornada e término posterior são situações distintas. Travessia para outro dia continua bloqueada, salvo término exclusivo em 00:00 conforme jornada. |
| Fechamento | `SalonClosure` bloqueia. As exceções de jornada/encaixe examinadas não liberam fechamento do salão. |
| Bloqueio pessoal | `TimeOff` mantém seu registro. Há exceção manual autorizada com motivo; não equivale à remoção do bloqueio e não abre disponibilidade pública. |
| Recursos | `ResourceBooking` ativo impede uso simultâneo. A constraint `resource_no_overlap` e os triggers da migration manual 019 são a defesa final, independentemente de `isOverbooked`. Nenhum SQL foi aplicado. |
| Oferta de fila | Oferta OFFERED não expirada bloqueia profissional/recurso. `booking_offer_guard` da migration manual 023 também impede a escrita. Nenhum SQL foi aplicado. |
| Encaixe | `agenda/actions.ts:createAppointmentManually` calcula `canOverride` a partir de OWNER/MANAGER. `appointment-service.ts:requireOverrideReason` valida motivo. Recepção/profissional não podem sobrepor reservas por esse caminho. |
| Persistência | `Appointment.isOverbooked`; fingerprint de idempotência; evento com ator/motivo; `AuditLog` APPOINTMENT_OVERRIDE_CREATE. Edição usa `requestStaffReschedule`, persiste as autorizações e revalida no fluxo correspondente. |
| Pausa | Criação manual aceita OWNER/MANAGER/PROFESSIONAL, com profissional restrito à própria agenda/cliente permitido. Confirmação explícita; motivo opcional para a pausa. Não autoriza automaticamente sobreposição. |
| Jornada ampliada | O código atual também passa `canOverrideSchedule` para OWNER/MANAGER/PROFESSIONAL, com motivo, e mantém fechamento/recursos independentes. Não confundir com `canFinishAfterHours`, nem aplicar uma descrição histórica mais restrita sobre o runtime atual. |
| Alternativas | `scheduling-catalog.ts:getSchedulingAvailability` usa `loadVisitDay/findVisitPlan`, varredura de 15 min, até cinco opções posteriores ao solicitado e futuras. Remarcação usa `inspectAppointmentAvailabilityWithServiceSnapshots`. APIs públicas aplicam janela pública; não reutilizar essa janela como restrição administrativa. |

Não existe hoje uma única função pública que devolva, em conjunto, todos os
conflitos, seus intervalos, minutos de overlap, permissões e alternativas para
os dois caminhos manuais. **DTO unificado: NOT_MAPPED.** Há uma distinção real:

- Reserva manual simples: `createAppointmentManually → createAppointment`;
  admite encaixe nas condições acima.
- Visita manual: `previewStaffVisit/createVisit → findVisitPlan`; admite a
  exceção de jornada, mas bloqueia overlap do mesmo profissional mesmo assim.
- Secretária, criação atual: `getSchedulingAvailability → findVisitPlan` e,
  na confirmação futura, `createVisit`. Não publica override.

Portanto não basta acrescentar um booleano à Secretária e continuar usando
`createVisit`. A futura integração precisa reutilizar a política da reserva
manual apropriada, sem prometer uma proposta que o executor rejeitará.

## Atenção ao código genérico de conflito

`inspectAvailabilityUsingServices` devolve `SLOT_TAKEN` tanto para reserva do
profissional quanto para recurso ou oferta de fila. Recursos/ofertas são
verificados somente quando não há violação anterior. O retorno atual não
carrega o tipo de causa nem todas as causas simultâneas.

**Nunca mapear `SLOT_TAKEN + OWNER` diretamente para override permitido.**
O banco pode proibir o recurso/oferta, mesmo que o código genérico pareça
encaixável. A separação deve ocorrer na autoridade compartilhada antes do
compositor, preservando as restrições já impostas pelo banco. Esta auditoria
não executou uma tentativa operacional nem classificou isso como falha real
da Secretária. Não se alterou a política nem se reproduziu escrita no banco.

## Projeção e preservação de contexto

`loadVisitDay(..., projection)` exclui somente o appointment designado e sua
alocação de recurso. As outras reservas, bloqueios, ofertas e recursos continuam
presentes. `scheduling-batch.ts:assess` exige serviço informado para Fábio e não
copia o serviço de Amanda. O backend calcula o intervalo completo.

O novo teste confirma que 10h com Corte Completo de 45 min resulta em 10h45 e
que a consulta mantém os demais appointments. A diferença entre 10h30 e 10h45
é 15 min; o DTO atual não publica esse número. Não foi criada uma fixture de
banco nem uma nova conversa real para esse exemplo.

O V2 mantém o componente cancel/create, a mensagem dependente e as ações
independentes. Os testes offline históricos x41/x42/x44/x46/x49 passaram;
isso não prova ainda o novo fluxo de override em 3/5/10 ações.

## Estado dos cenários solicitados

| Cenário | Resultado desta etapa |
|---|---|
| Serviço ausente e preenchido no segundo turno | Regressão histórica offline PASS; lógica preservada |
| AVAILABLE, duração/intervalo, fechamento, recursos, permissões | Regras existentes auditadas e testes unitários existentes executados |
| Projeção cancel → create | Contrato existente auditado; intervalo/exclusão caracterizados offline |
| Conflito overridable apresentado pela Secretária | NOT_IMPLEMENTED; não testado ao vivo |
| Override inicial e resposta “Pode encaixar” | Intenção ainda não publicada; motivo obrigatório não pode ser inventado |
| “Outro horário” no mesmo batch/draft | CONTRACT_GAP reproduzido: DEPENDENCY_ERROR |
| Cancel → create + message; cinco ações com override | NOT_IMPLEMENTED; dependências antigas preservadas |
| Alternativas após conflito, correção multi-turn e permissão insuficiente na nova UX | Não validados no novo fluxo |

## Verificação e evidência

Novo arquivo: `src/lib/__tests__/scheduling-overlap-contract-audit.test.ts`.
São três testes de caracterização de guards existentes, não novos expected
para uma integração parcialmente implementada. Nenhum gabarito histórico mudou.

Comando focado: `node node_modules/vitest/vitest.mjs run
src/lib/__tests__/scheduling-overlap-contract-audit.test.ts
src/lib/__tests__/appointment-service.test.ts
src/lib/__tests__/visit-scheduling.test.ts
src/lib/__tests__/scheduling-batch.test.ts
src/lib/__tests__/secretary-conversational-ux.test.ts
src/app/(admin)/agenda/manual-create-security.test.ts --maxWorkers=2`.
Resultado: **109 testes, 6 arquivos PASS**.

`npm test -- --maxWorkers=2`: **2.465 testes, 276 arquivos PASS** (128,87 s).
`npm run lint`, `npx tsc --noEmit --incremental false` e `npm run build`: **PASS**.
Logs e hashes estão no manifesto de auditoria em
`packages/salon-secretary/evaluation/results/scheduling-overlap-audit/`.
Essa execução não inclui testes PostgreSQL nem preflight real: não houve
integração candidata que pudesse liberar a fase paga.

OpenAI/Luna/JEV: **0 requests, 0 tokens, US$0**. Latência de modelo/backend/DB
da microbateria: **N/A**, pois ela não começou. Nenhuma conversa nova observada.
Zero novas mutations, confirmações, Outbox ou mensagens externas emitidas nesta
etapa. Banco não acessado; não se apresenta um snapshot atual como verificado.
O snapshot validado anteriormente continua evidência histórica, não uma nova medição.

Flags V2/paid/JEV OFF nos processos de teste/build. V2 ausente em `.env.local`
continua OFF pelo default; paid/JEV explicitamente false. Hash do arquivo
preservado: `7548c4ec20d910575fe635e03c9e3e067fd8187741752630ac481909b7b1a5d8`.

## Decisão necessária e sequência mínima posterior

Autorizar explicitamente a extensão do contrato T21 para permitir destino
alternativo escolhido pelo usuário, mantendo cancelamento e criação atômicos,
mesma identidade do plano/drafts, dependência e invalidação de proposta.
Preservar o motivo obrigatório de encaixe com uma pergunta adicional quando
ausente. A frase de consentimento não pode suprir esse motivo.

Depois dessa definição: extrair a avaliação manual compartilhada e seus
conflitos tipados; ligar preview/continuação/proposta/executor à mesma política;
testar os 15 cenários; congelar mensagens/oracles; aprovar tecnicamente os
guards locais e somente então usar a autorização condicional de inferência.
Não há requests/orçamento de uma bateria nova congelados neste estado bloqueado.

Rollback desta etapa: retirar apenas o novo teste e este relatório/entrada de
status. Nenhum rollback de produto ou banco é necessário. Preservar todos os
artefatos anteriores. Zero correções de produto utilizadas do limite de duas.
A regressão final do Tópico 14 permanece pendente da integração; não foi criada
outra grande bateria, nem iniciado Front/Meta/deploy.
