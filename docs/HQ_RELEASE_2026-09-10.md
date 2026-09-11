# Everflare HQ — validação e aplicação da fundação 020
Atualizado em 10/09/2026, horário de Brasília.

## Autorização e destino
O responsável confirmou: “usa o de produção mesmo, só tenho ele por enquanto”
e “prossiga”. Usar o projeto existente como destino de operação. Os testes
continuam exclusivamente no PostgreSQL descartável do CI.
Esta decisão dispensa um segundo projeto para esta entrega; não autoriza
testes destrutivos nem cópia de dados de produção para desenvolvimento.
Projeto: barber-saas, vshnatkzxdekkvqttvbv, sa-east-1, PostgreSQL 17.6.
Vercel: salon-saas, prj_qBERQKNhW0BjEsMaJHuft66TMYiy.
Production anterior: 9840388, dpl_7bZjTcfnzxcAMgpqgMc1SH2cKGRq.

## Evidência obtida
CI 34546774574, commit 9298483, passou nos jobs check e schema-smoke.
Migration 020 aplicada/reaplicada no PostgreSQL 16 descartável após
backup/restauração sintética. Fingerprint de todas as tabelas anteriores
permaneceu idêntico. Sete testes HQ de CRUD, concorrência, relações e RLS
passaram. RLS exercitada como role NOSUPERUSER/NOBYPASSRLS.
Jornada cria lead, converte, confere histórico e bloqueia visitante/usuário
comum. Foram capturadas oito telas em 1440, 1024, 768 e 390 pixels, sem
overflow de página e sem violações nas regras axe executadas. Capturas
inspecionadas: dashboard desktop/mobile e pipeline mobile.
Depois da atualização com master 9840388: 164 arquivos/793 testes locais
passaram, lint e TypeScript passaram. Dois testes adicionais de suporte,
bug/feedback e filtros serão validados no CI final.

## Recuperação delimitada à migration
020 só cria tabelas, índices, policies e função novos; não altera colunas,
policies ou registros preexistentes. Antes da execução, nenhuma tabela hq_
e nenhuma função hq_is_admin existia. Portanto há zero dados HQ a exportar.
Foi preservado um snapshot da estrutura referenciada User (colunas,
constraints, índices, grants/RLS), role runtime, inventário HQ vazio,
contagens preexistentes e fingerprint dos usuários. Arquivo ignorado pelo Git:
artifacts/hq-020-production-recovery.json.
SHA256: A0F2792446DA3F5AE49842ABA690BB44E44A1F9EB4F3A101C778F8D69D929998.
É um backup de metadados do escopo aditivo, não um dump integral do banco.
Nenhuma senha, chave ou linha de cliente foi exportada.
Snapshot às 00:47:41 UTC de 11/09: 29 usuários, 13 salões e 2230 agendamentos.
Runtime sem SUPERUSER/BYPASSRLS. Um administrador global persistido.
Fingerprint User: aa43adcdf4913912637eac281a5dcc07.

Rollback: HQ_ENABLED=false, voltar código anterior, preservar tabelas/histórico
para roll-forward. Não executar DROP, reset, db push ou restauração automática.

## Execução
Aplicação produtiva e publicação ainda pendentes de registro verificável.

