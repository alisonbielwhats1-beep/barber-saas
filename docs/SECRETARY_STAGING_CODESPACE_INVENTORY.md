# Secretária — retomada do inventário Codespace

25/09/2026. Inventário inicial somente leitura, seguido da preparação isolada
autorizada abaixo. Histórico inicial preservado nas seções explicitamente históricas.
Login confirmado **no navegador interno do Codex**, conta proprietária
`alisonbielwhats1-beep`. Chrome externo continuava em outra conta e não é a
sessão a usar. Não pedir novas credenciais.

## Atualização final de 25/09/2026, 21:29Z

Origem do proxy corrigida por adapter isolado; 3 chamadas reais OpenAI HTTP 200.
Leitura e clarificação PASS na UI; continuação visual UNKNOWN após bloqueio da
ferramenta de captura. Reconciliação final PASS: baseline/RLS/isolamento intactos,
zero confirmação, 17 auditorias técnicas previstas, runtime e flags OFF.
2630 testes completos mais 6 específicos posteriores PASS; lint/TS e build da
aplicação PASS. Readiness NOT_VALIDATED, piloto NO, STT físico pendente.
[Evidências atuais](./SECRETARY_STAGING_ORIGIN_RESUME.md).

## Histórico após instalação do candidato privado, antes da correção de origem

O estado abaixo é histórico da preparação. A atualização posterior está em
[retomada e bloqueio de origem](./SECRETARY_STAGING_ORIGIN_RESUME.md): build
Linux e instalação privada concluídos, preflight de lançamento PASS, login
sintético e flag OFF/ON observados, primeira pergunta bloqueada antes da OpenAI.
Processo ausente na retomada e Codespace posteriormente em `Stopping codespace`.
Regressão final 2611 PASS; readiness permanece NOT_VALIDATED.

## Histórico: estado após acesso ao terminal, antes do lançamento

- Login/trust resolvidos manualmente pelo proprietário no navegador interno.
- Demo: `/workspaces/barber-saas`, branch codex/everflair-demo, HEAD
  `106ac1154c700190954be7ec2b0cc2a13e7c012b`, checkout histórico limpo.
- Staging existente: `/workspaces/everflair-billing-staging`, HEAD
  `6122e6e3f8e8a45bfc5dc4dc20736e43f3bd190e`, checkout histórico limpo.
- PostgreSQL 16.15, 127.0.0.1:5432, DB everflair_billing_staging, system ID
  `7682424799483236389`, data_directory /var/lib/postgresql/data.
- Runtime app_runtime: SUPERUSER/BYPASSRLS/CREATEDB/CREATEROLE false.
- Redis interno HTTP redis-http:80 aponta para redis:6379. ISOLATED de
  Production; compartilhado somente entre as aplicações sintéticas do Codespace.
- DB staging separado do DB everflair_demo. Não alteramos a demo/porta 3000,
  cuja visibilidade foi confirmada Private. Porta 3001 ainda sem deploy candidato.
- Credentials DB/Redis geradas localmente pelo bootstrap versionado, arquivos
  `.demo` ignorados. Valores não copiados para evidência nem client bundle.
- Key/project dedicados OpenAI transferidos após autorização explícita para
  arquivo privado 0600 fora da release; nenhuma chave genérica HQ utilizada.
  Não expostos no editor/Git/client/log. Cópia temporária local removida.
  Chamadas OpenAI autorizadas explicitamente; demais serviços sem custo novo.
  Paid calls continuam OFF até preflight e launch controlado.
- Storage/Supabase/Meta/SMTP/pagamento não configurados para o candidato.
  Launch exige allowlist positiva de env; presença de aliases remotos reprova
  o guard estrito. Desativação efetiva do deployment ainda depende de launch.

### Backup, migrations e fixtures

Backup cifrado e metadata em
`/workspaces/everflair-billing-staging/.demo/secretary-readiness-2026-09-25T14-59-20-361Z`.
Detalhes, hashes, migrations publicadas aplicadas somente no staging e rollback
aditivo em [upgrade](./SECRETARY_CODESPACE_STAGE_UPGRADE.md).
Pós-commit: 61 hashes anteriores, policies, grants/ACLs e role preservados.
AuthIdentity adicionada com RLS/FORCE conforme migration publicada; auth OFF.

