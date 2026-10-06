# Secretária — auditoria de staging e preparação de pré-piloto

Data: 25/09/2026. **SECRETARY_STAGING_REAL_DEVICE_PILOT_READINESS = NOT_VALIDATED**.
**READY_FOR_CONTROLLED_PILOT = NO**. Auditoria e preparação local; nenhum deploy.

| Critério | Resultado nesta rodada |
|---|---|
| Staging isolation | FAIL no Preview existente: Redis compartilhado |
| Staging deploy | NOT_EXECUTED |
| Front staging | NOT_EXECUTED |
| Text smoke | NOT_EXECUTED em staging |
| Mutation E2E | NOT_EXECUTED em staging |
| Receipt/refresh | NOT_EXECUTED em staging; PASS local preservado |
| Real-device STT | REQUIRES_REAL_DEVICE_VALIDATION |
| Voice multi-turn | NOT_EXECUTED em dispositivo físico |
| Stale confirmation | NOT_EXECUTED em staging; regressão local PASS |
| Idempotency | NOT_EXECUTED em staging; regressão local PASS |
| HARD_BLOCK | NOT_EXECUTED em staging; regressão local PASS |
| Tenant isolation | NOT_EXECUTED contra DB staging |
| Permissions | NOT_EXECUTED em staging; regressão local PASS |
| Observability | Auditoria de código feita; prova remota pendente |
| Feature flag | PASS offline da admissão; ON/OFF remoto não executado |
| Rollback | Runbook pronto; ensaio remoto NOT_EXECUTED |
| Regression | PASS: 2571 testes, lint, TypeScript, build |
| Safety | PASS no escopo executado: zero efeito operacional; remoto não certificado |
| Pilot readiness | NOT_VALIDATED |

## Ambiente encontrado e barreira de isolamento

Consulta MCP Vercel confirmou uma equipe e um projeto `salon-saas`, ID
`prj_qBERQKNhW0BjEsMaJHuft66TMYiy`, equipe `team_lMhIFHKaVaQd90zYTPhubWMA`,
Next.js, Node 24.x. Há previews existentes; o mais recente retornado foi
`dpl_96BKTz1RvRciPXoG6B2yFRhBuLXa`, branch `codex/desconto-fechamento`,
commit `2bff12e559081647b09e1bf546d0951c0c103fab`, READY, target=null.
Isso não é deployment da Secretária nem prova de isolamento.

O painel de variáveis, filtrado por Preview, apresentou:

| Variável | Escopo observado | Ação |
|---|---|---|
| NEXTAUTH_SECRET | Preview | Somente nome/escopo; valor não revelado |
| NEXTAUTH_URL | Preview | Somente nome/escopo; valor não revelado |
| KV_REST_API_URL | Production and Preview | Compartilhada; não usada |
| REDIS_URL | Production and Preview | Compartilhada; não usada |
| KV_URL | Production and Preview | Compartilhada; não usada |
| KV_REST_API_READ_ONLY_TOKEN | Production and Preview | Compartilhada; não usada |
| KV_REST_API_TOKEN | Production and Preview | Compartilhada; não usada |

As cinco pertencem à integração Upstash, recurso `store_BA6LGP5lio8b8trw`.
O código de rate limit usa KV_REST_API_URL/TOKEN e pode escrever no Redis.
**O Preview existente não satisfaz o requisito de separação absoluta.** Não
houve conexão ao Redis, DB produtivo, download/revelação de secrets ou edição
dessa integração. Não basta adicionar outro DATABASE_URL a esse Preview.
Nenhuma configuração APP_ENV=staging, DB staging ou credencial dedicada da
Secretária apareceu nessa lista de Preview. Valores e eventual herança Shared
não foram inspecionados; não se presume isolamento por ausência na lista.

GitHub API confirmou environments Preview, Production, staging e test. O CLI
retornou HTTP 403 no inventário Codespaces por falta de escopo `codespace`.
O Chrome está autenticado como **AlisonBSilva24**, sem sessão da proprietária
**alisonbielwhats1-beep**. A lista vazia dessa outra conta não prova que o
Codespace histórico foi apagado. Foi solicitada a sessão correta, sem pedir
senha/token na conversa.

