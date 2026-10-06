# T21 — destino alternativo e encaixe

Gate local de 25/09/2026. Estado de validação final registrado ao término em `packages/salon-secretary/evaluation/results/t21-extension/closure.json`. Nenhum deploy ou migration faz parte deste gate.

## Contrato antes/depois

Antes: `cancel(a) -> create(b)` exigia o horário da reserva cancelada. Uma hora explícita no create era `DEPENDENCY_ERROR`.

Agora: o modo omitido continua significando `SAME_RELEASED_SLOT`. `destination_mode=ALTERNATIVE_SLOT` permite data/hora explícitas para o mesmo profissional, preservando `released_slot_of`, `depends_on`, action keys, draft e plan_ref. Não há seleção arbitrária de outro profissional. A extensão requer `SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED=true`; por padrão permanece false.

`Outro horário` limpa o destino anterior e a intenção de encaixe. A resposta apresenta alternativas calculadas pelo Scheduling. A escolha seguinte altera somente o destino do create. O cancelamento, sua justificativa, Communication EXACT e ações independentes continuam no mesmo plano.

## Autoridade compartilhada

`appointment-service.ts/inspectAppointmentAvailability` resolve snapshots de serviço, duração, fuso e intervalo completo. A Secretária usa essa mesma inspeção, além do planejador existente `findVisitPlan`. O modelo não retorna duração, preço, disponibilidade ou referências reais.

`appointment-overlap-policy.ts` publica a política compartilhada de overbooking: OWNER/MANAGER, causa de conflito elegível, intenção explícita e motivo de pelo menos três caracteres. A agenda manual importa a mesma lista de papéis; `createAppointment` continua sendo o executor e a autoridade de auditoria. A Secretária não recebe permissão adicional.

O inspector agora distingue `APPOINTMENT`, `RESOURCE` e `WAITLIST`, inclusive quando coexistem. Antes um overlap profissional podia mascarar outra causa na inspeção, embora as constraints de recurso/fila já impedissem o efeito no banco. Só `SLOT_TAKEN` acompanhado exclusivamente de conflito de appointment admite a política de overbooking. `SLOT_TAKEN` isolado nunca basta.

Fechamento, recurso reservado, oferta de fila, horário passado e falta de permissão não admitem esse encaixe. Pausa, TimeOff e exceções de jornada possuem autorizações próprias na agenda manual; este contrato não as confunde com overbooking nem as concede. Elas permanecem bloqueadas na Secretária e não são apresentadas como passíveis de encaixe.

## Duração e projeção

Na troca, a inspeção ignora exclusivamente o appointment de `a`. As demais reservas, recursos e ofertas permanecem visíveis. Amanda 10h–10h30 e próximo atendimento às 10h30 não liberam 45 minutos: Corte Completo termina às 10h45 e produz 15 minutos de sobreposição.

O review retorna `AVAILABLE`, `CONFLICT_OVERRIDABLE` ou `CONFLICT_HARD_BLOCK`, duração/intervalo calculados, causa, intervalo conflitante, minutos de sobreposição, permissão e alternativas. O compositor recebe uma pergunta canônica do adapter, evitando repetição e campos técnicos.

## Consentimento e motivo

`Pode encaixar` registra intenção, mas mantém `NEEDS_INPUT` sem motivo. A pergunta é “Qual o motivo do encaixe?”. Um motivo fornecido inicialmente é preservado. Extrações de intenção e motivo precisam ser demonstráveis na mensagem; `sim` isolado não autoriza encaixe. Uma intenção anterior não autoriza automaticamente outro serviço/horário quando o modelo a repete na correção.

Proposta de encaixe contém aviso explícito e motivo. Isso não confirma mutation. Qualquer execução futura revalida disponibilidade, papel, snapshot e motivo. Materialmente alterados, os dados invalidam a proposta anterior.

## Atomicidade e auditoria

`confirmActionBatch` continua recebendo uma única transação de `withTenant`. Mantém locks, reavaliação projetada, cancelamento e criação sequenciais na mesma transação. A única troca no executor é delegar o create normal ao `createVisit` existente e o encaixe ao `createAppointment` manual. Nenhum deles abre outra transação. Falha do destino propaga antes do recibo e faz a transação externa abortar.

O teste offline de atomicidade verifica identidade de `tx`, ordem cancel→create e propagação da falha sem recibo. Não é apresentado como uma execução real de cancelamento/rollback no PostgreSQL: neste gate confirmações reais são proibidas. O limite transacional de produção permanece o já existente.

O executor manual conserva ator, tenant, motivo, marca `isOverbooked` e AuditLog de override. A bateria observa apenas drafts/proposals/logs técnicos. Communication dependente continua subordinada ao cancelamento confirmado e ao Outbox; nenhum envio ocorre nesta validação.

## Evidência histórica e regressões

x41/x42/x44/x46/x49 são reavaliados somente offline. Seus textos, fixtures, rubrica e journals não foram modificados. Os antigos manifests reais rejeitam o runtime T21 alterado. Os testes de arquivo histórico usam fontes arquivadas cujo SHA-256 continua exatamente igual ao manifest original; nenhum pin histórico foi atualizado.

O teste de tipos do schema incorpora somente os três novos campos autorizados: modo de destino, booleano de intenção e motivo textual. Não flexibiliza chaves, referências, tenants ou operações desconhecidas.

## Validação nova e rollback

Casos novos x90–x94, dez turnos, máximo dez requests e US$0,13. Controle PostgreSQL sem IA em x80–x84; fixtures reais separadas x90–x94. Preparação é create-once, com dump anterior e preservação integral dos cinco tenants históricos. Preparação de fixtures não é confundida com efeitos operacionais da Secretária.

O harness reutiliza journal durável com fsync, wire witness, snapshots, provider diagnostics, contador independente e guards de rede. Apenas start/send são expostos. Não há retries ou retomada de turno parcialmente executado.

Rollback imediato: manter a nova flag OFF, V2 OFF, paid calls=false e JEV Router=false. Não apagar journals, tenants de teste ou baseline histórico. Propostas contendo novos campos/encaixe não podem ser confirmadas com a extensão desabilitada. O endurecimento da classificação de recursos/fila no backend manual conserva as restrições já existentes do banco.

Próxima etapa, somente após validação: REGRESSÃO FINAL DO TÓPICO 14, usando a suíte offline e as evidências já coletadas; sem nova grande bateria, Front, Meta ou deploy.
