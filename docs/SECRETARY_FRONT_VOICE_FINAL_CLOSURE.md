# SECRETARY_FRONT_VOICE_UX_V1 — fechamento final local

25/09/2026. **SECRETARY_FRONT_VOICE_UX_V1 = VALIDATED.**

**STT_REAL_DEVICE = REQUIRES_REAL_DEVICE_VALIDATION.** O reconhecimento de fala física não foi certificado; continua obrigatório antes do piloto. A validação deste Gate segue o critério de fechamento explicitamente atualizado pelo responsável.

| Critério executivo | Resultado |
|---|---|
| Grants mechanism | PASS — snapshot completo e seis cenários PostgreSQL |
| Rollback exact | PASS — privilégios e ACLs brutas idênticos; segundo rollback vazio |
| RLS/isolation | PASS |
| Agenda refresh | PASS — tela montada, sem F5 |
| Produtos refresh | PASS — tela montada, sem F5; replay idempotente |
| Serviços refresh | PASS histórico + regressão atual sem mutation |
| Desktop | PASS |
| Mobile | PASS em viewport de navegador |
| STT integration | PASS — testes determinísticos de UI/transcript/fallback |
| STT real device | REQUIRES_REAL_DEVICE_VALIDATION |
| Accessibility | PASS no escopo automatizado |
| Regression | PASS — 2.556 testes, lint, TypeScript e build |
| Safety | PASS nesta retomada — zero mutation inesperada ou bypass |
| SECRETARY_FRONT_VOICE_UX_V1 | VALIDATED |

## 1–3. Causa anterior, snapshot/restore e grants

O rollback anterior executava apenas REVOKE em nível de tabela. No PostgreSQL, isso também retirou SELECTs preexistentes por coluna. Os 18 privilégios anteriores foram recuperados naquela tentativa; o incidente permanece registrado em [relatório anterior](./SECRETARY_FRONT_VOICE_LOCAL_GRANTS_RESULT.md).

O mecanismo novo está em `src/test/secretary-grant-state.ts`, usado exclusivamente pelo harness local `scripts/secretary-front-final-closure.ts`. Captura schema, tabela, coluna (inclusive xmin), grantee, grantor, privilégio, is_grantable e ACL bruta. Inclui os privilégios públicos de outras entidades/grantees para detectar mudanças fora do escopo. O snapshot de segurança separado cobre roles, memberships, policies, RLS/FORCE, ACLs de schema e default privileges.

A restauração deriva SQL do BEFORE e do delta observado: revoga apenas SELECT temporário e reconstrói os SELECTs por coluna afetados com os metadados anteriores. Recusa deltas não autorizados ou grantors não suportados antes de executar a restauração. Roda em transação e exige igualdade integral dos privilégios; este Gate também exigiu igualdade das ACLs brutas. Um segundo rollback deve emitir zero comandos.

Os seis cenários A–F passaram no PostgreSQL, em transações revertidas antes do Front: privilégio ausente; tabela preexistente; coluna preexistente; mistura tabela/coluna; rollback duplicado; exceção injetada após o primeiro grant. Nove testes offline adicionais cobrem planejamento, grant option anterior, deltas proibidos, perda de privilégio anterior e comparação de schema.

Target exclusivo: `127.0.0.1:55441/everflair_service_mvp`, cluster `C:/Users/USURIO~2/AppData/Local/Temp/everflair-service-mvp-dumpcheck-20260924-uxbaseline/data`, system identifier `7689285600966560972`. Executor operacional: `mvp_service_runtime`, SUPERUSER=false/BYPASSRLS=false. `mvp_test_admin` foi somente observador/preparador da fixture e executor dos grants explicitamente autorizados.

| Objeto | BEFORE: SELECT do runtime | TEMPORARY | AFTER_ROLLBACK |
|---|---|---|---|
| Product | 7 colunas | + SELECT tabela | Exatamente BEFORE |
| ClientProfile | 11 colunas | + SELECT tabela | Exatamente BEFORE |
| Payment | 4 colunas, sem id | + SELECT(id) | Exatamente BEFORE |

Grantor dos três deltas: mvp_test_admin; grantee: mvp_service_runtime; is_grantable=false. INSERT/UPDATE e demais privilégios permaneceram iguais. **Nenhum grant temporário permanece.** O runner grava `rollback-from-before.sql` antes da aplicação persistente.

