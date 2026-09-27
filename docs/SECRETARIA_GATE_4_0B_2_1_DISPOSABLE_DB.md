# Gate 4.0B.2.1 — PostgreSQL descartável da Phase A

Restaurado em 24/09/2026 exclusivamente para a Phase A local. **Nenhuma
inferência foi executada.** O manifest permaneceu com SHA-256
`11f3ea7f8e04d5ccca7723b9f3575bde3a275e332f744453f63568b4b2dabbaa`;
o manifest predecessor permaneceu com
`b8c4c39b9ea338dbd2cbe80b9fe9f2efeb940391109da034b11bb480cbb0076e`.

## Origem e procedimento

O cluster antigo em `%TEMP%/everflair-service-mvp-762536beeefa4a74b9c2ab5f1dfc3406/data`
contém `PG_VERSION=16`, mas não contém `pg_notify`, `pg_twophase`,
`pg_commit_ts` nem `pg_dynshmem`. O log local registra `FATAL: could not open
directory "pg_notify"`. Hash SHA-256 do log:
`f4207981a2524a60947c9ac786aaf62946be5ade48a31cc18e541239399b49f9`.
Esse cluster **não foi reparado, iniciado ou apagado**. Uma inicialização inicial
sob sandbox falhou por token restrito do Windows; o diretório parcial não foi
usado. O cluster válido foi criado posteriormente com o `initdb`/`pg_ctl`
nativos descritos em `SECRETARIA_MVP_SERVICO.md`, sem Docker, e escuta somente
`127.0.0.1:55441`.

Cluster válido: `%TEMP%/everflair-service-mvp-phasea-d93c9dcc5c14412098b306f925c7a3d7/data`.
PostgreSQL `16.15`; banco `everflair_service_mvp`. A autenticação é `trust`
**somente no loopback** deste cluster temporário, como no procedimento do MVP;
não é configuração para servidor compartilhado. `mvp_test_admin` é superuser
local, usado apenas para criação, restore, backup e fixtures. A role
`mvp_service_runtime` é LOGIN, `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`,
`NOCREATEROLE`, sem CREATE no banco ou schema público.

O schema foi restaurado **sem linhas históricas**, por `pg_restore --schema-only
--exit-on-error --single-transaction`, do backup sintético pré-reset
`%TEMP%/everflair-gpt6-v2-DUuRbs/pre-reset.dump`, identificado em
`SECRETARIA_GATE_3_1B_GOLDEN_V2.md`. Seu SHA-256 é
`368202f5847a1d9f9dab8c2460028d328973cc5469aae15ee6debf9ec5b0afaa`.
Somente as roles sintéticas locais necessárias foram criadas. Não se reexecutou
SQL manual de produção nem se declarou migration aplicada. O comando read-only
`prisma migrate diff --from-schema-datasource prisma/schema.prisma
--to-schema-datamodel prisma/schema.prisma --exit-code` retornou **0 / No
difference detected**. O schema restaurado contém 63 tabelas, 41 policies e 34
tabelas com FORCE RLS; as 19 exigidas pelo harness têm ENABLE e FORCE. ACLs e
policies vieram do backup aprovado, sem relaxamento posterior. `ClientProfile`,
`Product` e `Payment` preservam SELECT colunar do runtime.

## Isolamento e fixtures

Antes da Phase A, dois salões/clientes exclusivamente sintéticos foram criados
para um probe RLS, após dump de backup. Consultas com
`mvp_service_runtime`, sem filtro de tenant no SELECT, retornaram: contexto A
`1` próprio e `0` de B; contexto B `1` próprio e `0` de A; contexto ausente `0`.
Essas quatro linhas foram removidas por ID exato antes do `--prepare`; Salon e
ClientProfile voltaram a zero. Após a preparação, consultas pela mesma role em
tenants reais da Phase A confirmaram i01/i02 com `4` clientes visíveis cada e
zero do outro tenant. Em m03, o runtime viu `4` clientes, `6` serviços, `2`
appointments e `2` produtos próprios, com zero registros de m07 em cada tabela.
Sem contexto, ClientProfile retornou zero. O preflight também passou pelos
helpers tenant-scoped do runtime.

`node scripts/preflight-hard-conversations-phase-a.cjs --dry-run` validou os
manifests e os 118 hashes predecessores: 26 casos, 28 turnos, cinco variantes
de fixture. `node scripts/run-hard-conversations-phase-a.cjs --prepare` criou
26 salões isolados com 26 memberships OWNER, 104 clientes, 156 serviços, 52
profissionais, 728 jornadas, 7 appointments e 52 produtos; Outbox e AuditLog
começaram em zero. Cada caso passou pelo precheck de nomes, relações, status,
snapshots, agenda e conflito previsto. O segundo `--prepare` retornou
`seeded=0`, `backup=null`, 26/26 e 28/28. Em seguida,
`node scripts/run-hard-conversations-phase-a.cjs --preflight` retornou
`PREFLIGHT_ONLY`, 26 casos, 28 turnos, `paid_calls=false`, `network_calls=0`
e 19 tabelas com RLS/FORCE. Nenhum draft ou proposal prévio foi encontrado.
Witness/counters permanecem os componentes offline já testados no Gate 4.0B.2;
o modo `--execute` não foi invocado.

Verificações do checkout após a restauração: 32 testes direcionados do
harness/bridge, 258 arquivos e 2.241 testes da suíte geral, `npm run lint`,
`npx tsc --noEmit --incremental false` e `npm run build` passaram. O build usou
fonte simulada local e segredo NextAuth sintético somente no processo. O
`schema-smoke` CI não foi disparado: nenhum schema/migration do repositório foi
alterado, e sua suíte de seed/migrations não deve escrever no banco Phase A já
preparado. A equivalência do schema foi verificada pelo diff read-only do Prisma
e a segurança por consultas PostgreSQL reais com a role runtime.

## Dumps e rollback

Antes das fixtures, o próprio harness criou
`%TEMP%/everflair-phase-a-yNbFsW/before-fixtures.dump`, 279.804 bytes,
SHA-256 `b756e17a02663971c335ce9d1e551849615fbbc82a42efd0b6f5b88f0b3158d1`.
Foi copiado, com hash idêntico, para
`packages/salon-secretary/evaluation/results/phase-a-before-fixtures.dump`.

Após `--preflight`, `pg_dump -Fc` criou
`packages/salon-secretary/evaluation/results/phase-a-ready-before-paid-battery.dump`,
325.801 bytes, SHA-256
`28c02b254017e4be377591898ec30e31e1405e22868d4de790597269bb6f6093`.
`pg_restore -l` reconheceu o archive e o banco de origem. A pasta `results/`
é ignorada pelo Git; os dumps contêm apenas dados sintéticos locais e não foram
staged. O dump pronto é a referência para comparar/retornar ao estado anterior
à futura bateria paga. A restauração de qualquer dump deve ocorrer somente em
um banco local descartável inequivocamente identificado e vazio, com decisão
administrativa explícita; o runner não destrói nem reseta tenants. Para encerrar
o cluster, usar `pg_ctl -D <data directory acima> -m fast -w stop`, após conferir
o diretório com `SHOW data_directory`. O cluster antigo continua preservado.

`.env.local` permaneceu ignorado/não tracked, `APP_ENV=test`, modelo
`gpt-6-luna`, Router=false, paid calls=false e projeto OpenAI aprovado. Não
houve chamadas OpenAI, JEV, Meta, banco remoto, deploy ou confirmação. A futura
Gate 4.0B.3 exige autorização separada e novo precheck, inclusive tarifa vigente
e orçamento; este Gate não a executa.
