# Metodologia de avaliação da Secretária: medir aprendizado sem "decorar a prova"

Versão 2, 28/09/2026 (revisão: resultados lacrados fora do repositório, saída só com totais, registro
de provas por ID lógico, modo escolha, intervalos corrigidos para amostras pequenas, não inferioridade
com margem e checagem de decoreba por posto e moldura). Vale para a Secretária de Agenda daqui em diante.

Este documento completa o [protocolo de holdout](SECRETARY_HOLDOUT_PROTOCOL.md). O protocolo explica
**como escrever e guardar** os casos de teste. Este documento explica **como usar os números para
decidir**. Quando os dois divergirem sobre lacre, limite de olhadas ou comandos, vale este documento
(os pontos desatualizados do protocolo estão no Anexo T6).

As referências entre colchetes, como [3], estão na seção 9. Lá também aparece o que foi conferido na
fonte e o que só foi citado.

---

## Resumo para o dono (1 minuto)

- **O risco.** Corrigir a Secretária olhando as mesmas conversas que usamos para dar a nota dela. É
  como estudar com o gabarito da prova: a nota sobe, mas isso não prova que ela aprendeu. O nome
  técnico é *overfitting*. Aqui chamamos de **decoreba**.
- **O que muda.** As conversas de teste ficam em **três gavetas** separadas: treino, escolha e prova.
  A prova usa as suas mensagens lacradas. Uma versão só pode abrir a prova depois de congelada, e uma
  única vez.
- **Como saber se ela aprendeu de verdade.** Comparamos a nota do treino com a nota da prova. Se a do
  treino for bem maior, é decoreba, e paramos de corrigir pelo treino até entender o motivo.
- **Todo número vem com margem de erro.** "50 de 60" pode ser qualquer coisa entre 72% e 91%. Uma
  diferença que cabe dentro da margem conta como empate.
- **Nenhuma gravação errada é aceita.** Uma única gravação errada na agenda bloqueia a versão, qualquer
  que seja a nota.
- **Custo extra zero.** Tudo o que este documento cria roda no computador, sem chamar a Luna:
  estatística, lacre, ficha da versão, registro de olhadas e checagem de decoreba. Só as rodadas com a
  Luna real custam dinheiro, e elas continuam presas ao teto de gastos que já existe (seção 6).
- **O que ainda depende de você** (seção 7):
  - decidir o gabarito das suas mensagens, só onde dois revisores discordarem;
  - escrever umas 30 mensagens novas de reserva;
  - usar a Secretária no seu salão, com um botão "reportar";
  - decidir a liberação salão por salão.

---

## 1. Por que isso é necessário

Hoje nenhum número nosso prova que a Secretária aprendeu:

- o **Golden 30/30**, a **prática 39/40** e a escolha dos exemplos **"selected"** vieram das mesmas
  conversas usadas para achar e corrigir erros;
- por isso esses números são otimistas **por construção**, mesmo sem ninguém ter errado nada.

Um exemplo concreto, com as contas já feitas pela nova estatística sobre os runs gravados:

- no treino, a opção de exemplos "selected" ganhou de "sem exemplos" por **+8,6 pontos**;
- a margem de erro vai de **+0,5 a +16,9 pontos** (com a correção para amostra pequena de R4);
- em 13 conversas ela foi melhor, em 6 foi pior e em 45 empatou; o teste de sinais dá p = 0,17.

Parece uma vitória, mas pela regra R6 o veredito é só **não inferior**: o teste de sinais não confirma
a melhora. Além disso, "selected" foi escolhida justamente nessas conversas, entre três opções. Então
esse resultado não diz nada sobre frases novas. Só a gaveta de escolha e a prova podem confirmar.

A regra geral, seguida por quem avalia assistentes a sério, é manter uma prova que **nunca** orientou
nenhuma correção e medir nela [18]. É isso que este documento organiza.

---

## 2. Palavras usadas neste documento

| Palavra | O que significa aqui |
|---|---|
| Cenário ou caso | Uma conversa de teste: situação inicial da agenda, o que o dono diz e o resultado certo esperado |
| Gabarito (oráculo) | O estado final correto e seguro da agenda depois da conversa |
| Tentativa | Uma execução do cenário. Rodamos cada cenário K vezes, porque a Luna não responde sempre igual |
| pass^1 | Taxa de acerto por tentativa |
| pass^k | Chance de acertar **k vezes seguidas** o mesmo cenário. Mede se ela é confiável, não se acertou uma vez [1] |
| Margem de erro (intervalo de 95%) | A faixa onde a nota verdadeira provavelmente está. Com poucos casos, a faixa é larga |
| Comparação pareada | Duas versões medidas **nos mesmos casos**, caso a caso |
| Candidato congelado | Uma versão com ficha: impressão digital de cada arquivo, chaves ligadas, modelo e exemplos. Se qualquer coisa mudar, a ficha não bate mais |
| Olhada | Uma rodada da prova para um candidato. Fica registrada e tem limite |
| SAFETY | Código de falha insegura, por exemplo gravar horário, pessoa ou motivo errado, ou marcar em cima de outro atendimento |
| Regressão | Casos que já passam e precisam continuar passando. Servem para ver se algo quebrou, não para dar nota de qualidade |

---

## 3. As três gavetas

| Gaveta | O que tem dentro | Quem vê o quê | Para que serve |
|---|---|---|---|
| **Treino** (dev) | Baterias `V01`–`V34` e `N01`–`N30`; práticas antigas `A`/`B`/`C`; Golden 30; futura regressão `R..` | Todos veem tudo | Achar erros, depurar e corrigir (sempre com correção estrutural, nunca remendo para uma frase) |
| **Escolha** (validação) | `validation-v1.json`, casos `Q01`–`Q30`, fora do repositório (`D:/Projetos/secretary-validation/`), sha256 `42cb4c1628b15bcbca413dea1cb4204bf250258051d4c3f85da285ca1baf6a4c` | Implementadores recebem **só totais** | Decidir entre versões ou opções (por exemplo, qual conjunto de exemplos usar). Nunca serve para achar ou corrigir erros |
| **Prova** (teste) | Principal: holdout do dono v1 (30 mensagens) e holdout multi-ação do dono v1 (30). Secundário: holdout do assistente v1b (26). Todos lacrados fora do repositório, com sha256 no protocolo §3 | Só o coordenador e o dono. Implementadores recebem **só totais** | Medir se ela generaliza. Aberta **uma vez por candidato congelado** |

**Direção única.** Um caso pode sair da prova ou da escolha e virar treino ou regressão. Isso acontece
quando o caso motiva uma correção ou quando a gaveta se esgota. O caminho inverso nunca acontece:
nenhum caso de treino vira escolha ou prova.

**Por que as suas mensagens são a prova principal.** Elas foram escritas por uma pessoa real, do jeito
que você fala. O holdout do assistente foi escrito pela mesma família de agentes que escreveu as
baterias de treino e o banco de exemplos, com o mesmo estilo. A Shopify trocou testes montados à mão
por amostras do uso real [8].

Um autor diferente muda a nota mesmo sem decoreba [22]. Por isso comparamos diferenças e tipos de
falha, e não só a nota absoluta.

**Referências:**

- prova que nunca orientou correções [18];
- divisões de treino e teste separadas da avaliação, publicadas pela Sierra no τ²-bench [5];
- três conjuntos: treino, escolha e prova [23][25].

---

## 4. As regras

Cada regra diz o que fazemos, por que fazemos, como a ferramenta garante e em qual referência se apoia.
Os limites numéricos (5 casos, 5 pontos, 1 e 2 olhadas) são **escolhas nossas**. As referências
sustentam o princípio, não o número exato.

### R1. Três gavetas, e nenhum caso muda de gaveta sem registro

- **O que é.** A tabela da seção 3.
  - O treino pode ser lido e corrigido à vontade.
  - A escolha só mostra totais.
  - A prova só mostra totais e tem limite de olhadas.
  - Todo caso que muda de gaveta fica registrado no protocolo §3.
- **Por quê.** Se a gaveta de escolha for usada para corrigir erros, ela vira treino sem ninguém
  perceber. O mesmo vale se a prova for usada para decidir entre versões: ela vira gaveta de escolha.
- **Como é garantido.**
  - Os arquivos de escolha e de prova ficam fora do repositório, com sha256, e cada um está no
    **registro rastreado** `packages/salon-secretary/evaluation/holdout-registry.json` (R3).
  - O runner recusa rodar, no modo normal, qualquer arquivo de cenários fora do repositório
    (`AGENDA_SCENARIOS_OUTSIDE_REPO`) e qualquer cópia de uma prova ou da escolha colocada dentro dele,
    mesmo reformatada ou só com parte dos casos: pelo sha256 ou por qualquer ID de cenário registrado
    (`AGENDA_SCENARIOS_REGISTERED_HOLDOUT:<id>`).
  - A prova só roda no modo lacrado (R2 e R3); a escolha só roda no modo escolha (`--validation`).
    Os dois gravam tudo **fora do repositório** e mostram só totais.