Segundo AMBIENTES.md, o Codespace histórico é
`glorious-enigma-jjv6v4rvrv49f544r`, com demo privada na porta 3000, e checkout
`/workspaces/everflair-billing-staging`, DB `everflair_billing_staging` em loopback.
Esses dados são **históricos**, não revalidados nesta rodada. Os dois Supabase
existentes são destinados a produção; nenhum foi escolhido como staging.
O inventário organizacional autenticado confirmou `vgwfhiqjxfjnygarsqpt`
(alisonbielwhats1-beep's Project) e `vshnatkzxdekkvqttvbv` (barber-saas), em
`busaqxeiqfqijhltlupz`; não foram abertos os dados desses projetos.
Não foi criado novo recurso, banco, schema, migration, role, grant ou fixture.

## Candidato, topologia e flags

Branch local criada: `codex/secretary-staging-readiness`. HEAD
`9b92138ec7665342b60e1ddc210f04ccfa611c84`; origin/master atualizado para
`a663bdbd3a40d9d5e39ab8de0c3a801125755c49`. Mudanças históricas não commitadas
foram preservadas. Não houve push, PR, merge ou deploy; o candidato completo
ainda não possui commit/build remoto identificável.

`salon-secretary-runtime.ts` só admite test/development no DB local identificado
127.0.0.1:55441/everflair_service_mvp. O Permissions-Policy de microfone também
limita voz a esses ambientes. **Ambos foram preservados**, aguardando destino
isolado concreto. Não há ativação remota apenas por mudar flags.

`SalonSecretary.sessions` é Map em um processo, TTL 20 min, máximo 200 sessões
raiz/10 por usuário, 20 turnos. Reinício/outro worker dá SESSION_NOT_FOUND;
não reconstrói conversa cliente nem autoriza replay inseguro. Vercel com múltiplas
instâncias não foi comprovada compatível. Isso é limite publicado, não regressão
do cérebro. Um staging em processo único deve declarar essa diferença de produção.

Implementação local deste Gate: `secretary-rollout.ts`, admissão por pares exatos
tenant/usuário, sem wildcard e sem cache. Staging exige lista; a ausência preserva
somente o contrato dos fixtures locais históricos. Lista explícita [] bloqueia
todos também no laboratório. Server Actions, rota e layout usam identidade
autenticada; domínio/RLS/papéis continuam autoridades. Remoção bloqueia novas
mensagens e confirmações da sessão aberta. Não cancela transação já em curso.
O `.env.example` documenta []. `.env.local` não foi alterado.

## Modelo, segurança e observabilidade auditados no código

- Modelo local candidato: GPT-6 Luna, credencial/projeto exclusivos da Secretária;
  não herda a chave HQ. Configuração real de staging ainda não disponível.
- store=false; tracing desativado no contrato; funções locais permitidas,
  nenhum hosted tool/container; HTTP restrito a Responses com payload verificado.
- SDK retries=0, timeout HTTP 30s, Runner 45s/maxTurns=1, limite de saída normal
  1200 tokens; V2 pode configurar 1200–16384. Não confundir com teto monetário
  agregado. Prova de budget/custo por conversa e alertas em staging está pendente.
- AuditLog técnico inclui session/run/call, model/request/response/status/tokens;
  journal operacional e receipts existentes preservados. Falhas pós-COMMIT não
  convertem receipt SUCCESS em falha. Correlação completa no deployment não medida.
- Não foi identificado neste recorte um alerta automatizado de readiness; o
  runbook define acompanhamento e parada, mas não declara alertas implantados.
- Communication usa fake local e bloqueia staging. Cron de reminders existente
  não deve ser habilitado nesta fase. Nenhuma integração externa foi acionada.
- Storage de imagens usa Supabase salon-assets; não importar bucket/credencial
  produtivo. Storage próprio de staging não identificado.

## Validação remota e física

Smoke A–H, mutations, receipts/refresh, partial failure, HARD_BLOCK, stale,
idempotência, permissions/RLS/isolation e rollback remoto: **NOT_EXECUTED**.
Não houve baseline DB remoto porque não há conexão isolada identificada. Os
PASS locais históricos continuam válidos, mas não viram PASS de staging.

**STT_REAL_DEVICE = REQUIRES_REAL_DEVICE_VALIDATION**. Foi solicitado dispositivo,
navegador e participação em fala real. Não há evidência física nova. O no-speech
headless anterior permanece diagnóstico histórico, sem causa final determinada.
Transcrição/edit/multi-turn físicos, ruído, latência e rede são pendências deste
Gate. Zero chamadas Luna nesta rodada; custo API da Secretária=0; latências STT,
Luna, DB e E2E de staging=N/A, sem médias/p95 inventados.

## Continuação e rollback

O [runbook](./SECRETARY_PILOT_RUNBOOK.md) está preparado, não executado. Primeiro
obter acesso ao Codespace existente ou identificar outra infraestrutura isolada;
auditar antes de criar recursos. Não alterar Production/integração compartilhada
para liberar o teste. Depois fixar candidato, preflight/backup e configurar
admissão sintética, executar smoke pequeno e dispositivo físico.

Rollback remoto: NOT_EXECUTED, nenhum candidato foi publicado. Rollback local
deste Gate: remover apenas as chamadas/imports de secretary-rollout dos três
entrypoints, o helper/teste e a variável nova; preservar mudanças anteriores do
Front e todos os Gates. O build harness apenas ganhou nome de log separado para
não sobrescrever evidência do Gate anterior. Nenhum rollback de DB é necessário.

EXPECTED_MUTATIONS=0; UNEXPECTED_MUTATIONS=0 nesta auditoria. Efeitos externos
operacionais=0. Produção não recebeu alteração. Flags operacionais permanecem OFF.
Readiness não pode ser declarado antes de staging/voz física/rollback/budgets
comprovados. Não há autorização para iniciar cliente real ou produção.

## Regressões e evidências duráveis

- Focados: 27 PASS (admissão e Server Actions). Cobrem par exato, cross-product
  tenant/usuário negado, identidade do cliente ignorada, configuração inválida,
  produção bloqueada e revogação durante conversa aberta.
- `npm test -- --maxWorkers=2`: **2571 PASS / 284 arquivos**, 135.98s.
  Testes de integração PostgreSQL são excluídos por esse comando; não se afirma
  schema-smoke/staging/DB remoto executado. Nenhum schema/grant foi alterado.
- `npm run lint`: exit 0.
- `npx tsc --noEmit --incremental false`: exit 0.
- `npm run build`: exit 0, invocado pelo harness
  `node scripts/build-secretary-front-local.cjs --staging-readiness` com
  credenciais apagadas, DB inutilizável, fontes locais e flags OFF. Prova do
  build local, não de configuração/build remoto.
- `git diff --check`: exit 0 (avisos de normalização LF/CRLF apenas).
- `.env.local` SHA-256 antes/depois:
  `7548c4ec20d910575fe635e03c9e3e067fd8187741752630ac481909b7b1a5d8`.
  Enabled/paid/JEV explicitamente false; Front/Voice/Multi-Action/Overlap não
  ativados (defaults OFF). Nenhuma variável real foi criada/modificada.

Logs separados em `packages/salon-secretary/evaluation/results/`:
`staging-readiness-tests.log`, `staging-readiness-lint.log`,
`staging-readiness-typescript.log`, `staging-readiness-build.log`,
`staging-readiness-inventory.json`. Inventário guarda somente metadados já
auditados, sem valores de secrets. Evidências históricas não foram sobrescritas.
`staging-readiness-artifact-index.json` registra hashes dos artefatos desta rodada.

Não houve bug do cérebro/executor demonstrado. A lacuna de flag por ator recebeu
a menor implementação nos entrypoints; o risco de infraestrutura compartilhada
foi documentado e bloqueou o deployment, sem alterar recursos produtivos.
STT, budgets monetários, alertas, rollback e toda prova remota continuam pendentes.
