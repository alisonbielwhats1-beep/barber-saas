# Gate 3.1C-C — evidência offline do Router V1

Data: 23/09/2026. Branch local `codex/secretary-router-v1`, no worktree
`service-create-mvp`. Alterações preexistentes dos Gates anteriores preservadas;
sem commit, push, PR, deploy, fetch ou alteração remota. `origin/master` foi
apenas lido da referência local (`27255eb`), sem alegar atualização online.

## Resultado

| Verificação | Evidência |
|---|---|
| Router unitário + fluxo Secretary/backend com mocks | 49 testes novos aprovados |
| Regressões direcionadas JEV, Policy, catálogo, Secretary, seis Skills, fast-paths, Batch, Communication e GPT-6 Golden V2 | 781 testes / 31 arquivos aprovados |
| `npm test -- --maxWorkers=2` | 2.015 testes / 252 arquivos aprovados |
| `npm run lint` | exit 0 |
| `npm run typecheck` (`tsc --noEmit --incremental false`) | exit 0 |
| `npm run build` | exit 0; Next 15.5.25, compilação, tipos e geração concluídos |
| Chamadas reais JEV / OpenAI / Meta | 0 / 0 / 0 |
| Banco, RLS, grants, migrations, fixtures, confirmações operacionais | nenhuma alteração/execução real |
| Runtime local | GPT-6 Luna; Router false; paid calls false |
| OpenAI | guard preservado; store=false, hosted tools=0, containers=0 |

Os testes e build rodaram com preload local bloqueando sockets, HTTP/HTTPS e
fetch real. Os testes substituem providers e SQL por mocks. Fontes Google no
build usam o fixture offline já existente; telemetria Next foi desativada.
Prisma Client foi gerado localmente pelo build, sem conexão ao PostgreSQL.
Não foram executados testes `*.integration.test.ts` nem schema-smoke, pois
esta etapa proíbe banco. RLS/tenant foram cobertos por mocks e regressões;
não se afirma nova comprovação PostgreSQL.

O aviso preexistente do Vitest sobre futuro `configLoader: native` permanece;
nenhuma falha funcional de regressão foi observada. Uma leitura auxiliar via
`tsx` encontrou `uv_os_get_passwd ENOMEM` no sandbox; o fingerprint foi calculado
sem tsx e validado pelo teste de integridade, sem rede ou mudança de dependência.

## Cobertura adversarial

Flag ausente/OFF e paid flag false não leem chave nem despacham JEV. As duas
entradas PROVEN passam pela implementação real do parser, derivação e Policy
com respostas sintéticas. T09 calcula o valor no mock de SQL; T24 usa `lte`
e inclui produto inativo no mínimo. Nenhuma referência vem do modelo JEV.

0,99 e 1,01 são inválidos. Também fazem fallback: JSON/schema inválido,
decisão/confidence ausente, unclear, Skill/métrica incorreta com confidence
1,00, hash stale, HTTP 401/403/429/500/503, timeout e indisponibilidade.
Timeout aborta no limite aprovado de 10s, sem retry. Discovery incompatível
não consegue despachar detail de outra Skill pelo guard de payload.

Testes de fluxo demonstram Luna efetivamente chamado uma única vez após erro
JEV, uso do mesmo backend, expiração pós-JEV, papel revogado, isolamento de
tenant/usuário e lock concorrente. Continuação de filho automático não é nova
mensagem elegível. Duração pendente usa fast-path com zero chamadas de IA.

As 40 entradas históricas mantêm só duas elegíveis; os dez goldens V2 seguem
Luna com flag OFF. Com ON, os oito não elegíveis não despacham JEV. Esta é
evidência de roteamento com mocks, não repetição da Golden Battery real.

## Integridade preservada (SHA-256 de arquivo)

| Artefato | SHA-256 inalterado |
|---|---|
| conditional-plan.ts | `836ef27063f0a191d409b9103b5d4f6fce8db86b1d85dfa03e74ff03585f0761` |
| jev-provider.ts | `44449d30c852e36fe277ef7572d8de7ed0bf86d6e61f7535894303c065024960` |
| acceptance-policy.ts, incluindo allowlist | `ba2223442b203b6c0a055662b7a6f861e648bdfe06bb0fc680da7da7eca0958c` |
| derivation-catalog.ts | `93c145a85ad25f32e813a08a61e068f5d7590ef148abc36422a6959c32a9a6b1` |

Pins semânticos do Router: catálogo
`0300667615177bf9d96bb9c96a9f055ff99041db111b0e9fb78e48f407434791`;
allowlist `e7ca7f2e3aa8c6753f9808484558ac8ab16255e3edcbba7303448302b350f70a`.
Nenhuma reescrita de resultado/gabarito histórico, nenhuma nova inscrição,
nenhum threshold ou classificador foi criado.

## Arquivos deste Gate

Novos:

- `src/lib/secretary-router.ts`: eligibility, pins, adapter/Policy, guard e trace.
- `src/lib/__tests__/secretary-router.test.ts`: 35 testes de roteamento/política.
- `src/lib/__tests__/secretary-router-flow.test.ts`: 14 testes do coordenador.
- `packages/salon-secretary/evaluation/router-v1-validation-plan.json`: proposta real não executada.
- `docs/SECRETARIA_ROUTER_V1.md`: desenho, limites e rollback.
- `docs/SECRETARIA_ROUTER_V1_VALIDATION.md`: esta evidência.

Alterados em relação ao início deste Gate (alguns já eram untracked):

- `src/lib/salon-secretary.ts`: hooks mínimos e trace por mensagem.
- `src/lib/salon-secretary-runtime.ts`: opt-in/configuração de transporte.
- `src/lib/__tests__/jev-evaluation.test.ts`: isolamento permite apenas a ponte
  explícita para primitivas auditadas; continua proibindo runners/datasets no runtime.
- `.env.example`: Router false.
- `.env.local`: somente a nova flag false acrescentada; ignorado, não tracked/staged.
- `docs/STATUS_ATUAL.md`: estado local preparado, sem alterar estado implantado.

## Próximo passo pendente

Manifest proposto SHA-256:
`9ff12ffbc27f0a4f78986f4de1a01a6eb9b946204e9528af4a416a452075d392`.
Máximo 2 JEV HTTP reais, 3 GPT-6 inferências, zero retries/confirmações.
Teto condicional de planejamento US$0,031176; orçamento proposto US$0,04.
Reconfirmar preços e impor caps antes da futura rede. A validação NÃO foi
executada e não está implicitamente autorizada por este Gate offline.

Rollback: aplicar `SALON_SECRETARY_JEV_ROUTER_ENABLED=false` ao processo;
mantém fast-paths e restaura Luna para novas mensagens. Nenhum recurso de
banco/remoto precisa ser revertido. Instruções de rollback de código e
limitações de telemetria/preço estão em `SECRETARIA_ROUTER_V1.md`.
