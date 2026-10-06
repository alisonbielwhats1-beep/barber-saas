# Gate 4.0B.5 — registro de validação

Data: 2026-09-24. Worktree: `.worktrees/service-create-mvp`.
Branch local: `codex/phase-a-durable-resume`. Alterações anteriores do worktree
preservadas; nenhuma publicação, commit remoto ou deploy.

| Verificação | Resultado final |
|---|---|
| Testes direcionados (6 arquivos: durable, execução durável, harness, bridge, continuation, provider diagnostic) | 71/71 PASS |
| Novos testes de crash/restart e integração do runner | 17/17 PASS, incluídos nos 71 |
| `npm test` | 262 arquivos, 2.280 testes PASS; exit 0 |
| `npm run lint` | exit 0, sem erros/warnings finais |
| `npm run typecheck` (`tsc --noEmit --incremental false`) | exit 0 |
| `npm run build` | exit 0; 61/61 páginas estáticas |
| `git diff --check` | exit 0; somente avisos preexistentes de conversão LF/CRLF |
| `node scripts/run-hard-conversations-phase-a.cjs --preflight-resume-i12` | PHASE_A_RESUME_PREFLIGHT_OK |
| Escopo futuro | 15 casos, 17 turnos, i12 somente attempt2 |
| Histórico técnico | 69 AuditLogs exatos, incluindo i01=7 |
| Fixtures e estado operacional | 26 fixtures preservadas; hashes iguais à baseline aprovada, Outbox=0, confirmações=0 |
| Segurança DB | runtime sem SUPERUSER/BYPASSRLS, RLS/FORCE RLS e tenant isolation aprovados no preflight |
| Flags finais lidas da configuração | gpt-6-luna; paid=false; Router JEV=false |
| Journal de execução real novo | inexistente; retomada não executada |

Suíte geral cobre Hard Conversations, primitivas conversacionais, bridge,
diagnóstico do provider, drafts/fast-path/batch, seis Skills, Communication,
Router V1, Golden GPT-6 V2 e mocks de segurança existentes. Os testes PostgreSQL
de integração mutáveis não foram executados contra a evidência histórica; o DB
descartável recebeu apenas leituras/preflight neste Gate.

Testes/build rodaram com preload local bloqueando sockets, HTTP/HTTPS e fetch.
Build usou a fixture de fonte offline já existente e segredo NextAuth sintético
apenas no processo. Nenhuma fonte foi baixada nem credencial produtiva utilizada.
Warning preexistente do Vite sobre configuração CommonJS permaneceu informativo.
Uma tentativa inicial de lint/build detectou nome de variável proibido pelo
Next.js em teste novo; corrigido e todas as verificações finais passaram.

Falhas de crash foram testadas em processos Node filhos encerrados com exit 99,
sem fechar o journal/lock. A releitura preservou o prefixo gravado e acrescentou
INCONCLUSIVE; nenhuma tentativa adicional foi liberada. Fsync failure foi injetada
offline; o mock de rede não foi chamado. DB failure foi simulada entre casos e
após resposta do modelo: IDs/usage persistidos sobreviveram e não houve próximo envio.
O caso multi-turn parcial não foi reconstruído/reexecutado.

Hashes históricos verificados novamente: Phase A original, continuação anterior,
baseline anterior, i01 aprovado, relatório de interrupção e dumps predecessores.
Novo manifest SHA-256:
`dfc4d20d8ef05acf3003d5170f98fa1639d2beb387e75ce08067c22a5f950f5c`.
Nova baseline SHA-256:
`fc3f7fd6a10ee2195ceeef15f37b9570e07e4404c673fcb88e253cab4548925e`.

Placar funcional **inalterado**: PASS=1; FUNCTIONAL_FAILURE_SAFE confirmada=0;
SAFETY_FAILURE confirmada=0; UNKNOWN=25. Nenhum PASS reconstruído de logs técnicos.

Zero chamadas reais OpenAI/JEV/Meta, zero confirmação, zero escrita operacional,
zero alteração de schema/grants/RLS, zero deploy. Reserva futura: até 17 inferências,
US$0,1462 sob tarifa congelada, a reconfirmar antes de execução autorizada.
Plano, escopo, limitações e rollback: `SECRETARIA_GATE_4_0B_5_DURABLE_RESUME.md`.
