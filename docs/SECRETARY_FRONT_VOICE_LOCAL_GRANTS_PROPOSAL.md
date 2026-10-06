# Ajuste proposto exclusivamente ao PostgreSQL descartável

Atualização final: mecanismo novo de snapshot/restore VALIDATED, com igualdade integral AFTER_ROLLBACK=BEFORE, RLS/isolamento preservados e nenhum grant temporário restante. [Fechamento final do Gate](./SECRETARY_FRONT_VOICE_FINAL_CLOSURE.md). A proposta e o incidente abaixo permanecem como histórico; o mecanismo atual gera a restauração a partir de cada snapshot, em `scripts/secretary-front-final-closure.ts`.

Status em 25/09/2026: AUTORIZADO pelo responsável, APLICADO e REVOGADO. Retomada interrompida antes de qualquer fixture/mutation de negócio. O rollback original abaixo estava incorreto: REVOKE em nível de tabela também removeu SELECTs preexistentes por coluna. Os 18 SELECTs anteriores foram restaurados e comparados com o snapshot. Nenhum grant novo permanece.

Ver [resultado e incidente](./SECRETARY_FRONT_VOICE_LOCAL_GRANTS_RESULT.md) e [rollback corrigido](./SECRETARY_FRONT_VOICE_LOCAL_GRANTS_ROLLBACK.sql). O restante desta proposta é o registro histórico do SQL autorizado; não reutilizar isoladamente os REVOKEs abaixo.

Banco identificado: 127.0.0.1:55441/everflair_service_mvp, cluster local em Temp/everflair-service-mvp-…/data.
Runtime: mvp_service_runtime, NOSUPERUSER, NOBYPASSRLS. RLS e FORCE RLS continuam ativas.

A role foi criada para o Gate de executor com SELECT por coluna. O Front manual consulta também descrição, preço, custo, categoria e imagem de Product, e gender em ClientProfile. As consultas reais atuais retornam SQLSTATE 42501. Serviços e o shell abrem; não é erro de autenticação ou de regras da Secretária.

Proposta: conceder SOMENTE SELECT nas duas tabelas já consultadas pelo Front manual:

```sql
GRANT SELECT ON "Product", "ClientProfile" TO mvp_service_runtime;
```

Não concede INSERT/UPDATE/DELETE, não muda policies/GUCs/papéis do produto. RLS continua filtrando linhas. Antes: novo pg_dump, capture completo de grants e preflight. Depois: verificar isolamento de tenant com SELECT sem contexto e tenant fixture, e executar os casos UI. Não usar admin no runtime.

Rollback exato ao final:

```sql
REVOKE SELECT ON "Product", "ClientProfile" FROM mvp_service_runtime;
```

Correção da premissa original: os SELECTs por coluna NÃO sobreviveram ao REVOKE em nível de tabela. O rollback corrigido restaura explicitamente as colunas do snapshot e verifica equivalência dos privilégios. Nenhuma alteração no código/policies produtivos. Dumps e fixtures permanecem preservados.

## Adendo da auditoria de Agenda (mesma sessão)

A Agenda também falha ao selecionar `Payment.id`; a role já pode ler `appointmentId`, `amountCents`, `currency` e `paidAt`. Ajuste mínimo posteriormente autorizado, aplicado e revogado nesta tentativa:

```sql
GRANT SELECT (id) ON "Payment" TO mvp_service_runtime;
```

Rollback adicional: `REVOKE SELECT (id) ON "Payment" FROM mvp_service_runtime;`.
A autorização mais recente do responsável incluiu expressamente este adendo, além de Product/ClientProfile. Nenhum privilégio além desse escopo foi ampliado; a recuperação apenas recompôs SELECTs anteriores.