Fixtures A/B criadas pelo harness `scripts/prepare-secretary-codespace.cjs`,
SHA-256 `e9c2ac28de2d460515732656a0f08e6adc2e4ab767b37e0b6882c3ce9f890f75`.
Os checks de RLS dos dois sentidos ocorreram dentro da transação, usando
SET LOCAL ROLE app_runtime; nenhum registro estrangeiro visível. Leituras
positivas de Appointment/Product/Service/ClientProfile em ambos os tenants.
AuditLog/Outbox estão vazios; isso não prova leitura positiva nessas duas tabelas.
No-context bloqueado nas seis tabelas, verificado também após COMMIT.
Isolamento via Secretária, permissions de mutations e smoke continuam pendentes.

Tenant A: `688f55c7-4b79-4331-9909-bf9985d271f8`.
Tenant B: `b0b32e31-9a7a-47c2-9f2e-dbe66e4c2111`.
Senhas sintéticas aleatórias somente no arquivo privado 0600; não neste documento.
Agenda de teste: 26/09/2026, Amanda 10h, conflito 12h, fechamento 27/09.
Massagem R$100, Shampoo X 10 unidades. Datas devem ser reavaliadas em retomadas.

| Tabela | Inserções planejadas e observadas |
|---|---:|
| Appointment | 4 |
| AppointmentService | 2 |
| ClientProfile | 4 |
| Membership | 4 |
| Product | 2 |
| Professional | 2 |
| ProfessionalService | 2 |
| Salon | 2 |
| SalonClosure | 2 |
| Service | 2 |
| User | 4 |
| WorkingHours | 14 |

44 registros sintéticos; baseline anterior preservada, unexpected_mutations=0,
provider_calls=0. Evidência: pre-fixtures.json, synthetic-fixtures-result.json;
credenciais separadas em synthetic-fixtures-private.json. Não reexecutar seed:
o harness recusa marker existente e exige banco inicialmente sem tenants.

### Candidato e custo

Branch local codex/secretary-staging-readiness, base HEAD
`9b92138ec7665342b60e1ddc210f04ccfa611c84`. Contém alterações não commitadas:
o manifest, e não apenas o HEAD, identifica o candidato transferido.
1.281 arquivos, manifest SHA-256
`806223edd36bb72e38a10a4ff2d3ea87be1bb998c0d19f1dd21da608a0ecdf54`,
archive SHA-256 `db627c825b6abe9f6506f09c7b80a5eb6806ae91a9e72b14ae7230fa0b90fa20`.
Cada arquivo/membro foi validado antes de extrair para
`.demo/secretary-release-806223edd36b`; nenhum env/secret/artifact de teste enviado.
O harness de fixtures posterior foi enviado separadamente e não muda a fonte
da aplicação identificada pelo manifest.

npm ci remoto PASS; primeiro build terminou com SIGTERM, sem erro de código
diagnosticado. memory.events indicou oom=0 e oom_kill=0: não atribuir a OOM.
Retry limitado na mesma máquina, sem resize/serviço adicional.
Build não é deploy; smoke, rollback remoto e STT físico ainda não aprovados.

GitHub Budgets da proprietária: Codespaces budget $0, Stop usage Yes, spent $0.
Usage consultado mostrou billed $0; esses valores são leitura da UI naquele
momento, não garantia contra atraso de contabilização. Nenhum limite aumentado,
assinatura ou recurso novo criado. API da Secretária não está incluída
automaticamente na assinatura do agente Codex; o responsável esclareceu e
autorizou explicitamente as chamadas API. Paid calls permanecem OFF até preflight.

Regressão local: 2.601 testes / 285 arquivos PASS em execução sem build
concorrente. A tentativa anterior teve 2.600 PASS + timeout de 5s; preservada
em staging-isolation-tests.log. Reexecução isolada do arquivo: 84 PASS; suíte
completa: staging-isolation-tests-serial.log. Lint, TS e build local PASS.
Build local não comprova runtime nem STT remoto.

**STAGING_PREFLIGHT_OK não emitido. Readiness NOT_VALIDATED; piloto NO.**

## Histórico: descoberta antes de autorizar o terminal

- Repositório: `alisonbielwhats1-beep/barber-saas`.
- Codespace existente: `glorious-enigma-jjv6v4rvrv49f544r`, nome glorious enigma.
- Branch exibida: `codex/everflair-demo`; página indicava No changes, último uso
  há 12 dias. HEAD efetivo ainda deve ser lido no runtime.
- Máquina exibida: 2 cores, 8 GB RAM, 32 GB. Nenhum novo Codespace foi criado.
- Editor: `https://glorious-enigma-jjv6v4rvrv49f544r.github.dev/`.
- A abertura retomou a instância existente; conexão remota concluída. O editor
  anunciou Everflair Demo em execução/encaminhada na porta 3000. Não alteramos
  processo, porta, visibilidade, configuração, schema ou dados.