- **Referências:** [18], [5], [23], [25].

### R2. Congelar antes de abrir a prova

- **O que é.** Antes de a prova rodar, a versão candidata ganha uma **ficha** que não muda mais. A
  ficha guarda:
  - a impressão digital (sha256) de cada arquivo em `src/`, `packages/`, `scripts/` e `prisma/`;
  - as chaves `SALON_SECRETARY_*` ligadas;
  - o modelo, o banco de exemplos e o contrato de instruções;
  - o commit do git.

  O nome da versão (`versionId`) é derivado disso tudo.
- **Por quê.** Se a versão muda depois de ver a prova, a nota da prova passa a medir outra coisa. Para
  poder voltar atrás, cada versão precisa ser uma "foto" que não se altera.
- **Como é garantido.**
  - O modo lacrado reconstrói a ficha a partir dos arquivos na hora de rodar. Se qualquer coisa
    divergir, ele recusa: arquivo (`CANDIDATE_DRIFT`), chave (`CANDIDATE_FLAGS_MISMATCH`) ou modelo
    (`CANDIDATE_MODEL_MISMATCH`).
  - Depois da rodada, ele confere de novo (`candidateStillMatches`).
  - Uma ficha editada à mão é recusada (`CANDIDATE_MANIFEST`).
- **Ordem obrigatória.**
  1. O desenvolvimento para.
  2. O dono ou o coordenador faz o commit. Agentes nunca fazem commit.
  3. Só então a versão é congelada.

  O commit entra no `versionId`, então um commit feito depois de congelar invalida a ficha. Não se
  congela enquanto outra frente ainda edita código de execução.
- **Referências.** Sierra: cada versão é uma foto imutável de código, instruções, versão do modelo e
  conhecimento [3], e isso permite voltar atrás na hora [4].

### R3. Limite de olhadas e rodízio da prova

- **O que é.**
  - Cada candidato roda cada prova **no máximo 1 vez**.
  - Cada prova serve a **no máximo 2 candidatos**, por exemplo a versão atual e uma nova.
  - Depois disso a prova está **esgotada**: vira regressão e entra a **reserva**.
- **Por quê.** Cada rodada da prova vaza um pouco de informação, mesmo que só os totais saiam. Um ciclo
  "corrige, roda a prova de novo, corrige" transforma a prova em treino aos poucos [20][21]. Casos
  que já foram usados continuam úteis como regressão: a Airbnb semeia o conjunto de testes com casos
  de incidentes anteriores [10], e a DoorDash acrescenta cada problema novo à bateria de regressão [7].
- **Como é garantido.**
  - **Registro rastreado** (`holdout-registry.json`): cada arquivo aprovado de uma prova fica sob um
    **ID lógico** (por exemplo `owner-v1`) e sua origem (o sha256 do `.txt` do dono). O modo lacrado
    recusa um sha256 que não esteja aprovado ali (`HOLDOUT_NOT_REGISTERED`); a variável de ambiente
    sozinha não basta. O registro também guarda os IDs dos cenários de cada arquivo e cada olhada gasta.
  - Um livro de olhadas fica fora de qualquer repositório (`~/.everflair-secretary/holdout-usage.jsonl`).
    Ele só aceita novas linhas, é encadeado por hash e tem uma âncora no projeto.
  - **O livro conta pelo ID lógico, não pelo sha256.** Re-derivar, reformatar ou corrigir um gabarito
    gera outro sha256 no **mesmo** ID e herda as olhadas: não zera o contador.
  - **Falha fechada.** Se o registro lista uma olhada, o livro e a âncora precisam existir e bater com
    ela (`HOLDOUT_LEDGER_JOURNAL`). Apagar o livro, trocar de worktree, clonar de novo ou apagar a âncora
    não recomeça do zero, e mover um arquivo já olhado para um ID novo também é recusado.
  - A olhada é gravada **antes** da rodada, então uma rodada interrompida também gasta a olhada.
  - Uma 2ª rodada do mesmo candidato é recusada com `HOLDOUT_CANDIDATE_USED`.
  - Um 3º candidato é recusado com `HOLDOUT_EXHAUSTED`.
  - **Os resultados já nascem fora do repositório**, em `<pasta do arquivo>/runs/` (para a prova,
    `D:/Projetos/secretary-holdout-sealed/runs/`). O runner recusa se essa pasta cair dentro de algum
    checkout (`SEALED_RESULTS_INSIDE_REPO`). Ninguém precisa mover nada à mão.
- **Regras que a ferramenta não consegue garantir sozinha:**
  - **O registro e a âncora precisam ser commitados** (pelo dono ou pelo coordenador) depois de cada
    rodada lacrada. Enquanto não forem, a proteção contra "clone novo" vale só neste checkout.
  - **Um ID lógico novo é uma prova nova.** Só o coordenador cria um, e só com casos novos. A mudança
    fica visível no diff do registro.
  - **Caso que motiva correção sai da prova.** Ele vai para a regressão (`R..`) e é substituído por um
    caso escrito por quem não viu a correção (protocolo §2, regra 3).
  - **Só totais saem da prova.** IDs de casos que falharam, frases, nomes e motivos de falha ficam com o
    coordenador e o dono (protocolo §2, regra 2). A saída do runner e do `--aggregate` já é só de totais.
  - **A reserva precisa existir antes de a prova atual se esgotar** (seção 7).
- **Referências:** [18], [10], [7]. Complementares: [20] (holdout reutilizável) e [21] (conjuntos
  privados renovados).

### R4. Margem de erro sempre

- **O que é.** Toda nota (pass^1, pass^k, acerto por família) sai com um intervalo de 95%.
  - O método principal sorteia **conversas inteiras** com reposição, 2.000 vezes. As tentativas de uma
    mesma conversa ficam juntas, porque não são independentes entre si. O nome técnico é *bootstrap
    por agrupamento*.
  - As pontas do intervalo usam a **correção para amostra pequena** (*percentil expandido*, Hesterberg
    2015): elas ficam tão largas quanto as de um intervalo t de Student. Com 5 casos o corte vai de 2,5%
    para 0,1% de cada lado; com 30, para 1,9%; com muitos casos, volta a 2,5%.
  - A "maioria" (o cenário passou em mais da metade das tentativas) ganha também um intervalo de Wilson.
- **Quanto isso pesa na prática:**
  - 50 acertos em 60 dá entre 72% e 91%;
  - 20 em 26 dá entre 58% e 89%;
  - com uns 30 casos, diferenças menores que 15 a 20 pontos não se distinguem do acaso;
  - com uns 60 casos, o limite fica perto de 10 pontos.
- **Por quê.** Com poucos casos, a nota oscila muito de uma rodada para outra.
  - A Uber não toma decisões por oscilações de uns 5% entre rodadas [11].
  - A GitHub trata diferenças "dentro da variação esperada entre rodadas" como empate [15].
  - **Correção desta versão:** o bootstrap percentil simples **não** resolve o problema das margens
    estreitas demais apontado por Bowyer, Aitchison e Ivanova (ICML 2025). Ele usa a mesma variância da
    fórmula simples e é no mínimo tão estreito quanto ela. Numa simulação offline (dificuldade parecida
    com a dos runs gravados, K=3), o intervalo simples cobria a nota verdadeira só 77% das vezes com 5
    casos, 91% com 10 e 94% com 30 (o prometido é 95%). Com a correção: 86% a 89% com 5 casos, 93% a 94%
    com 10 e 94% a 96% com 30 ou mais. **Abaixo de 10 casos o intervalo continua otimista**: com 5 casos
    que passaram todos, nenhum método tirado dos próprios dados enxerga a variação.
- **Como é garantido.** O relatório pass^k agora sempre tem a seção `STATS`
  (`agenda-practice-stats.ts`). O sorteio usa uma semente fixa, então o mesmo run dá sempre os mesmos
  intervalos.
- **Referências.** Anthropic: toda nota com margem de erro, e erros agrupados por conversa [17]. Também
  [11] e [15].

### R5. Grupos mínimos

- **O que é.**
  - Um grupo com menos de **5 cenários** nunca gera conclusão. O relatório escreve "não conclusivo".
  - Um grupo de 1 cenário não ganha intervalo.
  - As linhas por família (`capability`) são exploratórias. Como são muitas comparações ao mesmo tempo,
    uma família "melhor" ou "pior" sozinha não é evidência.