Os dumps originais e seus hashes são preservados. Para comparar schema, somente os marcadores aleatórios `\restrict`/`\unrestrict` gerados pelo pg_dump são normalizados; definições, policies e ACLs não são ignoradas. Não houve schema change, migration, alteração de RLS ou normalização de ACL para esconder diferenças.

## 4–7. Agenda, Produtos, Serviços e cache

Uma fixture nova foi criada: tenant `023b8c38-f443-4c14-b2d1-d9dee28f5654`, dona Tatiana, clientes sintéticos, atendimento em 26/09/2026. Foi reutilizada somente para concluir ações ainda não executadas e leituras; os PASS não foram repetidos com novas mutations.

| Fluxo | Antes → depois | Prova |
|---|---|---|
| Agenda | Amanda Souza, Massagem, 10:00–10:30 → 11:00–11:30 | Confirmação autenticada, receipt e botão da Agenda atualizado na mesma página |
| Produtos | Shampoo X, 10 → 8 | Confirmação, receipt 10→8 e saldo visível no summary do produto |
| Replay de confirmação de estoque | 8 → 8 | Mesmo POST de Server Action, HTTP 200, receipt com stock=8; zero efeito adicional |
| Serviços | Massagem permanece R$100 na fixture nova | Leitura atual; PASS histórico de refresh R$100→R$80 preservado |

Appointment `cmugzllg2000r6fkyio76sriu`: somente startAt/endAt/version/updatedAt mudaram. Cliente, profissional, serviço, duração, preço, notas e demais registros permaneceram iguais. Produto `cmugzllfy000n6fkygj0q2qs4`: somente stock/updatedAt mudaram; Condicionador permaneceu com 7 unidades.

Estratégia auditada: Server Actions da Secretária usam autenticação/tenant e coordenador existentes; após receipt real, `revalidatePath` invalida as rotas do produto. `SecretaryChat` chama `router.refresh()`. Os Server Components consultam o backend com `withTenant` e atualizam as props de Agenda/Produtos/Serviços. Não foi criada cópia paralela do saldo ou dos appointments. Não houve mudança compartilhada de cache nesta retomada; por isso, não se repetiu a mutation de Serviços.

As asserções de Agenda/Produtos ocorreram antes de qualquer navegação ou reload posterior. Leituras independentes ao fim reconfirmaram 11h, estoque 8 e serviço R$100. O replay e o refresh não produziram nova baixa.

## 8–12. Stale UI, confirmação, receipts, partial e HARD_BLOCK

Testes de componente verificam edição → botão antigo desabilitado → nova proposta/revisão → nova confirmação; o card final usa o receipt e não conserva o preço da proposta anterior. A confirmação envia os mesmos plan_ref/revision/group_key/fingerprint do backend. Estado Executando só vira Concluído após receipt; erro/stale não produz sucesso nem refresh indevido.

O teste de resposta perdida repete a mesma confirmação; o E2E de estoque também repetiu o POST autenticado real. Receipts e snapshots são persistidos com requests e AuditLogs. Não foi inventado um novo campo “already applied”: o contrato observado devolve o receipt anterior e não repete efeitos.

Partial failure mantém A SUCCESS, B FAILED_SAFE, C SUCCESS em cards distintos. HARD_BLOCK mostra o impedimento, não oferece override e usa somente alternativas fornecidas pelo backend. Missing field e ambiguidade continuam naturais e exigem escolha explícita. Esses casos foram reexecutados na suíte de componentes; os E2E históricos de stale/multi/HARD_BLOCK foram preservados sem reabrir o cérebro ou repetir mutations.

## 13–16. Desktop, mobile, STT e acessibilidade

Desktop: painel lateral integrado ao shell, abrir/fechar/reabrir preservando texto permitido; Agenda e Produtos ficam visíveis ao lado dos receipts. Mobile: tela cheia, safe areas e scroll; viewports 390×844 e 320×560 passaram sem overflow horizontal, com input visível, Tab dentro do painel e Escape/reabertura funcionando. O viewport reduzido não equivale a teste do teclado físico de Android/iOS.

