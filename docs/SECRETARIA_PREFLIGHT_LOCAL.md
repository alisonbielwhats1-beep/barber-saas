# Preflight autenticado local da Secretária

Base `9b92138ec7665342b60e1ddc210f04ccfa611c84`, worktree
`codex/service-create-mvp`. Nenhuma chamada ao modelo é parte deste procedimento.

## Fixture autorizado

`scripts/preflight-secretary-local.ts` reutiliza `assertMvpTestDatabase` antes de
qualquer escrita: valida banco, host, porta e diretório exato do cluster informado.
Requer `APP_ENV=test`, as URLs locais do MVP, `MVP_TEST_CLUSTER` e
`SALON_SECRETARY_ALLOW_PAID_CALLS=false`. Não lê nem precisa de credencial OpenAI.

Uma transação administrativa cria uma única conta autenticável:

- Owner MVP Secretária, `mvp-secretaria@local.test`, OWNER somente do salão A.
- A: Everflair Demo Local (`167c543c-e4e2-4117-af6c-215082b12f1f`).
- B: Salon B — RLS sintético (`20ccd95a-9b19-4f23-88d9-292ef4c9fe48`).
- Senha aleatória apenas em memória; banco recebe bcryptjs com custo 10,
  como o cadastro real. `passwordSetAt` preenchido evita backfill no login.
- Para B, reutilizado um usuário de fixture anterior sem senha autenticável
  e sem profissional, exclusivamente para satisfazer a relação do profissional.

Cada NotificationOutbox exige AppointmentEvent e Appointment; cada Appointment
exige profissional, serviço e ClientProfile. Foram criados dois registros de cada
um desses tipos (um por salão), todos sintéticos, sem telefone/e-mail de clientes.
Os serviços estão inativos e identificados como fixtures de FK; os agendamentos
estão cancelados; as notificações são INTERNAL/SENT para não entrar em entrega.
Não houve execução de fluxo de agenda, envio, nem cadastro pela Secretária.

O script recusa sobrescrever a conta existente. Não reexecute cegamente: a senha
aleatória não é persistida fora do hash. Reutilização posterior com nova senha
exige preparação explicitamente autorizada; não há reset automático.
As integrações antigas que exigem ClientProfile/Appointment vazios precisam de
outro banco descartável limpo; este agora contém os fixtures positivos autorizados.

## Resultado observado

Após desconectar o administrador, todas as verificações usaram
`mvp_service_runtime`, sem superuser/BYPASSRLS. RLS e FORCE RLS permanecem ativos,
com `tenant_isolation` comparando salonId a app_current_salon().

| Contexto | Leitura sem filtro da aplicação | Leitura explícita do outro salão |
|---|---|---|
| A | Uma notificação, somente A | Zero |
| B | Uma notificação, somente B | Zero |
| Ausente | Zero | — |
| Identificador inexistente | Zero | — |

SELECT permitido; INSERT/UPDATE/DELETE negados em NotificationOutbox.
Nenhum grant/policy/schema foi alterado nesta execução.

O servidor Next local foi iniciado em 127.0.0.1:3317 usando somente a URL runtime,
sem credencial administrativa, com chave OpenAI vazia e flag paga false.
O teste HTTP executou o fluxo real NextAuth: CSRF, callback Credentials e sessão
assinada. A identidade retornada correspondeu à conta sintética.

GET autenticado `/servicos/secretaria`: HTTP 200, layout administrativo
(`main-content`), rótulo Everflair Demo Local e título da Secretária presentes no
HTML renderizado pelo servidor. Nenhum permission denied. Este é um preflight de
autenticação/renderização SSR, não inspeção visual nem teste de hidratação no navegador.
Nenhuma conversa foi aberta, mensagem enviada ou confirmação executada.

Consulta runtime ao AuditLog do salão A: zero eventos SALON_SECRETARY_USAGE.
Servidor de teste e cluster foram encerrados. `.env.local` preservado com
SALON_SECRETARY_ALLOW_PAID_CALLS=false. Sem push, deploy ou alteração produtiva.

## Execução

Com o cluster descartável iniciado e as variáveis de segurança explicitamente
definidas, executar `node node_modules/tsx/dist/cli.mjs scripts/preflight-secretary-local.ts`.
O procedimento não concede permissões nem aplica migrations. Em erro, encerra o
servidor e preserva os fixtures para diagnóstico; não tenta corrigir privilégios.

Não iniciar teste Luna automaticamente. A autorização continua separada.

## Verificações do incremento

- Execução do script: fixture, RLS positivo A/B, login Credentials e SSR passaram.
- `npm run lint`: passou.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: passou.
- `npm test -- --maxWorkers=2`: 221 arquivos, 1.210 testes passaram.
- `npm run build`: compilação passou, mas a coleta de páginas parou em
  `/api/client/waitlist/cancel`: NEXTAUTH_SECRET ausente no processo de build.
  O preflight Next dev havia recebido seu próprio segredo sintético em memória.
  Não foi alterada configuração nem repetido o build após esse bloqueio.
  Para uma futura validação de build, fornecer segredo sintético somente ao
  processo de teste; não exige grant, policy, segredo produtivo ou migration.
- A suíte PostgreSQL antiga não foi reexecutada: seus testes pressupõem banco sem
  os fixtures positivos de notificações. As verificações PostgreSQL desta execução
  estão no script acima e usam exclusivamente a role runtime após o preparo.
