# Gate 4.0B.3.1A — restore local limpo para revalidação futura de i01

Em 24/09/2026, somente o PostgreSQL sintético e descartável da Phase A foi
preparado. Nenhuma inferência OpenAI/JEV, `--revalidate-i01`, execução Phase A,
confirmação, operação de negócio ou deploy foi realizada.

## Fonte, identidade e restore

O único archive usado foi
`packages/salon-secretary/evaluation/results/phase-a-ready-before-paid-battery.dump`
(325.801 bytes, SHA-256
`28c02b254017e4be377591898ec30e31e1405e22868d4de790597269bb6f6093`).
O hash foi conferido antes do `pg_restore`; o archive é do PostgreSQL 16.15 e
do banco `everflair_service_mvp`. O dump pós-tentativa não foi usado.

O diretório do cluster novo PostgreSQL 16.15 já havia sido inicializado com
`initdb` nativo na etapa anterior, mas não tinha sido iniciado nem recebido
dados. Nesta autorização, sua estrutura foi conferida e ele foi iniciado
somente em `127.0.0.1:55442`. A role local `mvp_test_admin` criou
apenas `mvp_service_runtime` (LOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB,
NOCREATEROLE) e o banco vazio canônico. `pg_restore --single-transaction
--exit-on-error` terminou sem erro. Para satisfazer a validação de caminho do
preflight congelado, o cluster novo foi parado e **a pasta inteira** foi movida
dentro de `%TEMP%` para
`everflair-service-mvp-phasea-i01-0498461a8b4e4df3a39c243004c80f7c`;
nenhum diretório interno do PostgreSQL foi fabricado ou copiado. Ele foi
reiniciado em `55442` e validado novamente antes da troca de portas.

## Validação antes da troca, em 55442

O schema restaurado tem 63 tabelas, 41 policies e 34 tabelas com RLS e FORCE
RLS. As 19 tabelas exigidas pelo harness têm ambas as flags. `prisma migrate
diff --from-url ...:55442/everflair_service_mvp --to-schema-datamodel
prisma/schema.prisma --exit-code` retornou `No difference detected`.
O hash do ACL de objetos públicos foi igual ao do cluster anterior
(`e1227c724d2bfeaae5cc6958665c1956`); a role runtime tem 35 grants de
tabela em `information_schema.role_table_grants`. A role runtime comprovou
`rolsuper=false` e `rolbypassrls=false`.

O preflight congelado fixa a porta `55441`. Para validar **antes** da troca,
`packages/salon-secretary/evaluation/results/phase-a-restore-port-preflight.cjs`
foi usado apenas localmente, com URLs alteradas em memória para `55442`. O
script verificou o mesmo manifest e os predecessores congelados, chamou o
mesmo `precheckPhaseACase` para os 26 casos e conferiu identidade, role e RLS.
SHA-256 desse script de evidência ignorado pelo Git:
`e0a9e721a27c27c2c397058f1f449fae9c71054bc891a72d4426024e6a0a8ccd`.
Resultado: `PHASE_A_PREFLIGHT_OK_RESTORED_PORT`, 26/26 casos, 28/28 turnos,
isolamento verificado pela role runtime nos 26 tenants, `AuditLog=0` e
`NotificationOutbox=0`. Contagens sintéticas: 26 salões, 104 clientes, 156
serviços, 52 profissionais, 7 appointments e 52 produtos.

## Troca e estado final

Antes da troca, o cluster anterior em
`%TEMP%/everflair-service-mvp-phasea-d93c9dcc5c14412098b306f925c7a3d7/data`
continuava em `55441`, com três `AuditLog`. Seu dump pós-tentativa permaneceu
com SHA-256 `96f2415cd21f87a6c624040da4cae6a6fa5cec9e57d08625581cb153cd7c0031`.
Após o preflight de `55442`, `pg_ctl -m fast -w stop` parou primeiro o novo
cluster e depois o antigo; `pg_ctl -o '-h 127.0.0.1 -p 55441' -w start`
iniciou o novo na porta canônica. Nenhum dado antigo foi apagado. O data
directory antigo permanece íntegro e desligado; a porta `55442` não escuta.

Em `127.0.0.1:55441/everflair_service_mvp`, o comando **original**
`node scripts/run-hard-conversations-phase-a.cjs --preflight` terminou com
`PREFLIGHT_ONLY`, 26 casos, 28 turnos, 19 tabelas RLS/FORCE e
`network_calls=0`. Verificação adicional após a troca confirmou 26 salões,
`AuditLog=0`, `NotificationOutbox=0`, os mesmos 35 grants e hash ACL, e runtime
`rolsuper=false`/`rolbypassrls=false`. Manifest Phase A:
`11f3ea7f8e04d5ccca7723b9f3575bde3a275e332f744453f63568b4b2dabbaa`.

`.env.local` permaneceu: `APP_ENV=test`, `SALON_SECRETARY_MODEL=gpt-6-luna`,
`SALON_SECRETARY_JEV_ROUTER_ENABLED=false` e
`SALON_SECRETARY_ALLOW_PAID_CALLS=false`. A autorização para uma inferência
`REVALIDATE_i01` continua separada e ausente.

Rollback de infraestrutura, se necessário: parar **somente** o cluster limpo
que escuta em `55441`, confirmar seu data directory, e reiniciar o cluster
antigo preservado em `127.0.0.1:55441` com `pg_ctl` nativo. Não restaurar sobre
o antigo nem remover seus três AuditLogs. O dump pré-bateria aprovado continua
disponível para reconstrução limpa futura. Nenhum código funcional, migration,
grant ou arquivo de configuração foi alterado neste Gate.
