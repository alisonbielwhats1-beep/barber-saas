# Julgamento dos desenhos (workflow wf_795a868e-300, 30/09/2026)

Vencedor: **jit**

| Desenho | Segurança | Ganho funcional | Risco de overfitting (5 = menor) | Custo/latência (5 = melhor) | Risco de implementação (5 = menor) |
|---|---|---|---|---|---|
| tools | 3 | 3 | 3 | 2 | 2 |
| jit | 4 | 3 | 4 | 4 | 3 |

## Enxertos do desenho perdedor

- Leitor fechado de duração do A (novo src/lib/scheduling-duration-literal.ts: 'meia hora', 'N min', 'N h', '1h30'). Pôr em context_refs um deslocamento anulável com literal; o valor é sempre calculado pelo backend a partir da linha. Cobre âncora com deslocamento (OV50), que o B deixa de fora.
- Modo do profissional DELEGADO/NAO_DITO do V6 do A. O conjunto E de profissionais elegíveis e livres é recalculado no tenant. NAO_DITO ('troca de profissional sem alvo dito', OV18) vira sempre cartão com E. DELEGADO só é aceito com |E|=1; com 2 ou mais vira cartão, e com 0 vira pergunta. O B não tem como representar 'trocar sem dizer qual'.
- Aplicar o verificador também aos itens do lote atômico T21 (src/lib/secretary-batch.ts:86-118), como o A faz. Isso fecha a lacuna de prova literal de nome do par cancelar+criar apontada no MAP safety.
- Especificação V11 do A (ANCORA_ACAO: a chave precisa estar em depends_on, grafo acíclico, chave não descartada, valor rederivado em followReferences, com o fim exposto em referencedValues, src/lib/secretary-same-as.ts:35-45) como contrato da flag SALON_SECRETARY_SAME_AS_END do B, medida em rodada própria.
- Regra de decisão quantitativa pré-registrada do A: +10 pp ou mais; FALHA→PASSA pelo menos 2× PASSA→FALHA; no máximo 2 cenários PASSA→FALHA; ganho nos 30% de pelo menos 50% do ganho nos 70%; custo até 2× o controle; p90 até 13 s. Somar aos vetos mais duros do B: Golden 150/150, nenhum nível do dono perde mais de 1 cenário, zero escrita errada, nenhum timeout a mais.
- Testes adversariais do A que faltam no B: 'último' que deixou de ser o último entre o prescan e a verificação; ref de tipo errado para o campo; profissional de outro salão; dia com 200 atendimentos (truncado, teto respeitado); nome de cliente com texto de injeção.
- Contingência (a′)/A-env como estágio 2, só se a medição de recall sem custo do B ficar abaixo de 90% nos cenários-alvo: uma chamada curta com uma única ferramenta forçada (request_lookups), no molde de check_proposal (openai-cost-guard.ts:3-4). A trava continua com 1 ferramenta, tool_choice forçado e só mensagens; nada de laço com 2 ferramentas.
- Telemetria do A: 'RESOLVED' em NAME_RESOLUTION_OUTCOMES e contagens de aceite, cartão e descarte por campo, só com códigos.

## Justificativa

**Vencedor: JIT (Desenho B), com enxertos do A.** Os dois esperam ganho parecido no dono v2, bem abaixo do teto de 79,4% com T+R perfeitos:
- A: 61–79%, centro em 62–68%;
- B: 63–69%.

Com ganho equivalente, decidi por segurança, custo e risco de implementação. Nada foi editado. Não abri nada em D:/Projetos/secretary-holdout-sealed, porque a tarefa não nomeia nenhuma execução.

**O que conferi no código**

1. **O A quebra contratos vigentes.**
   - `MODEL_CALL_LIMIT` fica em `packages/salon-secretary/src/index.ts:239` (`called`) e `:321` (`maxTurns:1`), e `AGENT_RULES.md:52` manda mantê-lo.
   - A trava de custo exige 1 ferramenta e `tool_choice` forçado (`openai-cost-guard.ts:25,28,43-48`). Os itens de entrada só podem ser `message` (`:52-55`).
   - `AGENT_RULES.md:26` pede para evitar editar esse arquivo.
   - O plano do dono (seção 6, item 2) admite até 3 chamadas. Mesmo assim, o A exige aceite registrado do coordenador.
   - O B não toca em nada disso: 1 chamada + no máximo 1 reparo.

