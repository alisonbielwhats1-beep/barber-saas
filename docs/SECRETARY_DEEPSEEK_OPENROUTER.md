# Secretária no DeepSeek V4.1 Flash pelo OpenRouter (04/10/2026)

Decisão do dono (04/10/2026): a Secretária troca o GPT-6 Luna pelo **DeepSeek V4.1 Flash**, chamado pelo
**OpenRouter**. A transcrição de voz continua na OpenAI (`gpt-4o-mini-transcribe`). Motivo: velocidade.

## Resultado medido (Golden 30, mesmas frases e flags da prova do Luna de 30/09)

| Rodada | Casos certos | Tempo por turno (p50 / p90 / máx.) | Falhas de segurança |
|---|---|---|---|
| Luna `gpt-6-luna` (30/09, k=5) | 150/150 | 4,6 s / 6,8 s / 12,2 s | 0 |
| DeepSeek, 1ª versão (ferramenta `strict`) | 3/30 | 3,8 s / 5,6 s / 7,5 s | 0 |
| DeepSeek sem `strict` | 14–15/30 | 1,5 s / 1,8 s / 3,6 s | 0 |
| **DeepSeek sem `strict` + campos omitidos = nulo, Together** | **26/30** | **1,6 s / 2,0 s / 2,6 s** | **0** |
| Idem, rota padrão do OpenRouter | 25/30 | 1,6 s / 2,0 s / 2,2 s | 0 |
| + listas nulas = [] (clientes), Together fixo | 25/30 | 1,5 s / 1,8 s / 2,0 s | 0 |
| + temperature 0, Together, k=3 | 28, 27 e 28/30; 27/30 nas 3 (pass^3 90%) | 1,7 s / 2,2 s / 5,3 s | 0 |
| + produto no singular e jornada de profissional, k=3 | 30, 30 e 30/30 (pass^3 100%) | 1,6 s / 2,1 s / 4,5 s | 0 |
| Regra "ou sua jornada" (+15 bytes), k=3 | 30, 30 e 30/30 (pass^3 100%) | 1,6 s / 2,2 s / 8,8 s (pico isolado) | 0 |
| **Prompt final (regra "ou jornada", +11 bytes), k=3** | **30, 30 e 30/30 (pass^3 100%)** | **1,5 s / 1,9 s / 2,4 s** | **0** |

O tempo é de ponta a ponta, contando o backend. Custo real: uns US$ 0,00045 por chamada, contra uns US$ 0,002 do
Luna. Resultados em `packages/salon-secretary/evaluation/results/free-use/golden-20261004-deepseek*`, que não vão
para o git.

As falhas de cliente tinham outra causa de formato: `clear_fields` é uma lista obrigatória e o DeepSeek mandava
`null` no lugar de `[]`. Com a correção, cadastrar, alterar e consultar cliente passaram (3/3).

Na rodada final, porém, falharam GF09, GF15 e GF22, que tinham passado na rodada anterior. O DeepSeek **varia de uma
rodada para outra**; o Luna não variou (150/150 em 5 repetições). Somando as duas rodadas no Together, só GF29 (o
produto no plural) e GF30, turno 2 (continuação fora do escopo), falharam nas duas. O acerto real fica em torno de
25 a 27 de 30 por rodada.

Com `temperature: 0` (decisão do dono, 04/10), a variação quase sumiu. Na Golden com k=3, só GF15 oscilou (✓✗✓), e
falhavam sempre GF29 (o produto no plural, em pedido de 3 ações) e GF30, turno 2 (continuação de pedido fora do escopo).
As 3 rodadas custaram US$ 0,09 reais.

Correções desses dois casos, valendo para qualquer modelo:
- **Produto no plural:** `src/lib/product-name-singular.ts` e `secretary-inventory.ts`. Quando o nome como foi dito
  não acha produto, há UMA busca a mais com o nome no singular ("Óleos Aurora" → "Óleo Aurora"). Se vários produtos
  baterem, a Secretária continua perguntando. É só identidade; a prova da quantidade não muda.
- **Jornada de profissional:** em `skill-registry.ts`, "Cadastrar profissional é professional_management" virou
  "Cadastrar profissional ou jornada é professional_management" (+11 bytes). Outras redações testadas:
  - frase longa (+230 bytes): funcionava, mas estourava o orçamento do pedido numa conversa longa;
  - "ou sua jornada" (+15 bytes): no modo `full` de exemplos com cache, cabia um exemplo a menos;
  - "e jornada" e "Profissional novo ou jornada": não corrigiam o GF30. Testado antes em chamadas reais: disponibilidade, agendar e
  remarcar não mudaram. Testes migrados, com cópia em `.demo/agenda-core/contract-migration/`:
  - `secretary-structured-context-wire`: limite da configuração padrão, que já passava do teto, +11 bytes;
  - `secretary-c4-kept-day-replay`: versão de contrato atual do replay.

Com as duas correções e o prompt final: **Golden k=3 com 90/90 (pass^3 100%)**, 0 perguntas desnecessárias, 0 falhas
de segurança, 1,5 s de mediana e 1,9 s de p90. É o mesmo acerto do Luna (150/150), com cerca de 1/3 do tempo.
`contract-version.json` foi regravado depois dessa bateria; a cópia anterior está em
`.demo/agenda-core/contract-migration/`. A bateria prática (`agenda-practice`) não foi rodada de novo. A frase nova
também muda o prompt do Luna, que não foi medido de novo.

Nenhuma delas gravou nada errado: tudo depende de Confirmar.

## O que mudou

