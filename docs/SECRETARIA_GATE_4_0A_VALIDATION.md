# Gate 4.0A — evidência offline e limites

Branch local `codex/secretary-conversational-design`. Alterações anteriores do
worktree preservadas; não houve fetch, push, PR, CI remoto ou deploy. A referência
local de origin/master foi consultada, sem afirmar atualização pela rede.

## Escopo exato desta entrega

Novos:

- `packages/salon-secretary/evaluation/conversational-resolution.ts`
- `packages/salon-secretary/evaluation/hard-conversations.ts`
- `packages/salon-secretary/evaluation/hard-conversations-plan.json`
- `src/lib/__tests__/secretary-conversational-design.test.ts`
- `docs/SECRETARIA_GATE_4_0A_CONVERSATIONAL_RESOLUTION.md`
- `docs/SECRETARIA_GATE_4_0B_PLAN.md`
- este documento.

Alterado: somente uma nova entrada do Gate no `docs/STATUS_ATUAL.md`. Os demais
arquivos sujos/untracked preexistiam. Nenhuma alteração em `.env.local`, runtime,
Registry, Skills, Tools, parser, Policy, catálogo, cost guard, schema ou migrations.
O novo módulo não foi exportado; o teste percorre os imports do runtime para
verificar isolamento. Nenhuma nova feature flag foi habilitada/criada.

## Congelamento

Manifest: `hard-conversations-plan.json`, SHA-256 final:

`b8c4c39b9ea338dbd2cbe80b9fe9f2efeb940391109da034b11bb480cbb0076e`

60 casos, 77 turnos, 116 arquivos predecessores protegidos por SHA-256.
O teste verifica cada hash e igualdade entre o dataset/fixtures tipados e JSON.
Ajustes de clareza de fixture/contrato ocorreram apenas durante preparação
offline, antes deste congelamento final; nenhum resultado real foi observado.
Nenhum relatório/gabarito histórico foi reescrito.

## Verificação

Todos os comandos usaram preload local que bloqueia `net.Socket.connect`,
HTTP/HTTPS e fetch reais; testes podem instalar seus transports falsos.
`SALON_SECRETARY_ALLOW_PAID_CALLS=false`. Integrações PostgreSQL excluídas.
O build usa fixture de fonte offline e segredo NextAuth sintético no processo;
nenhum download para contornar o bloqueio de rede. Prisma generate somente gera
client local, não acessa banco nem aplica schema.

- Novos testes conversacionais: **93**, incluídos na revalidação direcionada.
- Conversação + JEV evaluation: **172/172**, dois arquivos, passaram.
- Primeira rodada direcionada: 183 passaram e uma varredura de imports excedeu
  5s; o teste novo de varredura recebeu 30s, sem relaxar suas assertivas.
- Primeira suíte geral: 2.107 passaram; uma varredura JEV preexistente excedeu
  5s. O arquivo JEV não foi editado. Revalidação direcionada passou com CLI
  `--testTimeout=30000`; a suíte geral foi repetida com o mesmo limite local.
- Suíte final: **2.108/2.108 testes, 253/253 arquivos**, passou (185,07s).
- `npm run lint`: passou, exit 0.
- `npx --no-install tsc --noEmit --incremental false`: passou, exit 0.
- `npm run build`: passou, exit 0, com bloqueio de rede e fonte offline.
- Revalidação direcionada do manifest final após tornar explícitos os parâmetros
  sintéticos de agenda (buffer=0 e janela/antecedência): 172/172 passou.

Logs locais: `%TEMP%/gate40-targeted-final.log`, `gate40-suite-final.log`,
`gate40-lint-final.log`, `gate40-tsc-final.log`, `gate40-build-final.log`.
As primeiras tentativas dentro do sandbox ficaram suspensas e foram encerradas;
os comandos finais usaram a execução local autorizada, com o mesmo bloqueio
explícito de rede. Nenhuma falha foi contornada com rede ou alteração do core.

Comandos: `npm test -- --maxWorkers=2 --testTimeout=30000`;
`node node_modules/vitest/vitest.mjs run src/lib/__tests__/secretary-conversational-design.test.ts src/lib/__tests__/jev-evaluation.test.ts --maxWorkers=2 --testTimeout=30000`;
`npm run lint`; `npx --no-install tsc --noEmit --incremental false`;
`npm run build`.

Cobertura nova: aproximação não auto resolvida, igualdade exata única, duplicidade,
busca truncada, snapshot expirado/estrangeiro, sim escopado, dependências de campo,
perguntas mínimas, correções com invalidação transitiva, preview antigo recusado,
pausa/abandono, grafo de 3–5 itens analítico, ciclo/aresta inválida, predecessor
falho, zero execução implícita, contratos do dataset e imports isolados.
O motor real `findVisitPlan` foi exercitado com um dia em memória: conflito de
45 min às 10h com reserva 10h30, intervalo adjacente, pausa e fim da jornada.
Nenhum banco foi iniciado/consultado por esses testes.

## Limites e segurança

São testes de contrato/coordenador puro, não medição da competência linguística
real nem demonstração de RLS PostgreSQL atual. A suíte inclui regressões mockadas
de drafts, fast-path, batch, dependências, seis Skills, Communication, Router,
Golden V2 e segurança. Não se reexecutaram testes de integração com banco.
O aviso preexistente do Vite sobre futuro configLoader native não é falha.

Conferência local, sem valores secretos: model=gpt-6-luna, paid=false,
Router=false; `.env.local` ignorado e não tracked. GPT-5.6 preservado como rollback.
Zero inferências OpenAI/JEV, zero Meta, zero banco, zero confirmações, zero
escritas operacionais, zero hosted tools/containers executados e zero deploy.

Gate 4.0B permanece **proposto, não executado**: 60 casos / máximo 77 inferências,
teto condicional US$0,6622 a preço histórico e caps definidos no manifest.
Precisa runner/dry-run offline revisado e nova autorização. Não confundir os
DESIGN_TARGETs com funcionalidade implementada no runtime atual.

Rollback: retirar somente os sete arquivos novos e a entrada do STATUS deste
Gate. Nenhum rollback de banco/configuração é necessário; não reverter o
worktree inteiro nem remover trabalho anterior.
