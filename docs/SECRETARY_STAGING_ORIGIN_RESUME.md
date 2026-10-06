# Secretária — retomada, OpenAI real e reconciliação

## Estado atual — 25/09/2026, 21:29Z

O bloqueio de origem foi corrigido exclusivamente no launcher do Codespace.
Três chamadas reais à OpenAI concluíram com HTTP 200. Leitura financeira e
clarificação foram observadas na UI real; a continuação teve resposta do
provider, mas seu resultado visual não foi capturado. A ferramenta de captura
de rede ficou presa por aproximadamente 35 minutos e retornou com a página
desconectada. Não atribuir esse problema à inteligência da Secretária.

`final-off-reconciliation-classified.json`: **passed=true**. Runtime
`OFF_PORT_FREE`; as configurações privadas OFF e ON foram ambas regravadas
com as sete flags da Secretária/JEV/voz/multi-action/overlap/paid calls OFF.
O arquivo ON anterior foi preservado em arquivo privado para auditoria.

### Correção e limites da proteção de origem

A captura real mostrou `host=localhost:3001`, `origin=https://localhost:3001`,
referer e x-forwarded-host no domínio privado exato do Codespace,
x-forwarded-proto=https e sec-fetch-site=same-origin. O adapter
`scripts/secretary-codespace-origin.cjs` normaliza essa origem somente com
esse conjunto de cabeçalhos coerente e no alvo staging aprovado. Metadados
ausentes ou estrangeiros com origem loopback são rejeitados. Outras origens
continuam sujeitas à verificação padrão do Next.js.

Não foram adicionados allowedOrigins, wildcard nem desativação de CSRF.
O launcher `scripts/serve-secretary-codespace.cjs` usa o mesmo build/domínio,
vinculado à release e ao BUILD_ID aprovados, escutando apenas em loopback.
19 regressões offline PASS; probes HTTP reais rejeitaram origem estrangeira,
site estrangeiro e referer ausente. O probe positivo usou action ID inválido
e recebeu 404 após a barreira de origem, sem executar operação. A UI legítima
posteriormente completou as chamadas reais abaixo.

SHA-256 do adapter: `38cdc470e5d84d7e02b73d07253685521450f525375f28b6b8efa76672da58d6`.
Launcher remoto executado: `9cf3f09edd91f6f67212fe119baf16e5c41f45f2d2bb4cc32cbd5aa1865ef572`.
Launcher local após comentário de lint, sem mudança comportamental:
`aeb4ede41f63d44bfa73759a901a81c4bdf51f8cf44fcf5b85d538215d6bb79d`.
O manifest da aplicação/build abaixo permanece o mesmo; o adapter tem
identidade separada. Nenhum cérebro, executor ou contrato foi alterado.

### Smoke e custo observado

| Caso | Resultado comprovado |
|---|---|
| Quanto faturei ontem? | PASS: card financeiro concluído, R$0,00, fixture sem faturamento |
| Marca o Fábio amanhã. | PASS: pergunta por serviço e horário; confirmação desabilitada |
| Massagem com Tatiana A amanhã às 12h. | Provider HTTP 200; resultado Front UNKNOWN após falha da captura |
| Mutations, stale, replay, multi-action e HARD_BLOCK em staging | NOT_EXECUTED nesta retomada |
| STT físico | REQUIRES_REAL_DEVICE_VALIDATION |

O journal durável contém exatamente 3 STARTED e 3 SUCCEEDED, sem retry.
Modelo gpt-6-luna, store=false. Tokens input/output: 3097/254, 3098/379,
1634/567. Estimativa conservadora total **US$0,001578625**, não valor faturado.
Latências de provider: 3729, 3976 e 6969 ms; mínimo 3,729 s, mediana 3,976 s,
média 4,891 s, máximo 6,969 s. Não calcular p95 com três amostras.
Não há medição confiável de STT, DB, refresh ou E2E desta rodada.

### Reconciliação e correção do harness

Zero confirmações enviadas. Preços continuam 10000 centavos e estoques 10
nas duas fixtures. Outbox zero. Baseline anterior preservado; delta de dados
corresponde às 44 inserções sintéticas preparadas antes do smoke, mais
**17 AuditLogs técnicos previstos**, todos do tenant e ator autorizados:

- MODEL_CALL_STARTED: 3; MODEL_CALL_FINISHED: 3.
- SKILLS_LOADED: 2; OPERATIONS_PREPARED: 3; DIRECT_LUNA: 3.
- DRAFT: 2; SCHEDULING_TIMINGS: 1.