- **Por quê.** Com 2 a 5 casos por família, como hoje, qualquer diferença cabe no acaso.
- **Como é garantido.** Constante `STATS.minConclusive = 5`. O relatório marca esses grupos
  automaticamente. Na prática o piso é maior: um "melhor" ou "pior" também exige o teste de sinais
  exato (R6), que só dá p < 0,05 a partir de 6 casos na mesma direção; e "não inferior" exige pelo menos
  10 casos.
- **Referências:** [17], [11].

### R6. Comparação pareada: mesmos casos, lado a lado

- **O que é.** Duas versões são comparadas **nos mesmos cenários**. Para cada cenário, calculamos a
  diferença de acerto entre elas. O relatório mostra:
  - a diferença média, com intervalo de 95% (pareado);
  - a contagem de casos melhores, piores e empatados, com o **teste de sinais exato**;
  - o teste exato de McNemar sobre a "maioria".

  Vereditos:
  - **melhor** ou **pior**: o intervalo não contém o zero **e** o teste de sinais concorda (p < 0,05, na
    mesma direção);
  - **não inferior**: não ganhou, mas o limite inferior fica acima de **−0,05** (margem declarada antes,
    R8), com pelo menos 10 casos;
  - **inconclusivo**: qualquer outro caso. Isso inclui o intervalo de largura zero (todos os cenários
    mudaram exatamente o mesmo tanto): aí o sorteio não tem variação para medir, e não se conclui nada.

  Cenários avaliados por só uma das versões ficam de fora, e o relatório diz quantos.
- **Mesmo caso, mesma medida.** Um cenário só é pareado consigo mesmo: se a definição gravada no run
  (sha256 do cenário) mudou entre as versões, a comparação é **recusada**
  (`AGENDA_STATS_DEFINITION_MISMATCH`), porque um cenário editado é outro cenário. O relatório nomeia no
  que os braços diferem (chaves, exemplos, versão das instruções: o tratamento) e marca `CONFOUNDED`
  quando um mesmo cenário rodou com outro K ou outro perfil de ruído, ou quando um braço soma runs de
  candidatos diferentes.
- **Por quê.** Alguns casos são difíceis para qualquer versão. Comparar caso a caso tira esse ruído e
  mostra a diferença real com menos casos. Na simulação offline, o veredito antigo (só o intervalo)
  acusava melhora ou piora falsa em 6% a 11% das comparações sem diferença real; com o teste de sinais e
  a correção de R4, isso caiu para no máximo 3%.
- **Como é garantido.** Seção `PAIRED` do relatório. Runs podem ser somados com `+`, por exemplo
  V+N, e um mesmo cenário avaliado duas vezes no mesmo braço é recusado. O relatório avisa que um braço
  escolhido nos mesmos cenários é otimista por construção.
- **Exemplo real (runs gravados de treino).** "selected" contra "sem exemplos", V+N: +8,6 pontos,
  intervalo [+0,5; +16,9], 13 melhores, 6 piores, sinal p = 0,17: **não inferior**, e não "melhor". Pela
  regra antiga seria "melhor".
- **Referência.** Anthropic: comparar versões caso a caso, com diferença pareada [17].

### R7. Distância entre treino e prova (sinal de decoreba)

- **O que é.** Para o mesmo candidato, calculamos a **distância**: nota do treino menos nota da prova,
  com intervalo.
  - Se o **limite inferior** da distância passar de **5 pontos**, o relatório mostra `OVERFIT_SIGNAL`.
  - Nesse caso, **paramos de fazer correções guiadas pelo treino** até explicar o motivo.
  - A explicação vem dos tipos de falha, analisados pelo coordenador e repassados em totais.
- **Por quê.** Se a Secretária aprendeu, a nota em frases novas fica perto da nota do treino. Se só
  decorou, cai. Uma distância pequena é esperada, porque você escreve de um jeito diferente das
  baterias (mudança de estilo, não decoreba) [22]. Por isso usamos o limite inferior e uma folga de 5
  pontos, e olhamos os tipos de falha. A Intercom já teve uma mudança que ia bem nos testes de
  laboratório e piorou no uso real [12].
- **Como é garantido.** `agenda-practice-passk.cjs --gap` mostra só totais, sem nenhum ID ou texto de
  caso, e avisa se a prova compartilha IDs com o treino. Como esse comando lê a pasta do run da prova
  (fora do repositório), quem o roda é o coordenador.
- **Mesmo candidato, mesma medida.** A ferramenta compara o que cada lado registrou: chaves
  `SALON_SECRETARY_*` (sem as de execução), etiqueta dos exemplos, versão das instruções, K e perfil de
  ruído. Se diferirem, ela escreve `WARN CONFOUNDED` e diz em quê: a distância pode vir dessa diferença,
  e não de decoreba. Com esse aviso, o sinal não vale; rode os dois lados no mesmo candidato, com o mesmo
  K e o mesmo ruído. Dias diferentes aparecem só como nota.
- **Referências:** [18], [12]. Complementar: [22].

### R8. Regra para adotar uma mudança

Uma mudança só é adotada se cumprir **todas** as condições abaixo. Mudança aqui quer dizer uma versão
nova, uma chave, um conjunto de exemplos ou uma instrução nova.

1. **Ganha na gaveta de escolha além da margem.** O veredito pareado é **melhor**: o intervalo fica
   inteiro acima de zero **e** o teste de sinais exato concorda (R6), com pelo menos 5 cenários.
2. **Não perde na prova: não inferioridade com margem declarada.** A margem é **δ = 0,05** (5 pontos),
   fixada antes de qualquer rodada (`STATS.nonInferiorityMargin`). A comparação pareada na prova precisa
   dar **melhor** ou **não inferior**: o limite inferior da diferença fica **acima de −0,05**, com pelo
   menos 10 cenários. Qualquer outro resultado é **inconclusivo** e fica a versão atual ou a mais simples.
   Cada prova aceita 2 candidatos, exatamente para caber a versão atual e a nova. O coordenador roda
   `--aggregate` nas duas pastas lacradas (fora do repositório), que mostra só totais.

   **Por que não basta "o intervalo não fica inteiro abaixo de zero"** (a regra anterior): isso é ausência
   de evidência. Com 26 a 30 casos, o intervalo pareado tem uns ±10 a ±15 pontos, então uma perda real de
   10 pontos quase sempre passaria como "não perdeu". Na simulação offline, com a regra nova, uma perda
   real de 10 pontos passa como não inferior em no máximo 1,5% das vezes (30 casos: 0,3%). O preço é
   honesto: uma versão **igual** à atual, com 30 casos, só sai "não inferior" em uns 20% a 25% das vezes;
   no resto sai inconclusiva e fica a opção atual ou a mais simples.
3. **Repete o resultado.** Uma segunda rodada na gaveta de escolha, com **outra semente de ruído**
   (outros erros de digitação sorteados), mantém o veredito.
4. **Não quebra nada.** O Golden 30 continua em 100% e não aparece nenhum código SAFETY (R10 e R11).
5. **Empate fica com a opção mais simples.** A mais simples é a que tem menos chaves ligadas, menos
   exemplos, menos tokens e custo, e menos código. Exemplo: entre "sem exemplos", "selected" e
   "full", a mais simples é "sem exemplos". "Selected" só fica se ganhar na escolha e não perder na
   prova.

- **Por quê.**
  - A Uber não age sobre oscilações de rodada [11].
  - A GitHub diz que a evidência vale para a situação testada [15].
  - Para a Airbnb, uma diferença que se inverte quando se troca o avaliador não merece ir para
    produção [10].
  - A Intercom viu ganhos de laboratório sumirem no uso real [12].
  - A comparação é pareada [17].
- **Situação da condição 3.** Hoje a semente de ruído é fixa por cenário e tentativa, e o runner ainda
  não tem opção para trocá-la (pendência de custo zero, seção 8). Até ela existir, a replicação é uma
  segunda rodada independente, que varia só a aleatoriedade da Luna. O relatório precisa dizer que os
  textos com ruído foram os mesmos.
- **Referências:** [11], [15], [10], [12], [17].

### R9. Checagem de decoreba por semelhança

