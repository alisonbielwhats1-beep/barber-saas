# Gate 4.0B.5 — observação durável e retomada de i12

Preparação offline em 2026-09-24. **Nenhuma inferência autorizada ou executada neste Gate.**
Produto, prompts, mensagens, expected, fixtures, Skills, Tools, Registry, drafts,
confirmação, cost guard, parser JEV e Router permanecem com a semântica anterior.
As mudanças estão exclusivamente no harness/bridge de avaliação e sua CLI.

## Evidência histórica e causa da interrupção

O processo anterior terminou sem gravar o relatório final. Os arrays de capturas e
de wire witness estavam em memória: o arquivo era escrito pela CLI somente após
`executePhaseA` retornar. Essa lacuna de durabilidade está confirmada pelo código.

O log do PostgreSQL local registra, em 24/09 às 08:07:03 -03, desligamento
incorreto, recuperação automática/WAL e retorno a aceitar conexões às 08:07:04.
A sessão de execução também foi abortada. **A causa do aborto e a relação causal
com a queda do PostgreSQL são desconhecidas.** Não há prova de falha do provider,
OOM, intervenção humana ou falha específica do sistema operacional. O registro
de fim de WAL durante recovery, seguido de recuperação concluída, não fundamenta
diagnóstico de corrupção por si só. Nenhum cluster foi reiniciado neste Gate.

Evidências anteriores preservadas, sem reconstruir aprovação funcional:

| Casos | Estado canônico |
|---|---|
| i01 | PASS histórico imutável; não será chamado |
| i02–i11 | MODEL_COMPLETED / OBSERVATION_MISSING / FUNCTIONAL_RESULT=UNKNOWN |
| i12 | INCONCLUSIVE_ATTEMPT_1; rede, resultado e custo da tentativa não comprovados |
| Demais | NOT_STARTED |

Placar permanece PASS=1, FUNCTIONAL_FAILURE_SAFE confirmada=0,
SAFETY_FAILURE confirmada=0, UNKNOWN=25. O relatório de interrupção e os dumps
não foram reescritos. Zero efeitos operacionais históricos observados continua
sendo distinto de aprovação funcional.

## Persistência e checkpoint

`hard-conversations-durable.ts` mantém journal JSONL append-only com sequência,
hash SHA-256 encadeado, vínculo ao manifest, timestamp real (independente do
relógio sintético), case_id, turn_index e attempt. Cada append termina em
`fsyncSync` **antes** de retornar. Uma falha de escrita bloqueia novos envios.
O arquivo fica em `evaluation/results/hard-conversations-phase-a-resume.jsonl`.

Estados: NOT_STARTED → STARTED → MODEL_COMPLETED → OBSERVATION_COMPLETED →
CASE_COMPLETED. Fast-path não exige MODEL_COMPLETED. Somente CASE_COMPLETED
avança o cursor; ele significa evidência concluída, **não PASS funcional**.
INCONCLUSIVE bloqueia retomada automática. Nunca há terceiro attempt de i12.

Eventos gravados:

- STARTED e TURN_STARTED, incluindo conversa/drafts conhecidos;
- BEFORE_NETWORK: metadados sanitizados da request já validada pelo cost guard,
  endpoint, modelo, store/stream/parallel, Function Tool, tool types, bytes,
  reserva de custo, hosted_tools=0, containers=0; fsync antes de `fetch`;
- AFTER_NETWORK: HTTP status, request_id allowlisted e latência, quando disponíveis;
- MODEL_COMPLETED: IDs/usage sanitizados pelo extrator existente, custo estimado
  quando calculável e latência, antes da persistência técnica do runtime no DB;
- MODEL_FAILED: diagnóstico sanitizado existente, sem corpo/headers brutos;
- cada OBSERVATION_EVENT e a captura completa OBSERVATION_COMPLETED, através de
  callback síncrono do bridge, antes de atualizar o cursor do bridge;
- TURN_COMPLETED: capture, journal/deltas, counters, checks e motivo de parada;
- CASE_COMPLETED: snapshot integral de hashes/contagens e hashes exatos dos logs;
- INCONCLUSIVE/STOPPED, quando o processo ainda puder escrever.

As capturas mantêm campos extraídos/ausentes, provenance, operações, resolução
backend, ambiguidades, clarificações, conflitos/alternativas observáveis, proposals,
dependências, métricas PASS/FAIL/UNKNOWN, latência, usage e custo. Não se inventam
eventos não publicados pelo runtime. O bridge atual publica essas evidências ao
fim de `send`; não há promessa de observar cada mutação interna enquanto `send`
estiver em andamento. Se o DB falhar antes desse ponto, MODEL_COMPLETED sobrevive,
mas ausência de observação continua UNKNOWN/INCONCLUSIVE.

