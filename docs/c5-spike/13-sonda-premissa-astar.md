# Sonda da premissa A\* (âncora com evidência), especificação

**Escopo autorizado pelo dono (02/10/2026):** só a prova da premissa A\*:

> "A Luna 6 consegue fornecer evidência de âncora com disciplina suficiente para que a A\* seja segura, sem o backend interpretar português?"

**Proibido nesta etapa:**
- integrar a A\* no fluxo real;
- mudar o contrato, o prompt ou o fluxo da E2-B;
- mudar a C3, a C4 ou o Agent congelado;
- qualquer coisa em produção.

**Teto pago:** US$ 0,03.

O desenho de referência é `scratchpad/anchor-design/FINAL-DESIGN.md` (A\*), com as correções da revisão final que se aplicam a um turno único (§2.3).

## 1. O que é implementado (só isto)

| Peça | Arquivo novo | Observação |
|---|---|---|
| Contrato A\* (variante da sonda) | `packages/salon-secretary/src/pilot-astar-contract.ts` | Cópia do contrato da E2-B com as mudanças da §2. O arquivo da E2-B não é tocado. |
| Prompt A\* (variante) | `packages/salon-secretary/src/pilot-astar-prompt.ts` | Regras de âncora por significado. Exemplos inventados, que passam no lint de contaminação. |
| Módulo puro de decisão | `src/lib/secretary-pilot-anchor.ts` | Leituras e decisão (§3). Só enums, números, booleanos e instantes. |
| Instrumentação da sonda | `packages/salon-secretary/evaluation/pilot-anchor-probe.ts` + `scripts/run-pilot-anchor-probe.cjs` | Lê o arquivo de casos (§5), chama a Luna 6 real pelo caminho pago guardado, pontua (§6) e para na primeira falha de segurança (§7). |
| Admissão na trava de custo | `openai-cost-guard.ts` e ledger | Só a ferramenta A\* da sonda, atrás de uma opção explícita. O comportamento padrão não muda. |
| Recuperação de bytes | só na variante A\* | Remover a `description` repetida de `mencao`, **só se** a verificação independente da §4 passar. |

## 2. Contrato A\* (variante)

- **O que é igual à E2-B:** todos os campos, exceto os operadores de deslocamento abaixo. Inclui cliente, `origem`, `destino.profissional` com `excluidos`, `observacoes`, `fora_do_escopo`, `tipo`, `resposta_a`, `desistir` e `aceita_parcial`.
- **Deslocamento de dia no destino:**

```jsonc
{ "tipo": "deslocamento", "quantidade": int[-366..366], "unidade": "dias" | "semanas",
  "data_citada": CitedDay | null,      // as 3 formas do CONTRACT-4 (data, dia da semana, mês relativo), cada uma com mencao
  "ancora": {
    "evidencia": string[0..120],       // 1º: cópia exata das palavras do dono que dizem DE ONDE contar; "" vale como null
    "tipo_evidencia": "nomeia" | "deitico" | "desloca" | "outro",   // 2º
    "tipo": "origem" | "hoje" | "data_citada"                       // 3º
  } | null,
  "mencao": string }
```

- **Deslocamento de hora no destino:** igual, com `"minutos": int[-1440..1440]` e `"hora_citada": { "hora": 0..23, "minuto": 0..59, "periodo": "manha" | "tarde" | "noite" | null, "mencao": string } | null`. A âncora usa `"tipo": "origem" | "agora" | "hora_citada"`.
- **Deslocamento usado como pista de origem:** não tem `ancora` (fora do alvo da sonda).
- **A Luna nunca declara se algo é ambíguo.** Ela só copia as palavras que nomeiam o ponto de partida, ou devolve `null` ou `outro`.
- **Significados, ensinados no prompt só por significado, com exemplos inventados e contrastes:**

| `tipo_evidencia` | Significado |
|---|---|
| `nomeia` | As palavras nomeiam o ponto de partida: o próprio atendimento, ou a data ou hora citada. |
| `deitico` | As palavras contam a partir do presente (hoje ou agora). |
| `desloca` | Um verbo que desloca o próprio atendimento por uma quantidade. |
| `outro` | Quantidade, direção, verbo que só coloca o atendimento num lugar, motivo, nome ou qualquer outra coisa. Vale como não dito. |

## 3. Módulo puro (`secretary-pilot-anchor.ts`)

- **Entrada:**
  - o campo (`DATE` ou `TIME`);
  - o operador tipado (quantidade/unidade ou minutos);
  - a alegação `{ anchor, evidenceType, contained } | null`;
  - `citedContained`;
  - os fatos:
    - o `received_at` congelado e o fuso;
    - o atendimento de origem (data e hora);
    - a referência citada tipada;
    - para hora, o dia de destino e as janelas de expediente desse dia.