- **O que é.** Para cada caso da prova, medimos o quanto ele se parece com o banco de exemplos e com
  as baterias de treino.
  - A medida é a semelhança de palavras (Jaccard), depois de trocar nomes, números, **números falados**
    ("vinte e oito", "dez e meia") e dias da semana por marcadores.
  - Os casos são separados em **terços de semelhança dentro da própria prova** (baixo, médio e alto),
    e não em faixas fixas: as faixas fixas antigas (<0,2, 0,2–0,4, ≥0,4) deixavam a faixa baixa vazia
    em todos os conjuntos medidos, então o sinal nunca podia ser calculado.
  - Calculamos o acerto em cada terço, com margem.
  - O teste é a **correlação de postos de Spearman** entre semelhança e acerto, com p de permutação
    unilateral (2.000 permutações). Se a correlação é positiva, com p < 0,05 e pelo menos 10 casos
    pontuados, o relatório mostra `MEMORISATION_SIGNAL`. Em outras palavras: quanto mais parecido com o
    que ela já viu, mais ela acerta.
  - **Checagem de moldura.** O relatório conta quantas falas da prova têm exatamente as mesmas palavras
    de uma fala do banco ou do treino depois dos marcadores (Jaccard 1,0, pelo menos 5 palavras: a mesma
    frase com outros nomes, números ou dias), e quantas repetem 5 palavras seguidas, ao pé da letra.
    Esse vazamento de "molde de frase" não aparece no máximo de semelhança.
- **Por quê.** A nota geral pode estar alta só porque a prova parece com os exemplos. Os exemplos
  precisam ficar separados dos testes [18][24].
- **Como é garantido.** O `--gap` calcula os terços, a correlação e as contagens de moldura, e mostra
  só totais. Nenhum ID ou texto sai.
- **Limite conhecido.** Neste domínio as frases se parecem muito, mesmo depois dos marcadores:
  - dentro do próprio banco de exemplos, a mediana da semelhança é 0,43;
  - por isso os terços separam "mais parecido" de "menos parecido" dentro da prova, e não "parecido" de
    "novo".

  **Ausência de sinal não prova ausência de decoreba.** Com 26 a 30 casos a correlação só aparece se for
  forte. As contagens de moldura são o complemento: uma prova com várias falas de moldura idêntica ao
  banco mede, nessas falas, a cópia do molde. Ainda pendente, de custo zero: ignorar palavras comuns e
  comparar pedaços de 4 letras (seção 8).
- **Referências.** [18]. Complementares: [24] (exemplos separados dos dados de avaliação) e [22]. O
  método dos terços, da correlação e da moldura é nosso.

### R10. Nenhuma gravação errada: trava absoluta

- **O que é.** Qualquer código SAFETY, em qualquer tentativa de qualquer gaveta, impede adotar ou
  liberar a versão, qualquer que seja a nota. Exemplos: `UNEXPECTED_WRITE`, `DOUBLE_BOOKING`,
  `BOOKING_IN_BLOCK`, `REASON_NOT_LITERAL`, `AUTO_PICK_WITHOUT_QUESTION`, `PENDING_AFTER_NEGATION` e
  `NEGATED_PLAN_STILL_CONFIRMABLE` (lista completa no protocolo §6).
  - Aqui não existe margem nem empate: **uma** gravação errada já reprova.
  - Uma pergunta segura que o roteiro não previu conta como falha comum. Ela entra na nota, mas não
    trava.
  - No uso real, qualquer gravação errada executada significa desligar na hora.
- **Por quê.** Uma pergunta a mais custa segundos. Uma gravação errada na agenda custa um cliente. As
  notas são dadas pelo estado final do banco, comparado com o estado esperado [1][2]. Um teste que
  falha bloqueia a mudança [7]. Voltar atrás precisa ser rápido [4]. Os testes cobrem tanto o "deve
  agir" quanto o "não deve agir", para que ninguém tire nota alta só recusando [19].
- **Como é garantido.** A linha `SAFETY` do relatório é contada à parte, e o modo lacrado mostra o
  histograma de códigos SAFETY. As regras de segurança do programa não mudam: confirmação explícita,
  nunca escolher sozinho entre nomes parecidos e nunca transformar uma negação em ação.
- **Referências:** [1], [2], [7], [4]. Complementar: [19].

### R11. Golden 30 só como regressão

- **O que é.** O Golden 30, as práticas antigas A/B/C e os replays das respostas gravadas da Luna são
  **regressão**.
  - Eles precisam ficar sempre em 100%, com zero SAFETY, a cada versão.
  - Eles **nunca** aparecem como nota de qualidade. "Golden 30/30" quer dizer "nada quebrou", não
    "a Secretária é boa".
  - Os gabaritos deles estão congelados.
  - Cenários de treino que chegarem a pass^5 = 1 em duas versões seguidas também passam para a
    regressão, e entram casos mais difíceis no lugar.
- **Por quê.** Um teste em 100% não dá mais sinal de melhora. Além disso, esses casos orientaram
  correções.
  - Na DoorDash, a bateria de regressão roda a cada mudança de instrução e bloqueia falhas [7].
  - A GitHub mantém mais de 4.000 testes automáticos [14].
  - A Anthropic separa testes de capacidade de testes de regressão [19].
- **Como é garantido.** Replay pelo avaliador da Golden, com as saídas gravadas e sem chamar a Luna
  (Anexo T2).
- **Referências:** [7], [14], [18]. Complementar: [19].

### R12. Uso real vira teste

- **O que é.** Quando o piloto começar no seu salão:
  - um botão **"reportar"**, com seu consentimento;
  - uma pequena amostra das conversas **sem dados pessoais**: nomes trocados por marcadores, sem
    telefone e guardada por pouco tempo;
  - uma **revisão semanal** de 20 a 30 conversas.

  Cada falha vira um caso novo de regressão (`R..`), com gabarito conferido. Depois de algumas semanas,
  passamos a usar um **corte por tempo**: ajustamos com as semanas passadas e testamos com a semana
  seguinte, que ninguém viu.

  Também comparamos a nota offline de cada versão com os números do uso real: gravações erradas,
  correção logo depois de confirmar, turnos perdidos e voltas em círculo. Se os dois discordarem, vale
  o uso real, e revemos os testes.
- **Por quê.** É a prática mais comum entre as empresas pesquisadas:
  - a Airbnb sorteia 5% do uso real por dia, sem dados pessoais, e faz uma revisão semanal que vira
    testes novos [9];
  - a Shopify usa amostras do uso real [8];
  - na DoorDash, "tudo começa" em conversas reais [6];
  - na Ramp, todo erro reportado é candidato a teste [16];
  - na Sierra, as conversas anotadas viram testes [3];
  - a Intercom diz para não se apaixonar pelos testes de laboratório [12], e as conversas sinalizadas
    viram simulações [13].

  Casos inventados não dizem com que frequência cada erro acontece de verdade [18]. A ideia do corte
  por tempo vem das *Rules of ML* do Google (regra 33), citada na pesquisa sem link.
- **Referências:** [9], [8], [6], [16], [3], [12], [13], [18].

### R13. Gabarito conferido por dois, e nunca editado para passar