- Pasta visível: `/workspaces/barber-saas`, incluindo `.demo` e `.devcontainer`.
- VS Code em Modo Restrito. Ao focar o terminal apareceu a exigência “Você
  confia nos autores dos arquivos nesta pasta?”. A confirmação somente dessa
  pasta foi solicitada; ainda não foi aplicada. Nenhum comando remoto executado.

## Histórico: intenção versionada antes da leitura do runtime

Foram lidos via GitHub API apenas `.devcontainer/environment.mjs`, `compose.yml`
e `start.mjs` da branch demo. Não foram abertos os arquivos locais de secrets.

| Dependência | Código versionado | Classificação operacional atual |
|---|---|---|
| PostgreSQL da demo | Container postgres:16, DB everflair_demo, loopback, app_runtime | UNKNOWN até consulta read-only do runtime |
| Redis da demo | redis:7.4, volume demo-redis e redis-http interno | UNKNOWN até confirmar URLs/configuração efetiva |
| Credenciais da demo | Arquivos em .demo; herança limitada a PATH/HOME/USER/SHELL/LANG/TERM/TMPDIR | UNKNOWN quanto ao conteúdo efetivo; valores não revelados |
| Staging Billing histórico | Checkout/DB separados registrados em AMBIENTES.md | UNKNOWN nesta retomada |
| Redis/Upstash Preview Vercel | Recurso store_BA6LGP5lio8b8trw vinculado a Production e Preview | SHARED_WITH_PRODUCTION, recusado |
| Supabase existentes | Ambos reservados a produção | SHARED_WITH_PRODUCTION se reutilizados, proibido |
| Storage/serviços externos do Codespace | Não identificados no runtime | UNKNOWN, bloqueiam uso até demonstração de isolamento/desativação |

O environment.mjs valida DB em 127.0.0.1/everflair_demo e usuário app_runtime.
Define APP_ENV=development, NODE_ENV=production; desliga billing e notificações
explicitadas no script. Lê `.demo/environment.json`: por isso o código sozinho
não comprova as outras variáveis efetivas. start.mjs só inicia Next na porta
3000 quando existe `.demo/ready` e conserva processo anterior válido.

Não executar bootstrap/prepare/rebuild como forma de inventário: podem escrever
schema/dados. Não reutilizar o banco da demo sem preflight e plano específico.

## As cinco variáveis Upstash do Preview

| Variável | Uso no candidato local | Capacidade/limite da evidência |
|---|---|---|
| KV_REST_API_URL | Endpoint HTTP do rate-limit, preferido a UPSTASH_REDIS_REST_URL | Recebe POST EVAL com INCR/EXPIRE/TTL quando token configurado |
| KV_REST_API_TOKEN | Bearer do rate-limit | Caminho de escrita; ACL efetiva não consultada em produção |
| KV_REST_API_READ_ONLY_TOKEN | Nenhum consumidor encontrado no código src | Nome sugere read-only; ACL não presumida nem testada |
| REDIS_URL | Nenhum consumidor encontrado em src | URL com credencial potencial; não revelada nem conectada |
| KV_URL | Nenhum consumidor encontrado em src | Alias da integração; não revelado nem conectado |

Todas aparecem no mesmo recurso de integração e com escopo Production and
Preview; a partilha já basta para reprovar o isolamento. Não foi necessário
comparar valores ou consultar a instância produtiva. DB lógico/ACLs reais são
UNKNOWN; não se presume que um namespace diferente resolveria a separação.

`src/lib/rate-limit.ts` forma chaves `salon-saas:rl:<namespace>:<hash>`, sem
prefixo de ambiente. `src/lib/auth.ts` usa o limitador no login. Outros
consumidores incluem disponibilidade pública, agendamentos, uploads, convites,
signup e recuperação de senha. A Secretária não chama Redis diretamente no
seu coordinator; o acesso ao Front passa pelo login comum. Portanto até o
login de smoke poderia escrever no recurso compartilhado. Não executado.

## Histórico: próximo passo registrado antes da leitura do runtime

Após resolver o controle de confiança do editor, inventariar estado efetivo
com comandos somente leitura e saída redigida: URLs sem usuário/senha/query,
nomes de secrets sem valores, identidade DB/roles/RLS/policies e portas.
Qualquer UNKNOWN ou SHARED_WITH_PRODUCTION operacional mantém o smoke bloqueado.
Nenhum deploy/fixture/mutation/paid call foi realizado nesta retomada.
Regressões anteriores (2571, lint/TS/build) permanecem históricas; apenas
documentação foi alterada nesta retomada, sem alegar novos testes executados.