STT offline: idle, solicitação ao browser, listening, transcript recebido/editável, envio manual pelo mesmo pipeline, cancelamento, eventos tardios ignorados, retry, no-speech, permission denied, API indisponível e fallback digitado passaram. TTS curto usa voz local apenas por clique; não confirma mutations. Nenhum mock foi contabilizado como reconhecimento de voz real.

Diagnóstico nativo em Chrome 153.0.8010.54 headless, WAV sintético:

- Permissions-Policy: microphone=(self); permissão `granted`.
- getUserMedia: track live, não mutada, 48 kHz; AudioContext running; RMS máximo 0,352721. Portanto, havia sinal sintético mensurável no caminho de captura.
- SpeechRecognition chamado diretamente, fora do hook/Front: start e audiostart; após aproximadamente 8,034 s, no-speech, nenhum speechstart/result, transcript vazio.
- O Front mostrou o mesmo erro, permitiu retry/cancel e texto manual. Zero envio ou confirmação de texto no probe.

Isso exclui ausência da API, permissão negada e silêncio total do getUserMedia neste ensaio. Não identifica a causa interna no caminho nativo de reconhecimento e não comprova que a API consumiu aquele WAV como fala. A reprodução direta não depende da Secretária. Não há dispositivo/microfone humano confiável neste laboratório: **STT_REAL_DEVICE = REQUIRES_REAL_DEVICE_VALIDATION**, obrigatório antes do piloto. processLocally estava disponível, mas false; não se certificou reconhecimento offline/local.

Axe retornou zero violações WCAG2 A/AA e WCAG2.1 AA nos estados/escopos do painel testados. Labels, mic, confirmação, live status, Tab/foco/Escape foram verificados. Não houve certificação completa por leitor de tela humano ou aparelho físico.

## 17–20. Mutations, auditoria, RLS e isolamento

**EXPECTED_MUTATIONS: 2 updates de negócio** — um Appointment e um Product. Serviços: zero updates nesta retomada. **UNEXPECTED_MUTATIONS = 0.**

Além da preparação aditiva da fixture: 1 AppointmentEvent, 1 NotificationOutbox INTERNAL e 21 AuditLogs (incluindo registros técnicos de proposta/confirmação). AuditLog não foi confundido com mutation de negócio. Não houve envio externo, WhatsApp/Meta ou pagamento. O replay de estoque gerou zero efeitos, inclusive zero AuditLog novo.

Snapshots observaram 63 tabelas com allowlist de IDs/campos. A criação da fixture verificou preservação das linhas anteriores; cada passo operacional comparou o banco inteiro. Os hashes entre tentativas coincidiram, e a execução final somente leitura preservou integralmente as 63 tabelas. Os grants foram restaurados após cada tentativa, inclusive as falhas seguras do harness.

As 19 tabelas operacionais protegidas passaram nos checks RLS/FORCE; o catálogo completo de policies/roles/segurança permaneceu idêntico. Leituras sem contexto retornaram zero linhas; contexto de tenant viu somente suas linhas; probes por registros estrangeiros existentes foram bloqueados em Product, ClientProfile, Service, Appointment e Payment. O probe de Payment usou um pagamento sintético histórico estrangeiro, sem criar pagamentos novos.

## 21–24. Testes, lint, TypeScript e build

| Comando / bateria | Resultado final |
|---|---|
| Offline focado grants + UI + actions | 50 PASS |
| Snapshot/restore A–F no PostgreSQL | 6/6 PASS; rollback integral e repetido |
| E2E Agenda | PASS no checkpoint preservado |
| E2E estoque + mesma confirmação | PASS no checkpoint preservado |
| Playwright final somente leitura + diagnóstico de voz | 2/2 testes concluídos com PASS; não é PASS de reconhecimento real |
| `npm test -- --maxWorkers=2` | 2.556 PASS / 283 arquivos; 123,78 s |
| `npm run lint` | PASS, exit 0 |
| `npx tsc --noEmit --incremental false` | PASS, exit 0 |
| `npm run build` | PASS, exit 0 |
| Schema invariance / dumps / privilégios / RLS | PASS local; não se executou CI remoto ou migration |

Build executado por `scripts/build-secretary-front-local.cjs`: todos os nomes de env locais são neutralizados, credenciais de providers indisponíveis, flags OFF, fonte local de teste e DB em porta 1 incapaz de conexão. Nenhum deploy, PR/Preview ou produção.