- **O que é.** Na bateria final, suas mensagens (texto puro) viram cenários estruturados.
  1. **Dois agentes isolados**, sem ver o trabalho um do outro, escrevem cada um os cenários e o
     resultado seguro esperado.
  2. **Você decide só onde eles discordarem**, e também nos pedidos condicionais ou ambíguos ("se não
     der", "o primeiro horário livre").
  3. O arquivo final é lacrado com sha256 **antes** da primeira rodada.

  Se, depois de uma rodada, um gabarito se mostrar errado, o caso é **anulado e substituído**. Ele
  nunca é editado para virar aprovação. Toda mudança de gabarito no treino cita a regra que a
  justifica.
- **Por quê.**
  - A Sierra e a Amazon acharam e corrigiram mais de 75 erros no **próprio gabarito** do τ-bench, cada
    um documentado com a regra que o justifica [5].
  - A Airbnb diz que, se os especialistas discordam do gabarito, é preciso parar e resolver isso
    antes [9].
  - A Shopify usa pelo menos 3 especialistas [8]. A nossa versão, com 2 revisores e você como árbitro,
    é menor.
- **Referências:** [5], [9], [8].

### R14. Liberação salão por salão

- **O que é.**
  1. Primeiro o seu salão, por umas 2 semanas.
  2. Depois 1 ou 2 salões amigos.
  3. Só então os outros.

  As **regras de parada** são declaradas antes de começar. Qualquer gravação errada executada desliga a
  Secretária. Há limites para correção logo depois de confirmar, para turnos perdidos a cada 100 e
  para voltas em círculo a cada 100. Com poucos salões, um teste A/B não tem força estatística, então
  comparamos o antes e o depois de cada salão.
- **Por quê.**
  - A Sierra libera para uma parte do tráfego antes de liberar para todos [4].
  - A GitHub coloca funcionários no modelo novo antes do lançamento [14].
  - A Intercom sobe o tráfego aos poucos e volta atrás em um passo [13].
- **Situação.** Hoje só existe ligar ou desligar para todos. A chave por salão ainda não existe (seção 8).
- **Referências:** [4], [14], [13].

---

## 5. O ciclo, passo a passo

1. **Desenvolver no treino.** V/N e regressão. Pode ver tudo e corrigir, sempre de forma estrutural.
2. **Checar sem gastar, a cada mudança.** Testes automáticos, replay do Golden 30 com respostas
   gravadas (R11), validador de baterias e preflight de ruído.
3. **Escolher entre opções**, só se houver mais de uma.
   - O coordenador roda a gaveta de escolha no modo escolha (`--validation`, pago) para cada opção e
     gera a comparação pareada com `--aggregate` (só totais).
   - Aplica a R8, condições 1, 3 e 5.
   - Implementadores recebem só os totais.
4. **Congelar.**
   1. O desenvolvimento para.
   2. O dono ou o coordenador faz o commit.
   3. A versão é congelada, e a ficha é conferida com `--check` (R2).
5. **Preflight lacrado (grátis).** Confere o hash aprovado, o local do arquivo, a ficha, o saldo de
   olhadas e o saldo de dinheiro.
6. **Rodada lacrada (paga, só o coordenador).** K=5 quando o teto permitir, com e sem ruído.
7. **Commitar o registro e a âncora** (dono ou coordenador). Os resultados já nasceram fora do
   repositório, em `<pasta da prova>/runs/`; não há nada para mover.
8. **Relatório.**
   - pass^1 a pass^k com margem;
   - SAFETY;
   - distância entre treino e prova (`OVERFIT_SIGNAL`);
   - semelhança (`MEMORISATION_SIGNAL`).

   Implementadores recebem só totais.
9. **Decidir** pela R8, R10 e R11.
   - Se a versão for adotada, segue para o piloto (R12 e R14).
   - Se não for, volta para o passo 1. A olhada gasta continua contada.

---

## 6. Custos: o que é de graça e o que custa

**Custo extra zero** quer dizer isto: **nenhuma regra deste documento cria gasto fora do teto que já
existe.**

| De graça (roda no computador, sem Luna) | Pago (Luna real, só o coordenador) |
|---|---|
| Margens de erro, comparação pareada, distância treino-prova e semelhança | Rodadas na gaveta de escolha e a replicação delas |
| Ficha da versão, modo lacrado, livro de olhadas | Rodadas lacradas da prova |
| Validador de baterias, preflight (inclui a estimativa de custo) | Rodadas novas de treino com a Luna |
| Replay do Golden 30 com respostas gravadas, testes automáticos | |

- **Teto rígido.** Toda chamada paga passa pelo teto do programa: **US$ 3,50 no total** (US$ 2,50 até 28/09, quando o dono aprovou o aumento)
  (`program-spend.ts`), com livro encadeado fora do repositório. Antes de enviar cada chamada, o teto
  confere o **pior caso** dela e recusa se não couber. Nenhum agente pode aumentar esse teto. Qualquer
  mudança é decisão exclusiva do dono.
- **Rode sempre o preflight primeiro.** Ele é grátis e mostra a reserva estimada e o saldo do programa
  (`programSpend`).
  - A reserva é um teto; o custo real costuma ser bem menor.
  - Mas, como o teto confere o pior caso de cada chamada, um run grande pode parar no meio.
- **Atenção.** O preflight da gaveta de escolha com K=5 e ruído misto estimou uma reserva de até
  **US$ 3,74**. Isso é mais que o teto inteiro do programa. O mesmo vale para a prova: o holdout do
  assistente com K=5 reserva até US$ 3,14, segundo o protocolo §3.
  - Com o teto atual, não cabem todas as rodadas com K=5.
  - É preciso escolher K menor ou priorizar, e essa decisão é sua.
  - Sugestão de prioridade: holdout do dono v1, depois o multi v1, depois a gaveta de escolha (só se
    houver mais de uma opção para decidir) e, por último, o holdout do assistente.

---

## 7. O que ainda depende do dono

1. **Gabarito das suas mensagens, com anotação dupla, na hora final (R13).** Dois agentes preparam os
   gabaritos separados. Você decide só onde eles discordarem e nos pedidos condicionais. Isso acontece
   uma vez, quando o candidato já estiver congelado.
2. **Reserva de umas 30 mensagens novas (R3).** Escritas do seu jeito, guardadas fora do repositório em
   modo somente leitura, com o sha256 anotado no protocolo §3, **sem abrir**. Elas substituem a prova
   quando ela se esgotar. Sem reserva, depois de 2 candidatos não sobra prova limpa.
3. **Piloto de uso real no seu salão (R12).** Você autoriza o botão "reportar" e a amostra sem dados
   pessoais, e decide os casos duvidosos da revisão semanal (20 a 30 conversas). O coordenador pode
   fazer a primeira triagem.
4. **Liberação salão por salão (R14).** Você decide quais salões entram e em que ordem, e aprova as
   regras de parada antes de começar.
5. **Gastos (seção 6).** Você decide quais rodadas pagas acontecem, com que K, e se o teto muda.
6. **Opcional, e ajuda bastante:**
   - 10 a 20 mensagens de uma segunda pessoa real, por exemplo uma recepcionista;
   - 20 a 30 áudios reais seus, para uma prova de voz lacrada.

---

## 8. Situação de cada peça hoje (28/09/2026)

| Peça | Situação |
|---|---|
| Margem de erro (percentil expandido), comparação pareada (teste de sinais, não inferioridade, definições iguais, `CONFOUNDED`), distância treino-prova e checagem de semelhança (terços, Spearman, moldura) | **Pronto** (`agenda-practice-stats.ts`, `agenda-practice-lib.ts`; 26 testes em `agenda-practice-stats.test.ts`) |
| Modo lacrado, registro de provas, livro de olhadas e ficha da versão | **Pronto** (`agenda-sealed.ts`, `holdout-usage.ts`, `holdout-registry.json`, `candidate-freeze.ts`, `scripts/secretary-holdout-registry.cjs`). Resultados fora do repositório; saída só com totais. O livro real e a âncora ainda não existem: são criados na primeira rodada lacrada. **O registro precisa ser commitado** |
| Relatório pass^k protegido | **Pronto**. Em pasta lacrada, de escolha ou fora do repositório, a tabela por cenário é recusada; `--aggregate` mostra só `STATS` e `PAIRED`; `--coordinator` libera a tabela para o coordenador |
| Gaveta de escolha v1 (`Q01`–`Q30`) | Escrita, lacrada fora do repositório, aprovada pelo validador estático e registrada (`validation-v1`). **Modo escolha pronto** (`--validation`): hash registrado obrigatório, resultados fora do repositório, saída só com totais, sem olhada de prova (preflight conferido em 28/09/2026: 30 casos executáveis). **Nunca rodada.** **Antes da primeira rodada**, o coordenador deve criar uma v2: uma medição offline só de totais achou 2 falas com moldura idêntica a exemplos do banco (e que favorecem justamente os braços com exemplos) e nomes que também aparecem só no banco. Ver T5. Nunca copie o arquivo para dentro do repositório |
| Trocar a semente de ruído para replicar (R8, condição 3) | Falta. Código de avaliação, custo zero |
| Arquivo de regressão `agenda-practice-regression.json` (`R..`) | Falta |
| Semelhança: ignorar palavras comuns, pedaços de 4 letras (R9) | Falta. Custo zero |
| Replay das respostas gravadas no CI | Falta. Custo baixo |
| Trocar os 17 exemplos do banco que usam nomes dos testes | Falta, fora desta etapa: os exemplos não são alterados agora |
| Chave de liberação por salão | Falta |
| Gabarito duplo das suas mensagens, reserva, piloto | Dependem do dono (seção 7) |

---

## 9. Referências

**Conferidas na fonte pela pesquisa** (arquivo `.demo/agenda-core/anti-overfitting-research.txt`,
lista "verified" e síntese):

1. Sierra, τ-bench (artigo): nota pelo estado final do banco; pass^k. https://arxiv.org/abs/2406.12045
2. Sierra, τ-bench (blog): cenários com estado final escrito e conferido à mão. https://sierra.ai/blog/benchmarking-ai-agents
3. Sierra, *Agent Development Life Cycle*: versão como foto imutável; conversas anotadas viram testes. https://sierra.ai/blog/agent-development-life-cycle
4. Sierra, *Release governance*: simulações obrigatórias, liberação para parte do tráfego, volta rápida. https://sierra.ai/blog/release-governance-guardrails-for-agents-at-scale
5. Sierra e Amazon, τ²-bench: mais de 75 correções no gabarito; divisões de treino e teste. https://github.com/sierra-research/tau2-bench (e https://github.com/amazon-agi/tau2-bench-verified)
6. DoorDash, *simulation and evaluation flywheel*: cenários a partir de conversas reais. https://careersatdoordash.com/blog/doordash-simulation-evaluation-flywheel-to-develop-llm-chatbots-at-scale/
7. DoorDash, *Dasher support automation*: bateria de regressão a cada mudança, bloqueia falhas, recebe cada problema novo. https://careersatdoordash.com/blog/large-language-modules-based-dasher-support-automation/
8. Shopify, *Sidekick*: amostras do uso real no lugar de testes montados à mão; pelo menos 3 especialistas. https://shopify.engineering/building-production-ready-agentic-systems
9. Airbnb, *Eval-driven development*: 5% do uso real por dia, sem dados pessoais; revisão semanal; "se os especialistas discordam, pare". https://airbnb.tech/ai-ml/eval-driven-development-lessons-from-evaluating-genai-at-scale/
10. Airbnb, *From weeks to a day*: conjunto semeado com casos de incidentes; diferença que se inverte ao trocar o avaliador não vale. https://airbnb.tech/ai-ml/from-weeks-to-a-day-how-we-made-llm-evaluation-fast-enough-to-iterate-on/
11. Uber, *QueryGPT*: não decide por oscilações de uns 5% entre rodadas. https://www.uber.com/us/en/blog/query-gpt/
12. Intercom (Fergal Reid, podcast): "Don't fall in love with your offline stuff". https://www.cognitiverevolution.ai/the-customer-service-revolution-building-fin-with-eoghan-mccabe-fergal-reid-of-intercom/
13. Intercom, *Evals, Releases & Monitors*: liberação gradual, volta em um passo, conversas sinalizadas viram simulações. https://www.intercom.com/blog/announcing-evals-and-releases/
14. GitHub, *How we evaluate models for Copilot*: mais de 4.000 testes offline; funcionários usam antes do lançamento. https://github.blog/ai-and-ml/generative-ai/how-we-evaluate-models-for-github-copilot/
15. GitHub, *cost-efficiency*: variação esperada entre rodadas; "a evidência vale para a situação testada". https://github.blog/ai-and-ml/github-copilot/how-we-make-ai-coding-more-cost-efficient-without-sacrificing-task-quality/
16. Ramp: todo erro reportado pelo usuário é candidato a teste. https://builders.ramp.com/post/how-to-build-agents-users-can-trust
17. Anthropic, *A statistical approach to model evaluations*: margem de erro em toda nota, erros agrupados, comparação pareada. https://www.anthropic.com/research/statistical-approach-to-model-evals
18. Hamel Husain e Shreya Shankar, *Evals FAQ* (método geral, não prática de empresa): prova que nunca orientou correções; casos inventados não mostram a frequência real. https://hamel.dev/blog/posts/evals-faq/

**Citadas na análise, sem reconferência individual** (pesquisa acadêmica ou método; usadas só como
complemento):

19. Anthropic, *Demystifying evals for AI agents*. https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
20. Dwork et al., holdout reutilizável. https://arxiv.org/abs/1506.02629
21. Scale AI, SEAL (conjuntos privados, renovados). https://scale.com/blog/leaderboard
22. Scale AI, GSM1k (conjunto escrito de forma independente revela decoreba). https://arxiv.org/abs/2405.00332
23. Stanford DSPy (treino, escolha e prova separados). https://github.com/stanfordnlp/dspy/blob/main/docs/docs/learn/optimization/overview.md
24. LangChain, exemplos few-shot separados dos dados de avaliação. https://www.langchain.com/blog/few-shot-prompting-to-improve-tool-calling-performance
25. OpenAI Cookbook, *evaluation flywheel*. https://developers.openai.com/cookbook/examples/evaluation/building_resilient_prompts_using_an_evaluation_flywheel

**Sem link no material:** Bowyer, Aitchison e Ivanova (ICML 2025, margens de erro em testes pequenos);
Recht et al. (*Do ImageNet classifiers generalize to ImageNet?*); Google *Rules of ML*, regra 33;
Hesterberg (2015), *What Teachers Should Know About the Bootstrap* (intervalo percentil expandido).

As margens de erro deste documento (72–91%, +0,5 a +16,9 pontos) e as taxas das simulações (cobertura,
vereditos falsos) são **contas nossas** sobre runs locais e simulações offline, não números das empresas.

---

## Anexo técnico

### T1. Método estatístico

- **Configuração** (`STATS` em `packages/salon-secretary/evaluation/agenda-practice-stats.ts`):
  `resamples 2000`, `seed 'agenda-practice-stats-v1'`, `level 0.95`, `minConclusive 5`,
  `overfitMargin 0.05`, `nonInferiorityMargin 0.05`, `alpha 0.05`, `permutations 2000`,
  `frameMinTokens 5`, `ngram 5`. Cada estatística usa seu próprio fluxo aleatório, então o resultado
  não depende da ordem das chamadas.
- **pass^1 e pass^k:**
  - bootstrap por cenário: os cenários são sorteados com reposição e as tentativas de cada um ficam
    juntas;
  - **percentil expandido** (Hesterberg 2015): as pontas usam a cauda Φ(−√(n/(n−1))·t₀,₉₇₅;ₙ₋₁) no
    lugar de 0,025 (n = 5: 0,001; n = 10: 0,009; n = 30: 0,019; n = 64: 0,022). O quantil t vem de uma
    tabela exata para 1 a 3 graus de liberdade e da expansão de Cornish-Fisher (A&S 26.7.5, erro menor
    que 0,001) acima disso. Na diferença entre dois grupos independentes, vale o menor grupo;
  - Wilson sobre a "maioria" do cenário (mais da metade das tentativas; um empate de 1/2 não passa);
  - o bootstrap vira um ponto quando todos os cenários de um grupo têm a mesma taxa (por exemplo, todos
    passam dá [1, 1]). Por isso o Wilson sai sempre ao lado.
- **Pareado** (`pairedComparison`):
  - diferença de pass^1 por cenário nos IDs comuns; recusa (`AGENDA_STATS_DEFINITION_MISMATCH`) quando
    o sha256 canônico da definição gravada do cenário difere entre os braços; conta os pares sem
    definição gravada, com outro K e com outro perfil de ruído;
  - bootstrap pareado por cenário (percentil expandido);
  - teste de sinais exato nos cenários melhores e piores (empates fora);
  - McNemar exato sobre a maioria (b = só a base passa, c = só o candidato passa);
  - vereditos (`verdictOf`): `n<5 not conclusive`; `inconclusive` com intervalo de largura zero;
    `better`/`worse` quando o intervalo exclui 0 e o teste de sinais concorda (p < 0,05); `noninferior`
    quando não ganhou, n ≥ 10 e o limite inferior passa de −0,05; senão `inconclusive`.
- **Simulação offline** (sem Luna; dificuldade parecida com a dos runs gravados, 1.000 repetições,
  400 sorteios cada, K = 3 e 5):
  - cobertura do intervalo de pass^1: n = 5: 0,86–0,88; n = 8: 0,91–0,92; n = 10: 0,93–0,94;
    n = 30: 0,94–0,95; n = 64: 0,95–0,96 (antes: 0,77 / 0,89 / 0,91 / 0,94 / 0,95);
  - "melhor" ou "pior" falso sem diferença real: no máximo 3,0% (antes: 6% a 11%);
  - "não inferior" falso com perda real de 10 pontos: no máximo 1,5% (n = 10), 0,3% (n = 30).
- **Distância** (`generalizationGap`):
  - pass^1(dev) − pass^1(held), com os dois lados sorteados de forma independente;
  - `OVERFIT_SIGNAL` quando o limite inferior passa de 0,05;
  - `confounded`: diferenças de chaves (sem `SALON_SECRETARY_ALLOW_PAID_CALLS`), etiqueta de exemplos,
    versão das instruções, K e perfil de ruído entre os dois lados, e braços que somam runs de
    candidatos diferentes.
- **Semelhança** (`heldSimilarity`, `aggregateSimilarity`):
  - para cada cenário da prova, o máximo do Jaccard de tokens das falas (`say`), já mascaradas;
  - comparado com `bank.json` e com as baterias de treino. Só entram arquivos
    `agenda-practice-(variations|natural|scenarios[-rN]).json`, para que um arquivo futuro de escolha
    ou de regressão nunca conte como treino;
  - máscara:
    - nomes do fixture base, dos clientes e profissionais do cenário, dos nomes no gabarito e dos nomes
      do banco;
    - dígitos;
    - números falados (dois a cinquenta, "primeiro"; "um", "uma" e "meia" só depois de "e" dentro de
      um número), de modo que `{{d:+2|dw}}`, "28" e "vinte e oito" dão o mesmo marcador;
    - dias da semana;
  - mensagens com menos de 3 tokens só contam quando o cenário não tem nada mais longo;
  - terços por posto dentro da prova (empates no mesmo terço);
  - Spearman com intervalo bootstrap (descritivo) e p de permutação unilateral;
    `MEMORISATION_SIGNAL` quando rho > 0, p < 0,05 e há pelo menos 10 cenários pontuados;
  - moldura: falas com o mesmo conjunto de tokens mascarados de uma fala do corpus (pelo menos 5
    tokens) e falas com uma sequência igual de 5 palavras (sem máscara, sem acento e em minúsculas);
  - os IDs por cenário ficam só na memória.

### T2. Comandos

Todos a partir da raiz do worktree, no PowerShell. Nenhum usa Production.

Relatório de um run com margens de erro (grátis):

```
node packages/salon-secretary/evaluation/agenda-practice-passk.cjs <run-dir> [--out passk.json] [--no-write]
```

Comparação pareada (grátis). O primeiro braço é a base, e `+` soma runs:

```
node packages/salon-secretary/evaluation/agenda-practice-passk.cjs <off-v>+<off-n> <selected-v>+<selected-n> <full-v>+<full-n> --no-write
```

Só totais (grátis; o único modo para pastas lacradas, de escolha ou fora do repositório na frente de
implementadores): por run, cobertura, contagem de SAFETY e `STATS`; depois `PAIRED`. Rótulos de família
que não são códigos simples ficam de fora. Nunca grava nada:

```
node packages/salon-secretary/evaluation/agenda-practice-passk.cjs <run-a>[+<run-b>] [<run-c>[+<run-d>] ...] --aggregate
```

Nessas pastas protegidas (marcador `sealed-run.json`/`validation-run.json`, pasta fora do checkout ou
IDs de uma prova registrada), a tabela por cenário é recusada (`AGENDA_PASSK_PROTECTED_RUN`). Só o
coordenador a pede, com `--coordinator`.

Distância treino-prova e semelhança (grátis, só totais, seguro para um run da prova; rodado pelo
coordenador, porque lê a pasta do run da prova):

```
node packages/salon-secretary/evaluation/agenda-practice-passk.cjs --gap <dev-v>+<dev-n> <held-run> [--out gap.json]
```

Use `--no-write` sempre que as pastas forem evidência em `results/**`. Sem ele, a ferramenta regrava
`passk.json` dentro de cada pasta de run, como sempre fez.

Registro de provas (grátis; `--register` e `--retire` só pelo coordenador; imprime só códigos e
contagens):

```
node scripts/secretary-holdout-registry.cjs --list
node scripts/secretary-holdout-registry.cjs --register <arquivo fora do repositório> --id <id lógico> --kind test|validation [--source-name <nome> --source-sha256 <sha256>]
node scripts/secretary-holdout-registry.cjs --retire <id lógico>
```

Na bateria final, o arquivo estruturado derivado do `.txt` do dono entra no ID que já existe
(`owner-v1` ou `owner-multi-v1`). Uma versão corrigida ou re-derivada entra no **mesmo** ID e herda as
olhadas. Registrar de novo um arquivo já aprovado preenche os IDs dos cenários, que hoje estão vazios
(`null`) em `assistant-v1` e `validation-v1`.

Congelar o candidato (grátis). Liste **todas** as chaves `SALON_SECRETARY_*` que a rodada vai ver,
inclusive as que o runner força e as do `.env.local`. O valor de `SALON_SECRETARY_EXAMPLES` abaixo é
só um exemplo:

```
node scripts/secretary-freeze-candidate.cjs --model gpt-6-luna --flag SALON_SECRETARY_EXAMPLES=selected --flag SALON_SECRETARY_JEV_ROUTER_ENABLED=false --flag SALON_SECRETARY_MULTI_ACTION_V2_ENABLED=true --flag SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED=true [...]
node scripts/secretary-freeze-candidate.cjs --check <versionId>
```

A ficha fica em `.demo/agenda-core/candidates/<versionId>.json`.

Versão do contrato do modelo (grátis; `--write` só pelo coordenador, depois da Golden e da prática dos
perfis que mudaram; ver `docs/SECRETARY_INSTRUCTIONS_AND_CONTRACT_VERSION.md`):

```
node scripts/secretary-contract-version.cjs --check
node scripts/secretary-contract-version.cjs --write
```

Preflight lacrado (grátis). Mostra as olhadas que ainda restam e não precisa de aprovação de gasto:

```
$env:AGENDA_HOLDOUT_APPROVED_SHA256='<sha256>'; node scripts/run-agenda-practice.cjs --sealed <arquivo fora do repositório> --candidate <versionId> --repeat 5 --preflight
```

Rodada lacrada (paga, só o coordenador; `--noise mixed` dá a tentativa 1 limpa e as outras com ruído):

```
$env:AGENDA_HOLDOUT_APPROVED_SHA256='<sha256>'; $env:AGENDA_PRACTICE_REAL_APPROVED='true'; node scripts/run-agenda-practice.cjs --sealed <arquivo fora do repositório> --candidate <versionId> --repeat 5 [--noise mixed]
```

Regras do modo lacrado:

- o sha256 precisa estar aprovado no registro, como prova (`test`) ativa, e bater com
  `AGENDA_HOLDOUT_APPROVED_SHA256`;
- `--scenarios`, `--only` e `--label` são recusados;
- `--closed-day` passa a ser `fail` por padrão;
- tudo vai para `<pasta do arquivo>/runs/sealed-<id lógico>-<sha8>-<ts>/`, fora do repositório:
  transcripts, `report.json`, `passk.json`, `console.log`, `sealed-scenarios.json` (por cenário: ID,
  c/n, `PASS`/`FAIL`/`NOT_GRADED` por tentativa e códigos, só para o coordenador e o dono) e
  `sealed-report.json`;
- o terminal e `sealed-report.json` têm **só totais**: pass^1 e pass^k com intervalos, maioria
  (Wilson), taxas por família (n < 5 marcado), histograma SAFETY, cobertura e contagens. Nenhum ID de
  cenário, frase, nome ou motivo.

Gaveta de escolha (modo escolha; pago só na rodada real; sem candidato e sem olhada de prova; o
registro precisa ter o sha256 como `validation`):

```
Get-FileHash -Algorithm SHA256 D:/Projetos/secretary-validation/validation-v1.json   # deve dar 42cb4c16…6a4c
node .demo/agenda-core/validate-battery.cjs D:/Projetos/secretary-validation/validation-v1.json --prefix Q
node scripts/run-agenda-practice.cjs --validation D:/Projetos/secretary-validation/validation-v1.json --repeat 5 --noise mixed --preflight
$env:AGENDA_PRACTICE_REAL_APPROVED='true'; node scripts/run-agenda-practice.cjs --validation D:/Projetos/secretary-validation/validation-v1.json --repeat 5 --noise mixed --label <braço>
node packages/salon-secretary/evaluation/agenda-practice-passk.cjs <pasta-braço-a> <pasta-braço-b> --aggregate
```

Não use `--verbose` na frente de implementadores. `--scenarios`, `--only`, `--sealed` e `--candidate`
são recusados no modo escolha. Os resultados vão para `D:/Projetos/secretary-validation/runs/`, e o
preflight mostra quantas rodadas de escolha já existem (`priorRuns`). Rodar a escolha várias vezes é
permitido, mas cada rodada também vaza um pouco: use-a só para decidir entre opções já prontas.

Golden 30 (regressão): o coordenador roda o replay das respostas gravadas da Luna com o avaliador da
Golden, `.demo/agenda-core/golden-replay-all.ts`. Ele existe só neste worktree, usa o banco local
descartável e não chama a Luna.

### T3. Códigos de recusa

- Prova e escolha:
  - `HOLDOUT_SHA_NOT_APPROVED`, `HOLDOUT_SHA_MISMATCH`, `HOLDOUT_INSIDE_REPO`, `HOLDOUT_FILE`,
    `HOLDOUT_PARSE`;
  - `HOLDOUT_NOT_REGISTERED`, `HOLDOUT_KIND` (prova no modo escolha ou o contrário),
    `HOLDOUT_RETIRED`, `HOLDOUT_REGISTRY_MISMATCH` (IDs do arquivo diferentes dos registrados),
    `HOLDOUT_REGISTRY`, `HOLDOUT_REGISTRY_MISSING`, `HOLDOUT_REGISTRY_*` do registro;
  - `SEALED_RESULTS_INSIDE_REPO`;
  - `HOLDOUT_CANDIDATE_USED`, `HOLDOUT_EXHAUSTED`, `HOLDOUT_LEDGER_*`.
- Candidato: `CANDIDATE_REQUIRED`, `CANDIDATE_UNKNOWN`, `CANDIDATE_MANIFEST`, `CANDIDATE_DRIFT`,
  `CANDIDATE_FLAGS_MISMATCH`, `CANDIDATE_MODEL_MISMATCH`.
- Runner: `AGENDA_SEALED_ARGUMENT`, `AGENDA_VALIDATION_ARGUMENT`, `AGENDA_SEALED_EMPTY`,
  `AGENDA_CLOSED_DAY`, `AGENDA_SCENARIOS_OUTSIDE_REPO`, `AGENDA_SCENARIOS_REGISTERED_HOLDOUT:<id>`.
- Relatório pass^k: `AGENDA_PASSK_PROTECTED_RUN`, `AGENDA_STATS_DEFINITION_MISMATCH`.

### T4. Arquivos

| Arquivo | Papel |
|---|---|
| `packages/salon-secretary/evaluation/agenda-practice-stats.ts` | Bootstrap com percentil expandido, Wilson, McNemar, teste de sinais, pareado (definições, `CONFOUNDED`, não inferioridade), distância, semelhança (terços, Spearman, moldura) |
| `packages/salon-secretary/evaluation/agenda-practice-lib.ts` | Campo `stats` no relatório pass^k e seção `STATS`; sha256 da definição de cada cenário; perfil de cada braço (chaves, exemplos, versão, K, ruído) |
| `packages/salon-secretary/evaluation/agenda-practice-passk.cjs` | Relatório, `+`, `PAIRED`, `--no-write`, `--gap`, `--aggregate`, proteção das pastas lacradas, de escolha e fora do repositório (`--coordinator`) |
| `packages/salon-secretary/evaluation/agenda-sealed.ts` | Modo lacrado e modo escolha: registro, resultados fora do repositório, saída só com totais |
| `packages/salon-secretary/evaluation/holdout-usage.ts` | Registro de provas e livro de olhadas por ID lógico (1 por candidato, 2 candidatos por prova), falha fechada |
| `packages/salon-secretary/evaluation/holdout-registry.json` | Registro rastreado: IDs lógicos, origem, arquivos aprovados, IDs dos cenários, olhadas. Estado da avaliação, fora da ficha da versão. **Deve ser commitado** |
| `packages/salon-secretary/evaluation/candidate-freeze.ts`, `candidate-contract.ts` | Ficha da versão (âncoras e registro fora do hash) |
| `scripts/secretary-freeze-candidate.cjs` / `.ts` | Linha de comando da ficha |
| `scripts/secretary-holdout-registry.cjs` / `.ts` | Linha de comando do registro (`--list`, `--register`, `--retire`) |
| `scripts/run-agenda-practice.ts` | `--sealed`, `--candidate`, `--validation` e os bloqueios `AGENDA_SCENARIOS_OUTSIDE_REPO` e `AGENDA_SCENARIOS_REGISTERED_HOLDOUT` |
| `src/lib/__tests__/agenda-practice-stats.test.ts`, `agenda-practice-sealed.test.ts`, `secretary-holdout-usage.test.ts`, `secretary-candidate-freeze.test.ts` | Testes |
| `~/.everflair-secretary/holdout-usage.jsonl` | Livro de olhadas (fora do repositório; criado na primeira rodada lacrada) |
| `packages/salon-secretary/evaluation/holdout-usage-anchor.json` | Âncora do livro. É criada na primeira rodada lacrada e deve ser commitada como `program-spend-anchor.json`. Com uma olhada no registro, a falta dela é recusada |
| `D:/Projetos/secretary-validation/validation-v1.json` e `.sha256` | Gaveta de escolha v1 (somente leitura) |
| `<pasta da prova ou da escolha>/runs/` | Resultados completos das rodadas lacradas e de escolha (fora do repositório) |

### T5. Limites conhecidos

- **Semelhança com pouca força** (R9). Além disso, a máscara só troca nomes declarados. Um nome que
  aparece só no texto de uma fala e em nenhuma definição do cenário não é mascarado.
- **A pasta lacrada contém texto dos casos**, mas nasce fora do repositório (`<pasta da prova>/runs/`),
  ao lado do arquivo lacrado. Quem implementa não abre essa pasta (AGENT_RULES).
- **O relatório normal lista IDs e motivos de falha.** Ele agora é recusado em pastas lacradas, de
  escolha, fora do checkout ou com IDs de uma prova registrada. O `--coordinator` libera; nunca o use na
  frente de implementadores. Repasse só `--aggregate` ou `--gap`.
- **A recusa por ID só vale para IDs registrados.** Hoje `assistant-v1` e `validation-v1` têm `ids:
  null`: uma cópia parcial desses arquivos só é pega pelo sha256 exato. O coordenador preenche os IDs
  com `--register` (T2).
- **Quem edita o registro pode criar um ID novo.** Isso é visível no diff e só o coordenador pode fazer
  (R3). O registro e a âncora só protegem outros checkouts depois de commitados.
- **Rodadas de escolha não têm limite.** O preflight só conta quantas já existem (`priorRuns`).
- **Intervalos com menos de 10 casos continuam otimistas** (R4): famílias pequenas são exploratórias.
- **Independência da gaveta de escolha v1** (medição offline de outro agente, só com totais, sem IDs nem
  textos). Nada foi copiado, mas as frases vêm da mesma distribuição das baterias de treino:
  - 8 de 30 casos repetem uma sequência de 5 palavras das baterias (base de comparação: 11 de 30 nos
    casos N);
  - 2 falas têm moldura idêntica a exemplos do banco (Jaccard 1,0 depois dos marcadores). Isso favorece
    justamente os braços com exemplos, que é a decisão para a qual a gaveta existe;
  - 32 de 33 etiquetas de família e 21 de 50 nomes são compartilhados (7 só com o banco);
  - o autor leu o harness e o contrato de campos obrigatórios, e não há segundo anotador.

  **Pendência do coordenador (não de implementadores):** antes da primeira rodada da escolha, trocar ou
  reescrever esses 2 casos numa v2 (novo sha256, registrada com `--register` no ID `validation-v2` ou no
  mesmo ID) e trocar os nomes que só aparecem no banco. Relatar a escolha com e sem esses casos. Trate a
  gaveta como do mesmo autor e da mesma distribuição; as provas do dono seguem sendo o único teste
  independente.
- **A ficha é rígida.** O commit faz parte do `versionId`, então o commit vem antes de congelar. Todas
  as chaves efetivas precisam ser listadas; o preflight lacrado mostra os nomes que divergirem.
- **Janela entre início e conferência.** O código é carregado quando o processo começa e conferido logo
  antes da rodada. A conferência depois da rodada pega edições feitas durante ela, mas não a janela
  curta entre o início do processo e a primeira conferência.
- **Gaveta de escolha v1:**
  - tem um só autor, um agente do mesmo programa, e nenhum segundo revisor de gabarito;
  - alguns casos dependem de como a Secretária formula a pergunta;
  - sob ruído, o teste de maiúsculas de um caso só vale na tentativa limpa;
  - com 30 casos, só diferenças de uns 15 a 20 pontos são distinguíveis.
- **O `passk.json` ficou maior.** O novo campo `stats` acrescenta de 10 a 20 KB.
- **Git no PATH.** A ficha precisa do `git` disponível.

### T6. Pontos desatualizados no protocolo de holdout

Os pontos abaixo de `docs/SECRETARY_HOLDOUT_PROTOCOL.md` foram superados por este documento. O
protocolo não foi editado nesta etapa.

- **§4.** O preflight e a rodada com `--scenarios D:/Projetos/secretary-holdout-sealed/...` agora são
  recusados (`AGENDA_SCENARIOS_OUTSIDE_REPO`). A prova roda só com `--sealed` e `--candidate` (T2).
  O relatório pass^k por cenário e o `Move-Item` descritos ali não se aplicam mais.
- **§2, regra 7.** Os resultados já nascem fora do repositório (`<pasta da prova>/runs/`); não há o que
  mover.
- **§6.** A frase "o runner ainda não tem modo selado" deixou de valer: o modo lacrado existe.
- **§3.** A tabela de arquivos selados agora tem uma versão legível por máquina, que é a que vale para
  o runner: `packages/salon-secretary/evaluation/holdout-registry.json` (IDs `assistant-v1`, com a v1
  como origem e a v1b como arquivo aprovado; `owner-v1`; `owner-multi-v1`; `validation-v1`). Cada olhada
  fica gravada automaticamente no livro e no registro; a anotação à mão no §3 (data, `versionId` e
  totais) continua útil para o dono. Re-selar uma prova é registrar o arquivo novo no **mesmo** ID, e a
  herança de olhadas é automática (R3).
