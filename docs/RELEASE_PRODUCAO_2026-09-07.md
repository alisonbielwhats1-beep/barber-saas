# Release Everflair — PR #79

Autorização explícita do responsável: “faça o deploy e merge em produção e
atualize o github”. A autorização cobre a entrega do PR #79 e suas dependências
018/019. As restrições anteriores de somente homologação são históricas.

## Identificação e homologação

- Repositório: `alisonbielwhats1-beep/barber-saas`; branch `codex/product-experience`.
- Base produtiva anterior: `a66a98b2e3a819548b3a8402228738310a12a787`.
- Código homologado: `69ea087c3b118f14fe194c70dd61b4fd1f268632`.
- CI: https://github.com/alisonbielwhats1-beep/barber-saas/actions/runs/34076406663.
- Lint, TypeScript, build e 693 testes Vitest passaram; schema-smoke com
  aplicação/reaplicação, restauração sintética, preservação, RLS e rollback passou.
  Sete testes PostgreSQL específicos de 019, 32 de concorrência/tenant,
  recuperação e convites passaram. Foram aprovadas 42 jornadas autenticadas
  e 32 verificações públicas; quatro casos fora da matriz Chromium foram pulados.
- Vercel: projeto `salon-saas`, `prj_qBERQKNhW0BjEsMaJHuft66TMYiy`,
  domínio https://salon-saas-ruby.vercel.app, branch Production `master`.
- Supabase: `barber-saas`, `vshnatkzxdekkvqttvbv`, região sa-east-1, PostgreSQL
  17.6, database `postgres`. Identidade confirmada pela API e dashboard.

## Backup e recuperação

O plano Free não disponibiliza backups automáticos. Foi criado backup lógico
das três tabelas existentes afetadas (`Service`, `Appointment`,
`AppointmentService`), incluindo colunas, constraints, índices, policies,
triggers, funções de triggers e grants. É um backup delimitado à migration,
não um dump integral do projeto ou dos objetos Storage.

Criptografia OpenPGP RSA 3072/AES-256 realizada dentro do banco antes da saída
dos dados pelo conector. Arquivos e chave privada ficam fora do Git, em diretório
com ACL restrita ao usuário do Windows e SYSTEM:
`%USERPROFILE%/.codex/backups/everflair/production-2026-09-07/`.
Preservar o diretório `keys` junto do arquivo `affected-tables.pgp`.

Decifragem em memória e validação do checksum concluídas às 02:58:46 UTC:
493077 bytes, 140 serviços, 407 agendamentos e 411 vínculos.
SHA-256 do conteúdo original:
`5b6d107055d85713aded2f44b69a33af0a5ac254e2b0e501ded292f2195c5b86`.
Não houve cópia de dados produtivos para banco de desenvolvimento/teste, nem
gravação de conteúdo decifrado em arquivo, logs ou artefatos do GitHub.
A restauração funcional de dados fictícios já foi validada no CI; o backup real
foi conferido por decifragem, formato, contagens e checksum, sem restauração.

O rollback desta release é voltar a aplicação ao código anterior e manter as
estruturas aditivas e o histórico. Não remover tabelas/colunas novas; os triggers
de recursos continuam protegendo as reservas. Recuperação de dados a partir
do backup, se necessária, exige planejamento para preservar escritas posteriores
e autorização específica; não restaurar automaticamente nem sobrepor registros.

## Execução produtiva e verificações

Antes das escritas: 12 estabelecimentos, nenhuma tabela/coluna nova presente,
extensões pgcrypto/btree_gist disponíveis, índices compostos referenciados
presentes, durações legadas válidas e nenhum vínculo órfão/cruzado de clientes.
Preflight 018 versionado passou em transação somente leitura.
Depois de 018, preflight separado de 019 conferiu database, schema predecessor,
btree_gist, role de runtime, duração dos serviços e vínculo cliente/tenant.
A identidade do projeto foi fixada no argumento do conector em todas as chamadas.

SQL das migrations executado sem alterações pelo `apply_migration` do Supabase:

| Migration | Versão Supabase | Resultado |
|---|---|---|
| 018 | `20260907025919` / `product_018_openings_checkin` | Aplicada e verificada |
| 019 | `20260907025941` / `product_019_product_depth` | Aplicada e verificada |

Os scripts verify de 018/019 passaram. Sete tabelas com RLS ENABLE/FORCE;
`app_runtime` sem superuser e sem BYPASSRLS. Constraints e triggers esperados
presentes. Históricos de migrations manuais/Supabase não foram confundidos com
`_prisma_migrations`; migrations antigas não foram reaplicadas.

Comparação de todos os valores das colunas anteriores, excluindo somente as
colunas adicionadas, com mesmos fingerprints antes/depois:

| Tabela | Registros | MD5 da agregação JSONB ordenada |
|---|---:|---|
| Service | 140 | `543a12c67050fb8e90de8bcd0eb9e761` |
| Appointment | 407 | `1a9a6c9a41f7c275cb8e97af24930f61` |
| AppointmentService | 411 | `25c725093629e807ae74cad8a83eff63` |

Nenhum seed, reset, db push ou teste de escrita foi executado em Production.
Nenhuma mudança em billing 011, serviços pagos, gateways ou mensagens automáticas.

## Publicação da aplicação

A publicação usa merge em `master` seguido do build Production da integração
Git da Vercel, após checks/Preview do commit final. Não promover o build Preview,
pois suas barreiras de ambiente são diferentes das de produção.

Resultado final (merge SHA, deployment READY, conferência de rotas e runtime)
registrado no PR: https://github.com/alisonbielwhats1-beep/barber-saas/pull/79.
O checkout principal com alterações locais de Scrollcraft foi preservado.