Logs: `packages/salon-secretary/evaluation/results/front-voice-closure-final-suite-retry.log`, `front-voice-closure-final-lint.log`, `front-voice-closure-final-typescript.log`, `front-voice-closure-final-build.log`.

## 25–28. Correções, limites, rollback e flags

Correções determinísticas desta retomada:

1. Snapshot/restore recompõe os SELECTs anteriores por coluna, com igualdade integral; schema compara estrutura sem o nonce aleatório do pg_dump.
2. Seletor E2E de estoque procurava detalhe fechado; agora verifica o saldo visível do summary do produto correto. Nenhuma mutation de estoque ocorreu na tentativa que parou nesse seletor.
3. Teste de persistência tentava preencher input de conversa concluída, cujo formulário é corretamente removido. O teste passou a iniciar nova conversa; a finalização real foi feita em modo somente leitura, sem repetir o estoque.
4. Teste novo de stale card passou a usar `assessPlanAction`, respeitando o tipo publicado, sem acrescentar propriedade inexistente ao contrato.
5. A primeira suíte teve 2.555 PASS e um timeout de varredura de arquivos (5 s), concorrendo com lint/TS. A suíte foi repetida isoladamente e passou integralmente; teste, limite e expected não foram alterados.

Os relatórios FAIL intermediários permanecem preservados. Nenhum deles foi convertido artificialmente em PASS; os checkpoints aprovados foram retomados sem repetir mutations. Não houve alteração de código de produto, cérebro, prompts, Tools, ActionPlan, executor ou regra de negócio nesta etapa de fechamento.

Limites: interpretação do plano roteirizada no harness; backend/autenticação/PostgreSQL reais. Luna/JEV pago: zero calls, custo de provider US$0; não há benchmark de latência Luna. O serviço STT interno do browser pode fazer tráfego próprio não observado pelas rotas da página; zero efeito externo operacional não equivale a certificar ausência de todo tráfego interno do Chrome.

Rollback de grants: concluído, com `AFTER_ROLLBACK === BEFORE`, inclusive ACLs brutas, e segundo rollback sem SQL. Dumps/fixtures foram preservados; nenhuma restauração global ou remoção de dados. O entry point antigo defeituoso permanece bloqueado; o mecanismo novo é o runner de fechamento. Rollback do produto, se necessário futuramente: flags FRONT/VOICE OFF e reversão apenas dos arquivos do Gate, preservando alterações anteriores do worktree.

Flags finais OFF: Secretária Front/Voice, paid calls, JEV, Multi-Action V2, overlap, billing e integrações externas. As flags necessárias existiram só nos processos locais de teste, já encerrados; overlap ficou OFF nesta retomada. `.env.local` permaneceu com SHA256 `7548c4ec20d910575fe635e03c9e3e067fd8187741752630ac481909b7b1a5d8`.

`TOPIC_14_SECRETARY_BRAIN_V1 = COMPLETE`, `SECRETARY_EXECUTION_E2E_V1 = VALIDATED` e `STALE_CONFIRMATION_FIX = VALIDATED` preservados. Nenhum deploy, Meta, produção ou próxima fase iniciada.

## Evidência durável e próximo plano

Base: `packages/salon-secretary/evaluation/results/front-voice/`.

- `closure-2026-09-25T13-18-32-646Z/`, `closure-2026-09-25T13-22-23-303Z/`, `closure-2026-09-25T13-27-12-105Z/`: BEFORE/TEMPORARY/AFTER_ROLLBACK, seis cenários, SQL, roles/RLS/isolamento, schema e dumps.
- `2026-09-25T13-18-36-839Z/`: fixture nova, Serviços somente leitura, Agenda before/proposal/confirmation/receipt/after, screenshot `agenda-refresh.png`.
- `2026-09-25T13-22-25-921Z/`: Produtos, request/receipt, replay sem efeito e screenshot `products-refresh.png`.
- `2026-09-25T13-27-14-732Z/`: shell desktop/mobile, a11y, leitura final, `speech-diagnostic.json`, capturas e Playwright final.
- `final-closure-summary.json` e `final-closure-artifact-index.json`: consolidação e hashes.

Foi preparado somente o [plano STAGING + REAL DEVICE + PILOT READINESS](./SECRETARY_STAGING_REAL_DEVICE_PILOT_PLAN.md). Sua execução não foi iniciada.
