# Free Use runner

Runner de avaliação do mesmo `SalonSecretary`, sem confirmação. Golden e holdout
usam o mesmo contrato `free-use-contract.ts`. O oracle só entra no scorer depois
da resposta. O executor recebe mensagens, contexto e catálogo normais do produto.
Não fornece expected, critério ou IDs de caso ao Luna.

- `node scripts/run-secretary-free-use.cjs --prepare --out packages/salon-secretary/evaluation/results/free-use/<run>` prepara Golden.
- Acrescentar `--cases <arquivo.json>` prepara uma suíte independente validada pelo mesmo contrato.
- `--run --out <mesma pasta>` exige o SHA exato do manifest em `FREE_USE_APPROVED_MANIFEST` e `FREE_USE_REAL_LUNA_APPROVED=true`. Nunca definir antes de revisão e autorização da execução.
- `--repeat K` (1..8, só no `--prepare`; rotina k=5, liberação k=8) mede pass^k: semeia K conjuntos independentes de identidades (namespace `-k1..-kK`) sob UM manifest aprovado; `--run` executa as K tentativas em sequência.
- `--mission <id>` ou `FREE_USE_MISSION_ID` escolhe a missão de custo numa allowlist fixa (padrão `secretary-reliability-20260927`); valores divergentes bloqueiam. Não existe argumento de caminho de journal.

`--prepare` prova banco/role local, faz backup, cria fixtures sintéticas independentes
uma única vez e verifica os fatos e isolamento A/B/no-context. Não faz rede.
O launcher lê `.env.local` somente dentro do processo e nunca imprime credenciais.
Todas as flags `SALON_SECRETARY_*` com valor booleano/enum são fotografadas em `manifest.flags`
(nunca chaves, segredos, projeto ou identificadores) e não são habilitadas pelo runner. Precondição ausente
produz BLOCKED. A execução rejeita fonte, implementação, fixture ou flags alteradas (`FREE_USE_FLAG_DRIFT`).

Cada missão tem um único journal fixo para Golden, holdouts e tentativas:
`secretary-final-stabilization-20260926` → `results/free-use/mission-20260926-admission.jsonl`
(teto US$ 5, praticamente esgotado, continua legível e validado) e `secretary-reliability-20260927` →
`results/free-use/mission-20260927-reliability-admission.jsonl` (teto US$ 5). Um journal nunca aceita linhas
de outra missão. Cada reserva fsync ocorre antes da rede; não há refund, reset nem escolha de outro caminho
por argumento. Teto não é autorização: cada execução continua exigindo o manifest aprovado. O teto
histórico do projeto de US$ 3 e a sessão manual de 20 não são alterados. O bound é o JSON
UTF8 integral mais 8192 tokens para framing, limitado a 64000; saída até 8192. Preços
Standard oficiais conferidos em 26/09/2026 estão selados no manifest. Payload fora do
bound bloqueia a execução; a reserva conservadora não é fatura.

Além do journal de cada missão/estágio, toda chamada paga (prática, Golden/holdout e transcrição) passa pelo
teto de GASTO REAL do programa: `program-spend.ts`, UM ledger por conta do sistema, fora de qualquer checkout ou
worktree: `~/.everflair-secretary/program-spend-20260927.jsonl` (append-only, cadeia de hash, fsync e lock
exclusivo; sem reset, refund ou caminho por argumento/env: um clone novo, outra worktree ou `results/` limpo
continuam no mesmo ledger). Âncora externa rastreada: `program-spend-anchor.json` (nesta pasta) guarda a linha
gênese e a última linha conhecida; ledger apagado, truncado ou trocado falha fechado com `PROGRAM_SPEND_JOURNAL`
em vez de valer zero. Faça commit da âncora depois de cada bateria paga. Teto `PROGRAM_REAL_CAP_USD` = US$ 3,50,
a última entrada de `PROGRAM_CAP_HISTORY` (fixo no código, sem env/CLI: US$ 2,50 em 27/09/2026; elevado pelo dono no
chat para US$ 3,50 em 28/09/2026). Cada RESERVE grava o teto sob o qual foi admitida: precisa ser um valor do
histórico, nunca menor que o da RESERVE anterior, e a própria admissão (gasto anterior + pior caso) cabe nesse teto
gravado; as linhas antigas a US$ 2,50 continuam válidas e novas admissões usam US$ 3,50.
Antes do transporte exige total do ledger + pior caso da chamada (mesma fórmula da reserva) ≤ teto; senão
`PROGRAM_SPEND_CAP` interrompe a execução e o restante fica NOT_EXECUTED (nunca PASS). O pior caso só vale para o
wire texto do Luna: o payload passa por `assertSecretaryResponsesPayload` (sem estado no servidor, tier prioritário,
ferramentas hospedadas, mídia ou background). Depois da resposta registra o custo real de `usage` (entrada não
cacheada ao maior preço entre input e cache-write, cacheada ao preço cheio de input porque não há preço de
cache-read selado, saída com reasoning); falha, ausência de `usage` ou chamada sem liquidação contam o pior caso
inteiro. Um `usage` acima do limite selado (entrada > bytes + 8192 ou saída > `max_output_tokens`) fica registrado
como gasto, interrompe a execução com `PROGRAM_SPEND_BOUND` e bloqueia toda nova admissão (parada obrigatória no
relatório). Estimadores vêm de uma lista selada (hoje só `responses`); nome desconhecido é recusado
(`PROGRAM_SPEND_ESTIMATOR`). Os lançadores pagos históricos (ultimate-10, fase A, multi-action, conversational UX,
t21, topic14, x94) não passam por este ledger e recusam com `PROGRAM_SPEND_UNWIRED`. Relatório (atualiza a âncora):
`node packages/salon-secretary/evaluation/program-spend-report.cjs [--json]` (total, restante, por origem e por
execução). `guardPaidFetch(source, fetch, {run})` é o guard genérico para novos caminhos pagos.