- **Modelo:** `SALON_SECRETARY_MODEL=deepseek/deepseek-v4.1-flash`, com a chave própria
  `SALON_SECRETARY_OPENROUTER_API_KEY`. A chave e o projeto OpenAI continuam sendo usados pela transcrição.
  Para voltar ao Luna: `SALON_SECRETARY_MODEL=gpt-6-luna` (na demo: `SECRETARY_DEMO_MODEL=gpt-6-luna`).
- **Formato:** o OpenRouter recebe Chat Completions (`useResponses:false` no `@openai/agents`), não o
  formato Responses da OpenAI. Só o caminho C4 (uma chamada com a ferramenta forçada, mais o reparo de
  literais) usa o DeepSeek. O agente C5 (`SALON_SECRETARY_AGENT`) e o piloto da remarcação dependem de
  recursos que só a OpenAI tem e são recusados com o DeepSeek (`SECRETARY_OPENROUTER_C4_ONLY`).
- **Trava de custo** (`packages/salon-secretary/src/openai-cost-guard.ts`, seção OpenRouter): o SDK precisa
  mandar exatamente o formato C4 (uma função local estrita forçada pelo nome, mensagens `system`/`user` só de
  texto, sem streaming, até 8192 tokens de saída), só para `https://openrouter.ai/api/v1/chat/completions`.
  Antes de enviar, a trava ajusta o pedido:
  - a ferramenta vai **sem `strict`**: com `strict`, os provedores forçavam o nosso esquema de 17 KB caractere
    por caractere, e as respostas saíam deformadas (0/5 contra 5/5 nos mesmos pedidos);
  - sem `parallel_tool_calls` e sem `store`: quase nenhum provedor declara o primeiro, e com
    `require_parameters` isso dava 404;
  - acrescenta `provider: { require_parameters: true, order: ["together"], allow_fallbacks: false }`: o servidor
    Together fica fixo (decisão do dono, 04/10). Com `SALON_SECRETARY_OPENROUTER_PROVIDER=any`, volta a rota padrão,
    só com provedores que respeitam todos os parâmetros;
  - acrescenta `temperature: 0`, para a mesma frase ter a mesma leitura;
  - acrescenta `reasoning: { enabled: false }`: com raciocínio, o modelo gastava a saída pensando e ficava 2 a 4x mais lento.
- **Resposta:** os campos obrigatórios que o modelo omitiu e que o esquema aceita como nulo viram `null`
  (`completeOmittedNulls`, guiado pelo esquema da própria ferramenta). Nunca é inventado um valor; um `anyOf`
  ambíguo fica como veio. Onde o esquema exige uma lista e não aceita nulo, `null` ou a ausência viram `[]`. Sem isso, o conferente recusava respostas certas ("Não entendi"). Nas 12 respostas
  reais capturadas, 7 cabiam no esquema antes e 12 depois. Outras duas regras: um texto escrito ao lado da
  chamada forçada é ignorado, e uma resposta cortada (`finish_reason: "length"`) conta como incompleta.
- **Opções de medição:**
  - `SALON_SECRETARY_OPENROUTER_REASONING`: `off` (padrão), `low`, `medium` ou `high`;
  - `SALON_SECRETARY_OPENROUTER_PROVIDER`: `together` (padrão), `any` (rota padrão) ou outro provedor, sempre sem reserva.
  - A fábrica do modelo lê as duas uma vez; a trava só aceita os formatos correspondentes.
- **Consumo e custo:** a telemetria lê o consumo no formato Chat Completions. A estimativa usa o **maior**
  preço de cada item entre os provedores da rota padrão (catálogo do OpenRouter em 04/10): entrada US$ 0,45,
  cache US$ 0,048 e saída US$ 2,40 por milhão de tokens. Por isso a estimativa nunca fica abaixo do custo real.

## Privacidade

Na rota padrão, o pedido pode ir para qualquer provedor do modelo no OpenRouter, inclusive os que não têm
retenção zero de dados. A Secretária envia nomes de clientes, serviços e horários. Por isso, e por ser o mais rápido,
o dono fixou o Together, que tem retenção zero (04/10).

## Gastos da validação

- **Gasto real no OpenRouter:** teto de US$ 2 (`.demo/agenda-core/local-demo-budget.cjs`, registro em
  `~/.everflair-secretary/openrouter-spend-20261004.jsonl`, com o custo que o OpenRouter informa). Em 04/10, a
  validação inteira gastou US$ 0,57. O teto de US$ 0,50 da OpenAI (transcrição) continua separado.
- **Bateria Golden** (`free-use-runner.ts`):
  - missão própria `secretary-deepseek-openrouter-20261004`. O teto é de **reservas** (o pior caso, uns
    US$ 1,75 por rodada): US$ 2, depois US$ 6, US$ 10, US$ 15, US$ 25 e US$ 35, todos aprovados pelo dono em 04/10;
  - estimador selado `openrouter-chat` no registro do programa (`program-spend.ts`), que conta para o teto
    geral de US$ 15 com preço de teto. Esse registro ficou em US$ 14,79 de 15 em 04/10, embora o gasto real do DeepSeek
    tenha sido de US$ 0,57. Novas baterias pagas (Luna ou DeepSeek) vão precisar de um teto novo do dono;
  - o DeepSeek só roda nessa missão, e o Luna nunca roda nela.
- **Rodar de novo:** `node .demo/agenda-core/golden-deepseek.cjs --prepare`, depois `--run <sha>`.
  `GOLDEN_OUT`, `GOLDEN_CASES` e `SALON_SECRETARY_OPENROUTER_PROVIDER` são opcionais.