Não são armazenados Authorization, API keys, connection strings, request/response
body bruto ou Error bruto. Dados sintéticos já sanitizados pelo bridge são
permitidos; valores de credenciais do processo e formatos de secrets são rejeitados.
Usage/custo ausentes permanecem null, não zero. Reasoning não é somado novamente
ao output. Não se afirma custo faturado.

## Restart, exclusão mútua e falhas

Lock exclusivo por arquivo e PID impede dois runners. Um lock de processo vivo
ou não identificável nunca é tomado; somente ESRCH permite remover lock obsoleto.
Ao abrir journal de processo encerrado, estado iniciado sem CASE_COMPLETED ganha
INCONCLUSIVE durável. Novo envio é bloqueado. Mesmo observação ou turno completos
sem fechamento do caso não autorizam repetição. Caso concluído é imutável e pula
na próxima leitura do cursor; caso não iniciado permanece pendente.

Uma conversa multi-turn parcialmente concluída **não** é reconstruída a partir
do journal: o estado vivo dos drafts reside no runtime. Exige revisão e autorização
separadas, evitando continuidade artificial. Linha parcial/hash divergente bloqueia;
não é truncada nem reparada automaticamente. STOPPED também exige revisão.

`fsync` protege contra encerramento do processo nos testes; não substitui backup,
replicação ou garantia contra perda/corrupção física do armazenamento. Hard kill
pode impedir finally, mas o paid flag é restrito ao processo e morre com ele.
Finalmente normal sempre restaura paid=false/Router=false e o fetch original.

## Baseline e preflight contextual

Banco exclusivamente `127.0.0.1:55441/everflair_service_mvp`.
Baseline nova: **69 AuditLogs**, incluindo os sete históricos de i01 e 62 da
tentativa interrompida. Não se aceita qualquer log adicional por conveniência.
Os registros inteiros são comparados por hash em ordem canônica: tenant, usuário,
correlações, operação/status, timestamps e metadata estão cobertos pelo hash.
O enrollment também verificou os eventos esperados por caso contra o relatório
imutável e os sete logs de i01 contra a baseline anterior.

Todas as 26 fixtures operacionais foram comparadas com a baseline aprovada pós-i01:
Services, Customers, Appointments, itens/eventos/produtos de agendamento, Products,
Outbox, closures, time-off, resource bookings e payments. Nenhuma diferença.
Outbox=0, confirmações=0. O preflight valida novamente as 26 fixtures, role
`mvp_service_runtime` sem SUPERUSER/BYPASSRLS, 19 tabelas RLS/FORCE RLS e queries
de isolamento com a role runtime. Nenhuma migration/grant/fixture foi alterada.

Durante a futura execução, health checks antes de cada caso e de cada rede:
processo ativo, flags, integridade do manifest, reserva disponível e query mínima
runtime em DB/porta/role corretos (timeout 5s, sem retry). Antes de cada caso,
snapshot deve equivaler exatamente à baseline ou ao último CASE_COMPLETED.
Após caso, hashes operacionais continuam equivalentes à baseline original.
Novos logs técnicos são contados como delta, nunca como escrita de negócio.
Queda do DB não inicia a próxima inferência; checkpoint local preserva evidência.

## Congelamento

| Artefato | SHA-256 |
|---|---|
| Phase A original | `11f3ea7f8e04d5ccca7723b9f3575bde3a275e332f744453f63568b4b2dabbaa` |
| Continuação anterior | `25fabe2e60163bc61764bbeabf8d5fad3a5bcd2cca008d5377ddc54374c63582` |
| Baseline anterior | `c66c6307b2877a61b8a74b50a206132671a80026940f40d996789ee0699398a8` |
| Interruption audit | `fc88321db1acbfd52cf2fa90d493b805d01648f877411cc7cb0274ffc3173e94` |
| Dump pós-interrupção | `ee34ec847fb8b122f64b730f51c7e925d2869902b2d891dcbb144a9017887fbe` |
| **Resume manifest** | `dfc4d20d8ef05acf3003d5170f98fa1639d2beb387e75ce08067c22a5f950f5c` |
| **Resume baseline** | `fc3f7fd6a10ee2195ceeef15f37b9570e07e4404c673fcb88e253cab4548925e` |

Novos JSONs: `hard-conversations-phase-a-resume.json`,
`hard-conversations-phase-a-resume-baseline.json` e
`hard-conversations-phase-a-resume-seal.json`, em `packages/salon-secretary/evaluation/`.
Manifest e baseline têm hashes fixados no verificador, não somente no seal externo.
Cases são cópia exata de `source.cases.slice(11)`; comparação profunda inclui
mensagens, ordem, expected, fixtures e estrutura dos turnos.