O primeiro reconciliador classificou incorretamente todo AuditLog como delta
inesperado. A evidência inicial permanece em `final-off-reconciliation.json`.
Após inspeção dos eventos e de seus produtores no código publicado, o harness
foi corrigido para aceitar somente esses pares técnicos e o ator/tenant exatos.
Eventos operacionais, desconhecidos e de outro ator/tenant continuam falhando.
`scripts/secretary-staging-audit.cjs` recebeu **6 regressões PASS**.
Não houve mudança de expected de negócio para ocultar mutation.

Identidade final: everflair_billing_staging, system ID 7682424799483236389,
app_runtime sem SUPERUSER/BYPASSRLS. RLS/FORCE/policies preservadas conforme
snapshot do preflight; leitura isolada nos dois sentidos e sem contexto PASS
nas seis tabelas verificadas. Hashes finais das 62 tabelas preservados em
`final-data-hashes.json`. Zero efeito operacional inesperado demonstrado.

### Evidência, regressão e pendências

No diretório privado indicado abaixo: `origin-probe.jsonl`,
`origin-http-native-result.json`, `resume-preflight-result.json`,
`origin-transition-result.json`, `api-budget.jsonl`, `smoke-read-ui.txt`,
`smoke-missing-ui.txt`, `audit-classification-detail.json`,
`final-off-reconciliation-classified.json`, `final-data-hashes.json`.

- Suíte completa: **2630 PASS / 287 arquivos**, 189,68 s.
- Depois da suíte: **6 testes adicionais do classificador PASS**. Não afirmar
  que uma suíte completa de 2636 testes foi executada.
- `npm run lint` e `npx tsc --noEmit --incremental false`: PASS.
- Build Linux abaixo PASS; nenhuma mudança na aplicação após esse build,
  apenas launcher/harness/testes/documentação.
- Logs locais: `packages/salon-secretary/evaluation/results/staging-origin-*.log`
  e `staging-audit-reconciliation-tests.log`.

Rollback aplicado: runtime candidato desligado e porta 3001 livre. Não havia
deployment anterior da Secretária nessa porta para comprovar troca de versões.
Backup/fixtures/evidências preservados; demo 3000 inalterada. Nenhum novo
recurso pago criado, Production/Meta não utilizados. Custo reportado é só a
estimativa das três chamadas autorizadas, sem promessa sobre fatura de terceiros.

Permanecem pendentes smoke operacional completo, confirmations/replay/stale,
refresh real de staging, demais atores, observabilidade completa, rollback entre
deployments e dispositivo físico. Marcos locais anteriores preservados.

**SECRETARY_STAGING_REAL_DEVICE_PILOT_READINESS = NOT_VALIDATED**

**READY_FOR_CONTROLLED_PILOT = NO**

## Histórico anterior — bloqueio inicial antes da correção

25/09/2026. Este registro atualiza o inventário de preparação, preservando o
histórico. Não declara smoke staging nem pilot readiness validados.

## Artefato e ambiente

- Codespace existente: `glorious-enigma-jjv6v4rvrv49f544r`.
- Release: `/workspaces/everflair-billing-staging/.demo/secretary-release-806223edd36b`.
- Fonte: HEAD `9b92138ec7665342b60e1ddc210f04ccfa611c84` mais alterações locais
  identificadas pelo manifest, SHA-256
  `806223edd36bb72e38a10a4ff2d3ea87be1bb998c0d19f1dd21da608a0ecdf54`.
- Build Linux: Node 22.16.0, Next 15.5.25, BUILD_ID `XYqNZnD8YqIYPSOKdaUWB`.
- Artefato SHA-256 `38940958d31a88d3def5c541d3e1b2944e80e71e437dd89def719d3bc5ffaa95`.
- Build executado no Docker local existente, container temporário removido;
  nenhum novo serviço de infraestrutura ou recurso externo foi criado.
- Porta 3001 encaminhada como **Private**. Porta 3000 da demo preservada.

O build remoto anterior sofreu SIGTERM; a instrumentação indicou remetente
fora do namespace de PID, sem OOM observado. Não atribuir a causa a falta de
memória nem afirmar que foi corrigida. O artefato Linux local resolveu a entrega
do build, sem desativar proteção do host.

## Preflight e UI observados

Diretório de evidência privado:
`/workspaces/everflair-billing-staging/.demo/secretary-readiness-2026-09-25T14-59-20-361Z`.
Backup cifrado, baseline, resultado das migrations publicadas e fixtures estão
preservados. Não reexecutar seed; as 44 inserções sintéticas já foram feitas.