2. **O A depende de comportamento de SDK e API que ninguém verificou.**
   - `resetToolChoice` vale `true` por padrão (`agents-core/dist/agent.js:116`), e `maybeResetToolChoice` zera o `toolChoice` depois do uso de uma ferramenta (`runner/modelSettings.js:34-40`). Isso está confirmado; a mitigação do A está correta.
   - Não foi verificado se o `gpt-6-luna` aceita `function_call` sem `id` e sem `reasoning` com `store:false`.
   - Também não foi verificado se a rodada 2 reaproveita o cache da rodada 1.

3. **Latência e timeouts.**
   - O cliente corta cada chamada em 30 s (`index.ts:432`: `timeout: 30_000`, `maxRetries: 0`), e o turno inteiro em 45 s (`:321`). Isso explica, com boa probabilidade, os 15 `MODEL_REQUEST_FAILED` de cerca de 30,3 s.
   - Esses timeouts caíram justamente nos cenários pesados, que são onde o A faria a segunda rodada, com mais entrada (p90 estimado de 12–13 s).
   - No B, o acréscimo estimado é de +0,5–1 s.

4. **Orçamento de bytes.**
   - `fitRequest` mede o corpo exato com 1 ferramenta (`request-budget.ts:30-35`).
   - Os turnos de plano já têm pouca folga. O A soma ≈5,8 KB fixos, mais até 12–16 KB de resultados na rodada 2, e tende a cair em `LOOKUPS_DROPPED` nas continuações.
   - O B dimensiona o bloco pela folga; o risco é o mesmo, só que menor.
   - Tamanho do schema: o wire agrupa as operações de agenda em 2 ramos (`skill-registry.ts:444-449`) e `compactSecretaryWire` deduplica com `$defs` (`:495`). As estimativas de bytes dos dois são plausíveis, mas não foram verificadas.

5. **Segurança.**
   - As duas generalizam o precedente `applyOptionChoice`/`choiceVerdict` (`src/lib/salon-secretary.ts:1713-1761`, `src/lib/secretary-options.ts:192-223`) e mantêm intacto o caminho de escrita.
   - O B copia o valor da linha (como o `same_as`) e mantém `{value, literal}` (`AGENT_RULES.md:53`). A Luna não produz hora absoluta.
   - Na `resolucao` do A, a data e a hora absolutas são só comparadas e descartadas (V8). É saída morta, e ainda amplia a superfície da trava.
   - As duas têm a mesma semântica não provável: `edge` no B, `ancora.tipo` no A. A contenção é a mesma: prévia com a âncora e Confirmar obrigatório.
   - Privacidade: o A só lê sob demanda; o B envia a agenda dos dias citados, com clientes mascarados. É a decisão D1 do dono.

6. **Uma dúvida do B resolvida por leitura.** `choiceVerdict` não depende do formato `opt_N`: os ids são só comparados como texto e a posição vem da ordem no cartão (`statedPositions`, 'último' = tamanho do cartão, `secretary-options.ts:170`). Ele depende, porém, dos formatos de rótulo: `' · '` em `:20` e `' — '` em `:154-158`. As linhas sintéticas precisam ser montadas como `PublishedOption` com esses formatos, e o cartão na ordem do dia daquele profissional.
   - `SchedulingReferences.seeded` só aceita date, time, professional, customer e service (`src/lib/secretary-scheduling.ts:60,65`). A extensão para `end_time` e `appointment` que o B prevê é necessária.

**Correções obrigatórias antes de implementar**
- As instruções dos dois citam construções do conjunto do dono: 'com quem tiver' (OV34) no B, 'quando sair' (MV19) no A. Isso viola `AGENT_RULES.md:16`; é preciso reescrever de forma abstrata.
- O B diverge da forma aprovada ("ferramentas para a Luna", seções 6 e 7 do plano). Atende ao objetivo (dados reais, saída resolvida, backend confere, no máximo 3 chamadas), mas o coordenador ou o dono precisam registrar essa troca.

**Observação**
- 8 das 30 falhas do dono são B1 e nenhum dos desenhos trata delas; o corpus estima que, sumindo, elas levariam o teto a 91,7% (não verificado).
- O casamento de nomes por substring (`src/lib/customer-catalog.ts:34`, `contains: term`: 'Nara' casa com 'Tainara') é um bug de backend independente do spike. Deve ir para uma rodada própria, para não inflar o ganho atribuído ao B.

**Não verificado:** tokens e bytes estimados, a folga real nos turnos de plano, o recall do prescan, a latência, e a posição da ferramenta no cache.