Ordem exata futura: **i12 (REVALIDATION, attempt2), i14, i15, a02, a04, a09, d09,
t07, t08, m02, m03, m05, m07, x01, x02**. São 15 casos/17 turnos; t07 e t08
têm dois turnos cada. `45 minutos.` permanece inalterado. i01–i11 estão excluídos
do manifest, do journal e da witness. Não há range arbitrário.

## Plano futuro — não executar neste Gate

Preflight read-only já executado:

```powershell
node scripts/run-hard-conversations-phase-a.cjs --preflight-resume-i12
```

Resultado: `PHASE_A_RESUME_PREFLIGHT_OK`, 15 casos/17 turnos, 69 logs históricos,
paid=false, Router=false, zero chamadas de rede de IA.

**Somente após autorização explícita futura da retomada e de REVALIDATE_i12:**

```powershell
try {
  $env:PHASE_A_RESUME_FROM_I12_APPROVED = 'true'
  $env:PHASE_A_REVALIDATE_I12_APPROVED = 'true'
  node scripts/run-hard-conversations-phase-a.cjs --resume-from-i12
} finally {
  $env:SALON_SECRETARY_ALLOW_PAID_CALLS = 'false'
  $env:SALON_SECRETARY_JEV_ROUTER_ENABLED = 'false'
  Remove-Item Env:PHASE_A_RESUME_FROM_I12_APPROVED -ErrorAction SilentlyContinue
  Remove-Item Env:PHASE_A_REVALIDATE_I12_APPROVED -ErrorAction SilentlyContinue
}
```

Máximo **17 inferências**, das quais no máximo uma nova para i12; zero retries,
JEV, confirmação e efeitos operacionais. Reserva máxima **US$0,1462** (17 ×
US$0,0086). Usa a tarifa congelada: input US$0,10/M, cached US$0,01/M,
cache-write US$0,125/M, output US$0,50/M; limite 64.000 input/1.200 output,
conservador para cache-write. Tarifa **não reconfirmada online neste Gate zero
rede**; reconfirmar antes da autorização/execução futura. Não inclui custo
desconhecido da tentativa histórica de i12. Reservas BEFORE_NETWORK são
restauradas cumulativamente no restart, mesmo sem usage.

Mantidos todos os STOPs anteriores: campos inventados relevantes, entidade errada,
unsafe proposal/execution, confirmação/escrita operacional, cross-tenant, JEV,
store diferente de false, hosted tool/container, secrets, drift e orçamento.
Acrescentados DB health, persistência, hash/cursor/lock e tentativa inconclusiva.
Falha funcional segura segue o guard já aprovado; nunca vira PASS por ausência de
efeitos. Nenhum executor de confirmação foi adicionado.

## Validação, arquivos e rollback

Novos testes: `hard-conversations-durable.test.ts` e
`hard-conversations-durable-execution.test.ts`. Cobrem hard exit sem close/finally
em quatro pontos, restart, preservação de evidence/UNKNOWN, caso concluído não
repetido, tentativa3 bloqueada, DB entre casos/depois do modelo, fsync failure
antes da rede, lock, truncamento/hash, secrets, baseline alterada, exclusão i01–i11,
15/17, budget17, flags e multi-turn parcial. Integração usa o runner efetivo com
Secretary/model/DB simulados e bridge real. Nenhuma inferência real.

Alterados: `hard-conversations-phase-a-execution.ts`,
`hard-conversations-phase-a-witness.ts`, `hard-conversations-phase-a-db.ts`,
`hard-conversations-observation-bridge.ts`, `scripts/run-hard-conversations-phase-a.ts`
e `docs/STATUS_ATUAL.md`. Novos módulos `hard-conversations-durable.ts` e
`hard-conversations-phase-a-resume.ts`, os três JSONs, dois testes e este documento.
Todo o restante do trabalho pré-existente no worktree foi preservado.

Rollback: manter paid=false/Router=false e não executar o novo comando. Reverter
somente os hooks/novos arquivos deste Gate se necessário, preservando baseline,
journal e históricos como evidência. **Não** voltar ao modo antigo de execução
com o banco pós-interrupção, limpar logs, repetir i01–i11 ou restaurar dump apenas
para passar o preflight. Nenhuma alteração de schema ou rollback de banco é necessária.

Resultados finais de lint/TypeScript/build/suíte estão no registro de validação
adjacente `SECRETARIA_GATE_4_0B_5_VALIDATION.md`.