`preflight.json` registrou STAGING_PREFLIGHT_OK às 15:47:53Z: banco e Redis
internos, runtime app_runtime sem SUPERUSER/BYPASSRLS, admissão por um par
tenant/owner sintético, integrações externas desativadas e nenhum segredo
encontrado nos 169 arquivos estáticos verificados.

Login sintético pela UI real PASS. Com flags OFF, botão da Secretária ausente;
com ON apenas para owner A, painel e microfone apareceram. Isso ainda não prova
negação operacional de todos os outros atores nem smoke de execução.

## Primeira pergunta e reconciliação

Foi enviado uma vez pela UI: “Quanto faturei ontem?”. A interface exibiu
processamento, mas a tentativa foi interrompida antes de obter o resultado.
Antes de qualquer retry, foram relidos estado do processo e log operacional:

```text
x-forwarded-host: <domínio privado do Codespace>-3001.app.github.dev
origin: localhost:3001
Invalid Server Actions request.
digest: 1882257493
api-budget.jsonl: ausente
processo registrado PID 65252: ausente
```

O bloqueio ocorreu no Next.js antes da Server Action e do wrapper de OpenAI.
Não há evidência de chamada OpenAI, receipt ou mutation operacional da
Secretária. O envio não deve ser repetido como se tivesse sido concluído.
Não confundir as 44 inserções anteriores das fixtures com mutations da Secretária.

Em observação posterior, o navegador do editor mostrou `Stopping codespace`.
O comando proposto para registrar somente cabeçalhos não foi enviado, conforme
retorno da ferramenta. Não afirmar que esse diagnóstico executou. A causa da
parada do Codespace não foi estabelecida; não atribuir a custo ou ação humana.

## Proteção de origem: diagnóstico pendente

O comportamento é compatível com relatos de reescrita de Origin pelo proxy
do Codespaces. Isso é hipótese apoiada no log e em relato externo; ainda falta
medir os cabeçalhos seguros neste ambiente e testar a rejeição de outra origem.

Referências:
- [Relato primário do proxy Codespaces](https://github.com/orgs/community/discussions/147513).
- [Configuração oficial Server Actions/allowedOrigins](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions).

Nenhum allowedOrigins, wildcard, reescrita de cabeçalho ou desativação de CSRF
foi aplicado. Uma eventual adaptação deve ser restrita ao ambiente aprovado e
preservar rejeição de origens estrangeiras; não basta fazer a pergunta passar.

## Custo, rollback e estado seguro

O preload `scripts/secretary-staging-api-budget.cjs` limita o lançamento a
20 tentativas persistidas, sem retry automático e com formato restrito de
Responses API. Ausência de resposta consome a tentativa para evitar repetição
ambígua. Testes offline do guard: 10 PASS. Não é garantia do valor da fatura.

Os arquivos privados de configuração OFF e ON estão preservados. O processo
ON estava ausente na retomada. Não afirmar que todas as configurações foram
reescritas para OFF: essa ação não foi feita. Próximo lançamento deve usar OFF
explicitamente, conferir role/RLS/isolamento e só então habilitar o par sintético.
JEV, overlap, Meta e integrações externas permaneceram desativados no lançamento.

Rollback do candidato é desligar 3001; não havia versão anterior da Secretária
nessa porta. A demo 3000 não é substituída. Backup foi verificado por hash e
listagem do pg_restore; não houve ensaio de restauração integral do banco.

## Regressão e veredito

- `npm test -- --maxWorkers=2`: 2611 PASS, 286 arquivos, 177,97 s.
- `npm run lint`: PASS.
- `npx tsc --noEmit --incremental false`: PASS.
- `npm run build`: PASS no artefato Linux, install_exit/build_exit 0.
- Logs: `packages/salon-secretary/evaluation/results/staging-isolation-*-final.log`.
- Build: `artifacts/secretary-linux-build/status.json` e manifest do artefato.

Pendentes: encaminhamento de Server Actions, smoke texto operacional, respostas
reais da OpenAI, mutations/receipts/refresh de staging, checks operacionais dos
outros atores, rollback ensaiado e dispositivo físico/voz. Nenhuma dessas
pendências foi promovida a PASS com mocks.

SECRETARY_STAGING_REAL_DEVICE_PILOT_READINESS = NOT_VALIDATED

READY_FOR_CONTROLLED_PILOT = NO