- **Restrição:** nenhuma string de texto entra no módulo.
- **Leituras (uma lista por âncora factual, cada item com o valor ou um motivo de descarte):**
  - **DATE:**
    - ORIGIN = dia do atendimento + delta;
    - PRESENT = dia do `received_at` + delta;
    - CITED (só se `citedContained`) = cada leitura da data citada + delta. As leituras da citada seguem as regras atuais de `data_citada`: dia sem mês com 1 ou 2 leituras, dia da semana pelas leituras da decisão 27, mês relativo.
    - Motivos de descarte: `PAST` e `NO_SUCH_DATE`.
  - **TIME:**
    - ORIGIN = hora do atendimento + minutos, no dia de destino;
    - PRESENT = hora do `received_at` + minutos, só se o dia de destino for hoje (senão `OTHER_DAY`);
    - CITED = hora citada + minutos. Uma hora citada de 1 a 11 sem período gera h e h+12, filtradas pelo expediente (decisão 18; senão `NO_READING_IN_HOURS`).
    - Outros motivos de descarte: `LEAVES_DAY` e `NOT_AHEAD` (o resultado de hoje não está à frente de agora).
- **Decisão:**

```text
accepted = claim && claim.contained && claim.evidenceType != OUTRO
           && CONSISTENT[evidenceType] contém claim.anchor
           && (claim.anchor != CITED || citedContained)
           && existe leitura para claim.anchor
CONSISTENT: nomeia → {ORIGIN, CITED}; deitico → {PRESENT}; desloca → {ORIGIN}; outro → {}

se accepted:
  R = leituras viáveis distintas de claim.anchor
  |R| = 0 → ASK (motivo do descarte)
  |R| > 1 → ASK (opções R)                                    # correção 1 da revisão final
  se citedContained e claim.anchor != CITED e as leituras viáveis da citada diferem de R
    → ASK LITERAL_COMPETES (opções R ∪ citada)
  senão → USE R[0] (base EVIDENCE)
senão:
  se alguma leitura tem LEAVES_DAY → ASK
  V = valores viáveis distintos de todas as âncoras factuais
  |V| = 0 → ASK (descarte); |V| = 1 → USE V[0] (base COINCIDE); senão → ASK (opções V)
```

- **Decisões fixadas para a sonda:**
  - A competição da pista literal de origem (B2-SIM) fica **desligada** (correção 6).
  - Não existe a âncora PLAN (turno único).
  - Não há interruptores F1.
- **Invariantes:**
  - todo valor usado é uma das leituras calculadas;
  - uma referência citada que compete só transforma USE em ASK;
  - nada é usado a partir de uma âncora não provada, exceto quando todas as leituras coincidem.
- **Lints (testes):**
  - o módulo não tem literal de string, a não ser imports;
  - a entrada de `decideAnchor` não tem nenhum campo `string`.
- **Testes metamórficos:**
  - **M-a:** trocar a evidência por outra string contida na mensagem não muda a decisão;
  - **M-b:** evidência não contida dá o mesmo resultado que alegação null;
  - **M-d:** `outro` equivale a null;
  - **M-e:** um literal competindo só transforma USE em ASK;
  - **M-f:** a pergunta nasce dos dados.

## 4. Recuperação de bytes: verificação independente obrigatória

A remoção da `description` repetida de `mencao` na variante A\* só vale se um verificador que **não** implementou provar as quatro coisas abaixo:
1. **Redundância:** é redundância textual de schema, porque o conteúdo já está na regra 1 do prompt.
2. **Nenhuma proposição se perde:** um mapeamento proposição por proposição mostra que nada desaparece da requisição.
3. **Equivalência:**
   - o contrato da E2-B fica byte a byte igual;
   - na variante, as formas zod e a validação do schema ficam equivalentes, porque só saem chaves `description`, que são anotação. Isso é provado por diff estrutural e por um teste de propriedade.
4. **Margem:** a pior requisição real da variante A\* fica com **pelo menos 2.048 B de folga** abaixo do teto da trava de custo, que é a margem já pré-registrada.

Se qualquer item falhar, a sonda **não roda**.

## 5. Arquivo de casos (cego)

- **Arquivo:** `D:/Projetos/secretary-holdout-sealed/astar-probe/ASTAR-PROBE-24.json`.
- **Autoria e acesso:**
  - escrito por autores que não implementaram a A\* e não leem os arquivos da variante nem o prompt da E2-B;
  - conferido por um conferente independente;
  - travado como somente leitura, com o sha registrado no Adendo 12 antes de rodar;
  - os implementadores nunca abrem esse arquivo.
- **Conteúdo:**
  - cerca de 24 casos `AP01..AP24`, em ordem de execução por prioridade (`priority`);
  - gêmeos adversariais;
  - nenhuma frase de baterias anteriores;
  - nomes fora dos pools de avaliação.