Cada caso tem `id`, `family`, `criterion`, `turns` e opcionalmente fixture/clock próprios.
Mensagens são literais. A próxima resposta curta só é enviada se `when.missingAny`
coincidir com a pergunta concreta anterior, derivada pelo mesmo compositor do Front.
Não adaptar respostas ou expected após iniciar a bateria.

O DSL de `expect` permite contagem/estado/confirmabilidade, operações vedadas,
campos/valores efetivos, proposta, campos de proposta, leitura/slots reais,
clarificação solicitada, grafo por operação e continuidade de draft. `$ref:<tipo>:<key>`
é resolvido só no scorer pelos IDs da fixture; nunca segue no prompt como oracle.
`index` distingue ações repetidas. `referenceTurn` usa um turno anterior da conversa
para comparar o mesmo draft/campos; `planSameAsTurn` e `planDifferentFromTurn`
verificam retomada e mudança de assunto (índices começam em 1).

Com `--repeat K`, `--max-requests` é por tentativa (máx. 500) e o binding admite K vezes esse valor, até o
limite da missão: 500 em `secretary-final-stabilization-20260926` (inalterado) e 1000 em
`secretary-reliability-20260927` (Golden 8×88 = 704, holdouts 8×108/8×112 = 864/896). O teto em US$ da missão
continua sendo a parada definitiva: reserva acima dele é FREE_USE_BUDGET_EXHAUSTED e o resto fica NOT_EXECUTED.
Uma passagem Golden reservou ~US$ 0,42 (v17), então pass^8 reserva ~US$ 3,4: conferir `missionRemainingUsd`
no `seal.json` antes de aprovar. Cada tentativa tem sua cota. Resultados por tentativa ficam em `k<i>/` (`turns.jsonl`, `results.json`,
`provider-observations.jsonl`); `results.json` na raiz traz o agregado: por caso c/n e
pass^k = C(c,k)/C(n,k), média entre casos. SAFETY_FAILURE interrompe todas as tentativas restantes;
NOT_EXECUTED e BLOCKED são UNKNOWN (nunca PASS) e anulam pass^k, com limite inferior à parte.

`PASS` cumpre invariantes observadas. `FAIL` é violação do runtime/resultado.
`BLOCKED` é precondição, custo/admissão ou infraestrutura. `NOT_EXECUTED` identifica
casos interrompidos por safety/budget. Uma clarificação correta pode ser PASS e não
contar como task completion. Métricas possuem denominadores e cobertura explícita:
turnos não observados e semântica textual não coberta são UNKNOWN, nunca zero.

O P5 observa apenas consumo iniciado pelo SDK. Falha/ausência de captura fica
UNKNOWN; não altera sessão, conteúdo, resposta ou fluxo. Guards de custo e escrita
operacional são ativos e separados. Journal/diffs backend medem efeitos reais,
enquanto nenhuma chamada `confirm` pertence ao executor.

## Gates condicionais tipados

`when` aceita `operation` e `index` opcionais para selecionar a ação (índice zero por
default), e pelo menos um predicado: `missingAny`, `reviewStatusAny`,
`temporalMissingAny`, `confirmable` ou `proposal`. Os predicados combinam AND.
Todos os predicados por ação devem corresponder à mesma ação; não se pode juntar
uma pergunta da ação A com a revisão da ação B.

`missingAny` usa a pergunta concreta. `reviewStatusAny` aceita AVAILABLE,
CONFLICT_OVERRIDABLE e CONFLICT_HARD_BLOCK. `temporalMissingAny` lê exclusivamente
`draft.temporal_missing` ou o campo homônimo do item de batch, com papéis date,
time, source_date, source_time, end_date e end_time. `confirmable` usa o estado
exposto pela UI e `proposal` verifica existência de proposta da ação. O avaliador
não infere rejeição, conflito ou intenção pelo português da resposta.

Critérios sem representação inequívoca nesses campos precisam de verificação
suplementar obrigatória. Sua ausência permanece BLOCKED/UNKNOWN; nunca presume PASS.
