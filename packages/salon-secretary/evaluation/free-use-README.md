# Free Use runner

Runner de avaliação do mesmo `SalonSecretary`, sem confirmação. Golden e holdout
usam o mesmo contrato `free-use-contract.ts`. O oracle só entra no scorer depois
da resposta. O executor recebe mensagens, contexto e catálogo normais do produto.
Não fornece expected, critério ou IDs de caso ao Luna.

- `node scripts/run-secretary-free-use.cjs --prepare --out packages/salon-secretary/evaluation/results/free-use/<run>` prepara Golden.
- Acrescentar `--cases <arquivo.json>` prepara uma suíte independente validada pelo mesmo contrato.
- `--run --out <mesma pasta>` exige o SHA exato do manifest em `FREE_USE_APPROVED_MANIFEST` e `FREE_USE_REAL_LUNA_APPROVED=true`. Nunca definir antes de revisão e autorização da execução.

`--prepare` prova banco/role local, faz backup, cria fixtures sintéticas independentes
uma única vez e verifica os fatos e isolamento A/B/no-context. Não faz rede.
O launcher lê `.env.local` somente dentro do processo e nunca imprime credenciais.
Flags de overlap são fotografadas, não habilitadas pelo runner. Precondição ausente
produz BLOCKED. A execução rejeita fonte, implementação, fixture ou flags alteradas.

O journal agregado `results/free-use/mission-20260926-admission.jsonl` é único para
Golden, holdouts e tentativas. Cada reserva fsync ocorre antes da rede; não há refund,
reset nem escolha de outro caminho por argumento. O teto da missão é US$ 2. O teto
histórico do projeto de US$ 3 e a sessão manual de 20 não são alterados. O bound é o JSON
UTF8 integral mais 8192 tokens para framing, limitado a 64000; saída até 8192. Preços
Standard oficiais conferidos em 26/09/2026 estão selados no manifest. Payload fora do
bound bloqueia a execução; a reserva conservadora não é fatura.

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