```jsonc
{ "id": "AP01", "priority": 1, "twin": "AP02" | null, "covers": ["<itens da cobertura>"],
  "receivedAt": "2026-10-05T10:15:00-03:00", "timezone": "America/Sao_Paulo",
  "salon": { "name": "...", "hours": { "default": [["08:00","19:00"]], "byDate": { "AAAA-MM-DD": [["HH:MM","HH:MM"]] } },
             "team": [ { "name": "...", "services": ["..."] } ], "catalog": ["..."] },
  "appointment": { "customer": "...", "date": "AAAA-MM-DD", "time": "HH:MM", "durationMin": 60, "service": "...", "professional": "..." },
  "message": "texto do dono",
  "target": "date" | "time",
  "destinationDay": "AAAA-MM-DD" | null,          // para "time": o dia em que a nova hora cai
  "truth": {
    "offset": { "days": 2 } | { "minutes": -30 },
    "startPointNamed": true | false,
    "anchor": "ORIGIN" | "PRESENT" | "CITED" | "AMBIGUOUS",
    "evidenceSpans": ["substrings exatas que nomeiam legitimamente o ponto de partida"],
    "evidenceTypes": ["nomeia" | "deitico" | "desloca"],
    "cited": { "day": {...} | null, "clock": {...} | null },
    "citedMentions": ["substrings exatas da referência citada"] },
  "expected": {
    "readings": { "ORIGIN": [...], "PRESENT": [...], "CITED": [...] },   // só as leituras viáveis, pelas regras da §3
    "decision": "USE" | "ASK", "value": "..." | null, "options": [...] | null, "rationale": "regra em 1 linha" } }
```

**Cobertura mínima** (com gêmeos que diferem só no fato que muda o resultado):
- âncora no atendimento;
- `received_at`/agora;
- data ou hora citada;
- evidência de fato explícita;
- evidência genérica;
- deslocamento sem ponto de partida explícito;
- duas leituras plausíveis;
- âncoras diferentes com **o mesmo** resultado;
- âncoras diferentes com resultados **diferentes**.

## 6. Pontuação (o enum sozinho não pontua)

Para cada caso, em códigos:

| Métrica | Quando é correta |
|---|---|
| `EVIDENCE_OK` | **Com ponto de partida nomeado:** a evidência normalizada contém um `evidenceSpan` ou está contida nele, e está contida na mensagem. **Sem ponto de partida nomeado:** a alegação é null, `outro` ou evidência vazia. |
| `TYPE_OK` | `tipo_evidencia` está entre os `evidenceTypes` (ou é null/`outro` quando nada é nomeado). |
| `ANCHOR_OK` | A âncora é igual à da verdade. Num caso AMBIGUOUS, nenhuma alegação foi aceita. |
| `CITED_OK` | A referência citada tipada é igual à da verdade e está contida. Quando a verdade não tem referência, a Luna não deu nenhuma contida. |
| `DECISION` | USE (valor) ou ASK, comparado com `expected`. |

**Pergunta principal:** "se esta saída fosse usada no produto, poderia uma âncora semanticamente errada ser aceita em silêncio?"

## 7. Falhas de segurança (qualquer uma PARA a sonda)

| Código | Quando acontece |
|---|---|
| `S1_WRONG_ANCHOR_ACCEPTED` | Uma alegação foi aceita com âncora diferente da verdade, inclusive qualquer alegação aceita num caso AMBIGUOUS, mesmo quando o valor coincide. |
| `S2_NONEXISTENT_EVIDENCE_ACCEPTED` | Uma alegação foi aceita com evidência não contida na mensagem. |
| `S3_SILENT_AMBIGUITY` | O esperado era ASK, por ambiguidade real com leituras divergentes, e o módulo devolveu USE. |
| `S4_WRONG_VALUE_WITHOUT_ASK` | O módulo devolveu USE com um valor diferente do esperado. |

**Aviso, sem parar a sonda:** `W1_WEAK_EVIDENCE_RIGHT_ANCHOR` é uma alegação aceita com a âncora certa, mas com `EVIDENCE_OK` falso. É reportado com destaque.

## 8. Execução e parada

- **Caso a caso:** sequencial, na ordem pré-registrada.
- **Reparo de formato:** no máximo 1 por caso, como no produto.
- **Pontuação imediata:** na primeira falha S, **parar sem nenhuma chamada nova**, e a premissa fica REPROVADA.
- **Nada muda depois da largada:** nenhum ajuste de prompt nem exemplo novo.
- **Teto:** antes de cada chamada, se o gasto real mais o pior caso da próxima chamada passar de US$ 0,03, a sonda para. Os casos que ficarem sem rodar são reportados.
- **Ensaio sem rede (dry-run):** valida o arquivo e compara as leituras calculadas pelo módulo com `expected.readings`. Qualquer divergência é resolvida antes de gastar, e quem resolve é um agente isolado, só com códigos.
- **Saída:**
  - stdout só com códigos;
  - o detalhe com textos e as saídas da Luna fica na pasta selada da sonda.
- **Resultado:**
  - **PREMISSA_SEGURA** se não houver nenhuma falha S nos casos executados.
  - Também são reportados:
    - `EVIDENCE_OK`, `TYPE_OK`, `ANCHOR_OK` e `CITED_OK`;
    - as ambiguidades transformadas em pergunta;
    - as perguntas falsas (ASK quando o esperado era USE), com a referência G3 (no máximo 1 nas chamadas que esperam USE), só informativa;
    - o número de `outro`/null;
    - p50/p90, custo e a margem final do payload.
- **Depois do resultado, aprovada ou reprovada:** o trabalho **PARA** e o resultado vai para o dono.
