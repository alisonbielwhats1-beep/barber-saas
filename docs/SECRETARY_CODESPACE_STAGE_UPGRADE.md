# Secretária — compatibilidade do staging histórico

25/09/2026. Preparação autorizada exclusivamente no Codespace existente
`glorious-enigma-jjv6v4rvrv49f544r`, DB `everflair_billing_staging` em
127.0.0.1:5432. Não é uma autorização de mudança em Production.

## Preflight e baseline efetivos

Identidade PostgreSQL 16.15: data_directory `/var/lib/postgresql/data`, system
identifier `7682424799483236389`. Runtime `app_runtime`, SUPERUSER/BYPASSRLS/
CREATEDB/CREATEROLE false. Schema histórico: 61 tabelas, 117 policies, 58 tabelas
RLS/FORCE; User e PlatformInvoice/PlatformInvoiceEvent são as exceções históricas.
Appointment/Product/Service/ClientProfile/AuditLog/NotificationOutbox retornam
zero linhas sem contexto. Prova cruzada com dois tenants ainda pendente (o
inventário encontrou menos de dois; não se transformou teste vazio em PASS).

Backup AES-256-GCM, chave separada com modo 0600 e diretório 0700, permanece no
Codespace, sem exportação de dados ou credenciais:
`/workspaces/everflair-billing-staging/.demo/secretary-readiness-2026-09-25T14-59-20-361Z`.
Arquivo `before.dump.aes`, SHA-256
`71c05282379512840786a2654b4d7270937b2b2bc921a034c8984f9fd24fb201`.
Descriptografia em memória comparada byte a byte; `pg_restore -l` PASS.
Isso valida legibilidade do arquivo, não equivale a restore completo ensaiado.
`before.json` guarda hashes de todas as linhas, ACLs, column grants, policies,
roles e identidade. Hash da serialização dessa baseline:
`24823ad8797b6d9f954b9d9ef79df365c9484994775721060d35f75a89a4d536`.

Cliente oficial PostgreSQL 16.15 instalado apenas no container da aplicação.
Nenhum servidor novo criado; pacotes auxiliares libpq5/libpq-dev também foram
atualizados pelo apt. A instalação não muda o servidor PostgreSQL existente.

## Delta aplicado somente no staging em 25/09/2026

O checkout histórico `6122e6e` antecede o candidato. O login atual seleciona
User.authIdentityId mesmo com AUTH_PROVIDER ausente; a coluna não existe.
ClientProfile.authIdentityId, AuthIdentity e os dois campos de convite também
estão ausentes. Não contornar o login nem relaxar policies para compatibilizar.

Aplicadas somente as migrations já publicadas/versionadas, após preflight:

| Migration existente | SHA-256 do conteúdo normalizado LF |
|---|---|
| 20260913110000_professional_invite_profile_fields/migration.sql | 476fe74a179309a8f9cb894b093eea7f690a1cd6e92fff328bf98130640f9ee8 |
| 20260920191414_supabase_auth_identity/migration.sql | e1ad9e25d5e5f9ededa01696e4346c975ec44d93910d1011c2fab3b5c07a4a3d |

Não executar prisma migrate deploy sobre histórico parcial, db push, seed
genérico ou todo o diretório de migrations. BillingPlanChange também está
ausente; billing permanece OFF e não integra o smoke da Secretária.

A migration de identidade cria RLS/FORCE e policy somente na tabela nova,
conforme contrato publicado; não altera policies tenant existentes. Permissões
da nova AuthIdentity seguem exatamente esse SQL, sem grants temporários locais.
AUTH_PROVIDER, Supabase, SMTP e integrações externas permanecem desativados.

## Verificação e recuperação

COMMIT_SUCCEEDED: ambas em uma transação com assertions antes de COMMIT.
As 61 tabelas anteriores mantêm os mesmos hashes de linhas, excluindo somente
as novas colunas nulas; todas as 117 policies, ACLs e a role anterior foram
comparadas. A comparação independente pós-commit também confirmou igualdade
integral dos grants por coluna anteriores, policies, ACLs e atributos da role.
Os seis acessos sem contexto continuam retornando zero linhas. AuthIdentity
nova tem RLS/FORCE e os grants previstos pelo SQL publicado; provider OFF.
Evidências duráveis no diretório do backup: apply-and-verify.sql, apply.log,
upgrade-result.json e post-upgrade.json. Zero mutation de negócio no upgrade.
O banco tinha zero tenants: isolamento cruzado requer fixtures, não foi
declarado PASS a partir de uma consulta vazia.

Falha antes de COMMIT: ROLLBACK transacional. Depois de COMMIT, rollback do
deployment para o checkout anterior, mantendo colunas/tabela aditivas, como
determina rollback.md publicado. Não apagar vínculos ou restaurar backup por
cima de alterações posteriores. Se necessário recuperar o banco integralmente,
usar o backup preservado somente neste destino, com nova conferência de identidade
e janela sem writers. Nenhum restore destrutivo está sendo executado.

STAGING_PREFLIGHT_OK ainda não emitido. Candidato transferido e verificado;
faltam configuração operacional, smoke e prova completa de isolamento/rollback.
O responsável autorizou explicitamente as chamadas da API OpenAI; nenhum custo
adicional de infraestrutura autorizado. Paid calls OFF até preflight operacional.
