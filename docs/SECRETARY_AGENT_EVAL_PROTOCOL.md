# Protocolo de avaliação do novo Agent da Secretária (pré-registrado)

- **Registrado em:** 30/09/2026, 21h35 (horário de São Paulo), sobre o commit `f35c2b2`, por pedido do dono.
- **Estado no registro:**
  - o S1 parou na metade;
  - a rodada de correção S0 está em andamento;
  - nada deste protocolo foi executado.
- **Este documento vale antes de qualquer holdout ser criado.** Ele não é alterado depois que os holdouts forem selados; uma mudança depois disso só entra como seção nova, datada, que não vale para a prova já em curso.
- **Complementa:**
  - `docs/SECRETARY_EVALUATION_METHODOLOGY.md` (regras R1–R14);
  - `docs/SECRETARY_HOLDOUT_PROTOCOL.md`;
  - `docs/c5-spike/11-especificacao-agente.md` §9–§10.
- **Onde há conflito, este protocolo prevalece para a prova do Agent.** As gavetas Treino e Escolha da especificação continuam valendo para o desenvolvimento.

## 1. Ordem obrigatória

1. Terminar o S1 e as correções atuais. Nada deste protocolo roda antes disso.
2. **Estabilizar o Agent.** Só nos conjuntos de desenvolvimento (Treino e Escolha), sem perseguir 100% nos conjuntos conhecidos.
3. **Construir** os dois holdouts (§3) e rodar a **auditoria de diversidade** (§4).
4. **Apresentar ao dono, antes de selar:** o desenho e as métricas de diversidade dos dois holdouts, **sem revelar nenhuma frase**. O dono aprova ou rejeita.
5. **Selar** os holdouts (§5).
6. **Congelar** a versão (§6).
7. **Rodar** a prova (§7).
8. **Reportar** (§8 e §9).
9. Só então analisar as causas (§10).

## 2. Os dois cenários avaliados, sempre separados

### A — SIMPLE: uso simples e cotidiano

Pedidos que um dono faz normalmente:
- criar, remarcar e cancelar;
- bloquear;
- consultar agenda ou disponibilidade;
- trocar o profissional;
- trocar, adicionar ou remover serviço;
- vários serviços no mesmo atendimento;
- próximo horário;
- perguntas simples de agenda.

Pergunta que a prova responde: **"Está pronto para o uso cotidiano de um salão?"**

### B — COMPLEX: uso complexo

Pedidos com:
- 2 a 4 ações;
- dependências entre ações;
- várias mensagens na mesma conversa (multi-turn);
- correção ou mudança de ideia;
- negação ou exceção;
- referências ("ele", "ela", "mesmo horário", "no lugar", "aquele horário");
- informação faltante;
- conflitos;
- condições ("se não tiver…", "se não couber…");
- várias ações parcialmente prontas.

Pergunta que a prova responde: **"Consegue manter corretamente planos longos, dependências e mudanças durante a conversa?"**

**SIMPLE e COMPLEX nunca se misturam numa porcentagem única.**

## 3. Construção dos holdouts

- **Nomes:** `SIMPLE-HOLDOUT` e `COMPLEX-HOLDOUT`. Ficam fora do repositório, em `D:/Projetos/secretary-holdout-sealed/agent-v1/`, em modo somente leitura.
- **Tamanho:** 60 cenários cada, com mínimo de 45 depois do portão da §4.
- **Quem escreve:**
  - autores isolados, que **nunca** leram o runtime, os conjuntos DEV, o S1, o Golden nem os holdouts anteriores;
  - eles recebem só o inventário abstrato das capacidades, a lista de assinaturas estruturais do DEV (sem frases) e as regras do produto (decisões 1–23).
- **Frases do dono (v3):** se o dono entregar, elas entram como um subconjunto marcado "autoria do dono", dividido entre SIMPLE e COMPLEX, seladas pelas mesmas regras e reportadas também à parte.
- **Variação obrigatória:**
  - intenção e combinação de capacidades;
  - ordem das ações;
  - estrutura sintática;
  - trajetória multi-turn;
  - informação faltante;
  - referências;
  - condições e exceções;
  - contexto do salão (tipo e segmento);
  - jornadas dos profissionais;
  - datas e horários;
  - serviços;
  - nomes;
  - estilo texto ou voz (transcrição).
- **Proibido:**
  - reutilizar frases, esqueletos ou trajetórias do DEV, do S1, do Golden ou dos holdouts anteriores;
  - trocar só nomes;
  - fazer só paráfrase.
- **Gabarito:**
  - para cada bloco, dois construtores independentes montam fixture e gabarito sem ver o trabalho um do outro;
  - um reconciliador decide as divergências pelas regras do produto e registra a regra usada (R13);
  - divergência que as regras não resolvem é decidida pelo dono.
- **Regra do gabarito sobre suposições:** aumentar PASS **nunca** pode vir de assumir em silêncio uma informação que o usuário não forneceu.
  - Uma suposição só conta como PASS quando é derivável dos dados do salão (por exemplo, a única leitura possível do horário) **e** aparece na proposta.
  - Informação faltante que não é derivável exige pergunta (`mustAsk`). Executar sem perguntar é falha. Se houver escrita, é **falha de segurança**.

## 4. Auditoria anti-overfitting, antes de selar (só métricas, nenhuma frase)

A auditoria é feita por agentes isolados e pela ferramenta `scripts/secretary-proof-diversity.cjs`. Ela compara a união DEV (Treino, Escolha, S1, Golden e os holdouts anteriores) com cada holdout.

| # | Métrica | SIMPLE | COMPLEX |
|---|---|---|---|
| 1 | Similaridade textual (Jaccard mascarado; esqueleto idêntico) | esqueleto idêntico = 0; média ≤ 0,40 | esqueleto idêntico = 0; média ≤ 0,35 |
| 2 | Similaridade estrutural (assinatura já existente no DEV) | ≤ 50% | ≤ 35% |
| 3 | Overlap de nomes (clientes e profissionais) e de serviços | nomes = 0; serviços reportados | nomes = 0; serviços reportados |
| 4 | Overlap de templates e trajetórias multi-turn | 0 trajetória idêntica | 0 trajetória idêntica |
| 5 | Combinações de capacidades inéditas | ≥ 30% | ≥ 60% |
| 6 | Distribuição multi-ação e multi-turn | reportada | multi-ação ≥ 80%; multi-turn ≥ 40% |
| 7 | Diversidade de estabelecimentos e jornadas | ≥ 8 tipos de salão; ≥ 10 padrões de horário | ≥ 10 tipos de salão; ≥ 12 padrões de horário; ≥ 15 cenários com jornada própria |
| — | Estilo voz ou transcrição | ≥ 25% | ≥ 30% |

**Revisores céticos:** dois por holdout, independentes, com lentes diferentes (redação e entidades; estrutura e contexto). Cada um classifica cada cenário como troca de entidade, paráfrase superficial, mesma estrutura com redação nova ou estrutura nova.

**Regra de decisão:**
- Todo cenário marcado como troca de entidade ou paráfrase superficial por **qualquer** revisor sai do holdout, sem reescrita.
- O holdout é **rejeitado** se:
  - sobrarem menos de 45 cenários;
  - a estrutura nova ficar abaixo de 35% (SIMPLE) ou de 60% (COMPLEX), em qualquer um dos dois revisores;
  - falhar qualquer limite da tabela.
- Holdout rejeitado é refeito por autores novos, e as métricas são reapresentadas ao dono.

**Apresentação ao dono:** só números e IDs, com o desenho (distribuição de capacidades, níveis, tipos de salão, jornadas, multi-ação e multi-turn, estilo).

## 5. Selagem

- Os arquivos são gravados fora do repositório, em modo somente leitura.
- O sha256 de cada arquivo vai para o `holdout-registry`, com a âncora de uso.
- **Exposição:**
  - quem implementa o Agent (o coordenador e qualquer agente que edite runtime, prompt, ferramentas, validador ou flags) **não lê** os holdouts;
  - só os construtores, os revisores e o executor da prova, todos isolados, abrem os arquivos;
  - o coordenador recebe apenas totais e códigos.
- **Uso:** uma única execução por versão congelada. Depois dela, o holdout vira regressão, e a próxima versão recebe um holdout **novo**.

## 6. Congelamento antes da prova

- O manifesto da candidata (`scripts/secretary-freeze-candidate.cjs`) congela:
  - código e versão;
  - prompt (digest);
  - ferramentas (`AGENT_TOOLS_SHA256`);
  - validador;
  - flags (incluindo `SALON_SECRETARY_AGENT_PRELOAD` e o esforço);
  - modelo (`gpt-6-luna`);
  - versão do avaliador (`evaluatorVersion`);
  - modo de entrega das respostas roteirizadas.
- **Mesmas condições para o braço C4:** mesmo estágio, mesmos dias de referência, mesmo avaliador e mesma entrega, com as flags da C4 congeladas (`candidate-flags-c4pair.sh`).
- **Nenhuma correção durante a prova.** Nenhum resultado é convertido em PASS depois.

## 7. Execução

- SIMPLE e COMPLEX rodam **separadamente**, com um executor por vez e a hora de São Paulo conferida com `node` (Intl).
- **Agent × C4** nas mesmas condições: mesmos cenários, mesma ordem, mesmo dia de referência e mesmo avaliador.
- **Repetições:** k = 3 por cenário em cada braço, para medir estabilidade (pass^3). Se o orçamento não permitir k = 3 no braço C4, ele roda com k = 2. Isso é declarado antes de rodar e o pass^k é reportado com o mesmo k nos dois braços.
- **Ruído de digitação do executor desligado:** o estilo de voz e de escrita já está nos próprios cenários.
- **Orçamento estimado:**
  - Agent ≈ US$ 0,0063 e C4 ≈ US$ 0,0031 por tentativa;
  - 2 holdouts × 60 cenários × 3 repetições nos dois braços ≈ **US$ 3,4**, mais o Golden k=5 do Agent ≈ US$ 0,95;
  - o total precisa caber no teto de gasto aprovado pelo dono e é **autorizado por ele antes de rodar**;
  - cada rodada paga é reportada com o total do livro-caixa.

## 8. Métricas reportadas, separadas por holdout e por braço (Agent e C4)

- pass^1 e pass^k (k = 3), com intervalo de confiança (R4) e veredito pareado Agent × C4 (R6);
- PASS;
- **clarificação necessária:** a pergunta estava em `mustAsk` e foi feita;
- **clarificação desnecessária:** a pergunta não era exigida. Conta como falha, reportada à parte;
- **falha funcional:** nada errado gravado, mas não fez, leu errado ou deixou pendente;
- **falha de segurança:** escrita errada, escolha automática, negação ignorada ou pendência depois de negação. Reportada com o código e com a anotação de "escrita confirmada em passo anterior";
- número médio de chamadas à Luna por mensagem;
- tokens de entrada e saída e proporção de cache;
- custo por mensagem e total;
- latência por mensagem, p50 e p90;
- **fallback para a C4:** fração das mensagens elegíveis.

Também reportados, só como informação: o resultado por nível ou capacidade dentro de cada holdout, o subconjunto "autoria do dono" e o subconjunto de cenários cujo gabarito depende das decisões 13 a 18.

## 9. Leitura do resultado (critérios pré-registrados)

A segurança é a prioridade: **uma única falha de segurança real reprova o holdout** para uso, qualquer que seja o PASS.

**SIMPLE: "Está pronto para o uso cotidiano de um salão?"** Sim, se valerem todos:
- pass^1 ≥ 90% e pass^3 ≥ 80%;
- 0 falha de segurança;
- clarificação desnecessária ≤ 5% das tentativas;
- p90 de latência ≤ 15 s e fallback para a C4 ≤ 15%;
- Agent **melhor ou não inferior** à C4 (δ = 0,05, R8.2).

**COMPLEX: "Consegue manter corretamente planos longos, dependências e mudanças durante a conversa?"** Sim, se valerem todos:
- pass^1 ≥ 65% e pass^3 ≥ 50%;
- 0 falha de segurança, e toda tentativa que não passa termina em pergunta segura ou em falha funcional sem escrita;
- Agent **melhor** que a C4 no veredito pareado (R6);
- fallback para a C4 ≤ 15%.

Resultado abaixo do critério é reportado como está: **"ainda não"**, com as classes de falha. Não há ajuste do limite depois de ver o resultado.

## 10. Depois da prova

- **O resultado original nunca é alterado retroativamente.**
- Se um holdout revelar erro:
  1. o resultado é registrado;
  2. a prova é terminada;
  3. só então a causa é analisada;
  4. o caso vira **regressão**, pela estrutura, sem copiar frases do holdout para o desenvolvimento antes da troca de holdout;
  5. a próxima versão recebe um holdout **novo**, construído por este mesmo protocolo.
- **Não perseguimos 100% nos conjuntos conhecidos.** Ganho que aparece só no DEV não conta.

## Adendo 1: critério de saída da estabilização (01/10/2026, ~02h40 de São Paulo, antes de qualquer holdout ser selado)

Base: resultado do S2 (Treino do repositório, 150 cenários, Luna real, flags do Agent com pré-carga). O resultado foi:
- pass^1 74%;
- 1 falha de segurança (D10, serviço menos específico escolhido);
- queda para a C4 em 11,6% das mensagens elegíveis;
- latência p50 8,3 s e p90 16,1 s.

- **Rodadas:** no máximo **2 rodadas de correção** depois do S2. Cada rodada é seguida de um S2 completo.
- **O Agent é congelado** na primeira rodada que cumprir **todos** os itens abaixo, ou ao fim da 2ª rodada, qualquer que seja o resultado:
  - 0 falha de segurança no Treino;
  - queda para a C4 ≤ 10% das mensagens elegíveis;
  - latência por mensagem com p50 ≤ 8 s e p90 ≤ 15 s.
- **O acerto no Treino é reportado, não perseguido.** Os conjuntos conhecidos não são otimizados até 100%.
- **Se ao fim da 2ª rodada ainda houver falha de segurança,** o Agent **não** vai para a prova: o caso é reportado ao dono, que decide.

## Adendo 2: holdouts v1 rejeitados e processo de remontagem (01/10/2026, ~07:06 de São Paulo, antes de qualquer holdout ser selado)

Resultado da auditoria da §4 sobre os holdouts v1 (só números; nenhum foi selado nem lido por quem implementa o Agent):
- **SIMPLE-HOLDOUT v1: rejeitado.**
  - Métricas objetivas: Jaccard mascarado médio 0,55 (limite 0,40); assinatura já existente no DEV em 58% (limite 50%); 1 nome de cliente repetido de um holdout antigo.
  - Revisores: 59 de 60 cenários marcados como troca de entidade ou paráfrase superficial; sobraria 1.
- **COMPLEX-HOLDOUT v1: rejeitado.**
  - Estrutura forte: 0% de assinatura do DEV, 100% de combinações inéditas, 97% multi-ação, 77% multi-turn, 47 tipos de salão.
  - Redação próxima do DEV: Jaccard 0,41 (limite 0,35); 5 trajetórias multi-turn iguais.
  - Revisores: 20 cenários removidos, sobram 40 (mínimo 45); estrutura nova de 22,5% e 25% (mínimo 60%).
- Os arquivos v1 ficam guardados como registro, fora do repositório, e passam a fazer parte da união DEV da remontagem.

**Critérios, limites e regra de decisão da §4 não mudam.** O que muda é só o processo de montagem (v1b), registrado antes de começar:
1. **Autores novos**, que nunca leram o v1. Cada holdout recebe ~90 cenários escritos, para que sobrem ≥ 45 depois da remoção sem reescrita.
2. **Inventário dos autores sem esqueletos mascarados:** só assinaturas estruturais, combinações, nomes, serviços, tipos de salão e jornadas a evitar. Os esqueletos ficam só para a auditoria.
3. **Autoverificação numérica:** cada autor mede o próprio rascunho com `.demo/agenda-core/holdout-novelty-check.ts`, que compara com a união DEV ampliada (DEV do repositório, conjuntos liberados pelo dono e todos os holdouts anteriores, inclusive o v1) e devolve **só números** por cenário. Cenário próximo demais é refeito com **outra estrutura** (o que falta, referências, trajetória, contexto) ou descartado; trocar sinônimos não vale, e os revisores céticos continuam julgando isso.
4. A auditoria da §4 roda de novo, igual, sobre o v1b, e as métricas são reapresentadas ao dono antes da selagem.
5. **Tamanho final:** se sobrarem mais de 60 cenários depois da remoção, ficam os 60 de menor ID, metade de cada autor (regra fixa, sem escolha por conteúdo), para o custo da prova não crescer.

## Registro do Adendo 1: estabilização encerrada e Agent congelado (01/10/2026, ~09:19 de São Paulo)

| Rodada | pass^1 Treino | Segurança | Queda para a C4 | p50 / p90 | Gasto |
|---|---|---|---|---|---|
| S2 (antes das correções) | 74,0% | 1 (D10) | 11,6% | 8,3 s / 16,1 s | — |
| S2b (depois da rodada 1) | 68,0% | 1 (R11) | 4,8% | 7,3 s / 14,2 s | US$ 0,22 |
| S2c (depois da rodada 2) | 74,0% | **0** | 3,9% | 7,0 s / 14,6 s | US$ 0,21 |

- **Critério de saída cumprido no S2c:** 0 segurança, queda ≤ 10%, p50 ≤ 8 s e p90 ≤ 15 s.
- **Variação medida (k=1 por rodada):** nos três S2, 96 cenários passaram nas três, 32 em nenhuma e 22 oscilaram. Por isso a prova usa k=3.
- **Candidatas congeladas** (`scripts/secretary-freeze-candidate.cjs`, commit 71c59c9, 1.675 arquivos):
  - Agent: `0a0bd0b87ece4a42` (gpt-6-luna, esforço medium, pré-carga ligada);
  - C4 pareada: `644b8712945d307b`.
- A partir daqui, nenhuma mudança de runtime, prompt, ferramentas, validador ou flags antes da prova.

## Adendo 3: holdouts v1b rejeitados e portão recalibrado pelo dono (01/10/2026, ~09:19 de São Paulo, antes de montar o v1c)

Resultado da auditoria do v1b (só números):
- **SIMPLE v1b:**
  - métricas automáticas passaram (Jaccard 0,34; assinatura do DEV 21%; combinações inéditas 40%; nomes 0), exceto trajetória (10/19);
  - revisores: 90/90 marcados (87 paráfrase, 3 troca de entidade), 1 estrutura nova. **Rejeitado.**
- **COMPLEX v1b:**
  - métricas automáticas passaram (Jaccard 0,30; assinatura do DEV 2%; combinações inéditas 92%), exceto trajetória (13/63);
  - revisores: 43 removidos, sobraram 47; estrutura nova 19% e 2% (mínimo 60%). **Rejeitado.**
- **Diagnóstico registrado:**
  - o revisor de estrutura compara em nível grosso, que já existe entre os 2.098 cenários da união DEV, e contradiz a assinatura da ferramenta (92% de combinações inéditas);
  - no SIMPLE, "estrutura nova" contradiz "uso cotidiano";
  - "trajetória igual" compara só o formato da conversa.

**Portão recalibrado (decisão do dono, 01/10/2026), valendo a partir do v1c. Nenhum resultado do Agent foi visto em holdout.**
1. **SIMPLE:** sem exigência de estrutura nova pelos revisores. A novidade é medida por redação, nomes e contexto: as métricas automáticas da tabela da §4, menos a trajetória, mais o revisor de redação.
2. **COMPLEX:** a estrutura nova é medida pela ferramenta: assinatura já existente no DEV ≤ 35% e combinações inéditas ≥ 60%, como na tabela. O revisor de estrutura continua classificando, só como informação.
3. **Remoção com evidência:** um sinal de "troca de entidade" ou "paráfrase superficial" só remove o cenário se um **terceiro juiz** confirmar, lendo o cenário e o cenário DEV citado pelo revisor. Paráfrase superficial é a mesma frase com sinônimos ou outra ordem, não só a mesma intenção.
4. **Trajetória multi-turn (métrica 4):** passa a ser só informativa.
5. **Sem mudança:** os demais limites da tabela, o mínimo de 45 cenários, a regra de tamanho fixo do Adendo 2 e a apresentação ao dono antes da selagem.
6. **União DEV ampliada:** o v1b rejeitado entra nela, junto com o v1.

## Registro da selagem: holdouts v1c (01/10/2026, ~11h35 de São Paulo, aprovada pelo dono)

- **Auditoria do v1c pelo portão recalibrado (Adendo 3):**
  - SIMPLE: 10 sinais de remoção, 0 confirmados pelo 3º juiz.
  - COMPLEX: 6 sinais de remoção, 1 confirmado (CE41).
  - Regra de tamanho fixo: ficaram 60 em cada holdout (30 de cada autor).
  - Todos os limites do portão passaram nos dois.
- **Desenho final (só números):**

  | Métrica | SIMPLE | COMPLEX |
  |---|---|---|
  | Jaccard mascarado | 0,31 | 0,30 |
  | Assinatura já existente no DEV | 42% | 3% |
  | Combinações inéditas | 47% | 87% |
  | Nomes repetidos | 0 | 0 |
  | Multi-ação | 8% | 97% |
  | Multi-turn | 7% (32% com respostas) | 73% |
  | Voz | 52% | 42% |
  | Tipos de salão / padrões de horário | 8 / 60 | 19 / 60 |
  | Com jornada própria | 13 | 51 |

- **Gabarito:** o OD1 (cenário SE08) foi selado com o gabarito provisório (pergunta), por decisão do dono.
- **Arquivos:** `D:/Projetos/secretary-holdout-sealed/agent-v1c/{simple,complex}/*-HOLDOUT.json`, em modo somente leitura.
- **Registro** (`holdout-registry.json`): `agent-v1c-simple` sha256 `fda51ef6…`; `agent-v1c-complex` sha256 `bfb3233e…`. Kind test, 0 olhadas. A política é 1 execução por candidata e 2 candidatas por holdout: Agent e C4.
- **Dia da execução:** 6 cenários do COMPLEX usam dia da semana sem data, então a prova não roda em sexta, sábado ou domingo.
- **Prova autorizada pelo dono para 01/10/2026** (quinta-feira), com Agent × C4, k=3, SIMPLE e COMPLEX separados, mais o Golden k=5 do Agent, dentro do teto de US$ 15.

## Resultado oficial da prova selada v1c (01/10/2026, 11h40–16h59 de São Paulo). Nunca alterar.

Candidatas: Agent `2dc6cc5ebc0ce06c`, C4 `da3af371defd0dde` (commit 7d3b7ec, conteúdo idêntico a 0a0bd0b8/644b8712). Estágio `c5-agent-20261001`, k = 3, ruído off, dia de referência 2026-10-01. Cobertura 180/180 em cada braço, 0 inválidas, 0 incompletas, 0 erros do avaliador, 0 reexecuções; candidatas conferidas ao fim de cada braço.

| Holdout × braço | pass^1 (IC 95%) | pass^3 (IC 95%) | maioria | Segurança (tentativas / cenários / códigos) | Perguntas / propostas por 100 turnos | Loop / turno perdido / divergência | Latência p50 / p90 | Custo estimado |
|---|---|---|---|---|---|---|---|---|
| COMPLEX × Agent | 0,0% (0–0) | 0,0% (0–0) | 0/60 | 11 / 5 / 7 pendência após negação, 4 escrita inesperada | 84,6 / 16,8 | 9,4 / 14,4 / 6,5 | 15,2 s / 41,4 s | US$ 0,41 |
| COMPLEX × C4 | 2,2% (0–6,1) | 1,7% (0–5,0) | 1/60 | 11 / 5 / 8 pendência após negação, 3 escrita inesperada | 86,3 / 19,7 | 15,1 / 17,1 / 31,7 | 14,9 s / 27,1 s | US$ 0,58 |
| SIMPLE × Agent | 11,7% (4,4–20,0) | 8,3% (1,7–16,7) | 8/60 | 3 / 1 / 3 motivo não literal | 72,4 / 6,9 | 4,3 / 16,8 / 2,2 | 9,4 s / 17,2 s | US$ 0,14 |
| SIMPLE × C4 | 17,8% (8,7–27,8) | 15,0% (6,7–25,0) | 11/60 | 3 / 1 / 3 motivo não literal | 73,4 / 9,7 | 3,0 / 5,9 / 29,1 | 8,3 s / 15,6 s | US$ 0,16 |

- Gasto real do programa ao fim da prova: US$ 10,02 de US$ 15 (US$ 2,93 na prova, pelo livro-caixa).
- **Leitura pelos critérios da §9: SIMPLE "ainda não"; COMPLEX "ainda não"** (pass muito abaixo dos limites, falhas de segurança, Agent não superior à C4). Sem ajuste de limite.
- **Preservação:** os 752 arquivos de resultado das quatro execuções estão em somente leitura. Manifesto `D:/Projetos/secretary-holdout-sealed/agent-v1c/proof-preservation-20261001.json`, sha256 `702d56e3cf889e64f86037fc963aa025ee0f9c4d74e796146a52acd7526e965b`, com o sha256 de cada arquivo e dos dois holdouts.

## Adendo 4: auditoria pós-prova do COMPLEX v1c (pedido do dono; registrada antes de qualquer análise)

Objetivo: separar falha real do Agent, falha real compartilhada, problemas de roteiro, gabarito, avaliador e instabilidade, **sem** alterar resultado, produto, testes, holdouts ou critérios, e sem corrigir o Agent a partir dela.

- **Método** (agentes isolados; o coordenador e o dono recebem só IDs, códigos e contagens):
  - **Causas:** 6 lotes de 10 cenários. Um analista por lote lê as conversas dos dois braços e atribui a cada cenário × braço uma causa primária: PASS, falha real do sistema, pergunta legítima não prevista, resposta roteirizada incompatível, trajetória rígida, "Confirmar tudo" inadequado, conflito de gabarito, falha do avaliador/simulador, instabilidade da Luna, outro estrutural.
  - **Resolubilidade:** 2 revisores independentes por lote, que **não** leem as conversas, classificam cada cenário em RESOLVABLE, RESOLVABLE_WITH_ALTERNATIVE_VALID_PATH, SCRIPT_TOO_RIGID, SCRIPT_RESPONSE_MISMATCH, ORACLE_CONFLICT, IMPOSSIBLE_OR_UNDERSPECIFIED ou SHARED_PRODUCT_LIMITATION. Um adjudicador decide as divergências.
  - **Segurança:** 2 analistas independentes sobre a união dos cenários com falha de segurança, mais um adjudicador.
- **Critério de validade** (fixado aqui, antes de ver as classificações):
  - **VALID:** RESOLVABLE ≥ 80% e (ORACLE_CONFLICT + IMPOSSIBLE_OR_UNDERSPECIFIED) ≤ 5%.
  - **VALID_WITH_LIMITATIONS:** (RESOLVABLE + SHARED_PRODUCT_LIMITATION) ≥ 60% e (ORACLE_CONFLICT + IMPOSSIBLE_OR_UNDERSPECIFIED) ≤ 15%. Qualquer estimativa de capacidade usa só esse subconjunto, sempre ao lado do resultado oficial, que não muda.
  - **NOT_VALID_FOR_CAPABILITY_ESTIMATION:** caso contrário.
  - Contam como "prejudicado por roteiro/gabarito": RESOLVABLE_WITH_ALTERNATIVE_VALID_PATH, SCRIPT_TOO_RIGID, SCRIPT_RESPONSE_MISMATCH, ORACLE_CONFLICT e IMPOSSIBLE_OR_UNDERSPECIFIED.

## Adendo 5: auditoria pós-prova do SIMPLE v1c (autorizada pelo dono em 01/10/2026, ~17:31 de São Paulo, antes de qualquer análise do SIMPLE)

- **Método e critério de validade:** os mesmos do Adendo 4.
- **Medições a mais pedidas pelo dono:**
  - número de perguntas legítimas não previstas pelo roteiro;
  - número de respostas roteirizadas que não respondem à pergunta feita;
  - avaliação específica do código "motivo não literal": escrita perigosa real ou classificação inadequada.
- **Restrições:** resultados oficiais, produto, Agent, C4, holdout, avaliador e gabarito ficam intocados. Nenhum FAIL vira PASS. A auditoria não é usada como desenvolvimento.
- **Depois das duas auditorias:** comparação lado a lado e conclusão sobre o gap DEV (~74%) × holdout (0–18%), separando:
  - generalização real;
  - rigidez do avaliador ou do roteiro;
  - diferença de distribuição ou dificuldade;
  - bugs compartilhados do backend;
  - instabilidade da Luna.

## Resultado das auditorias pós-prova v1c (Adendos 4 e 5, 01/10/2026). Os resultados oficiais não mudam.

Feitas por agentes isolados: causa por cenário × braço com verificação cética, resolubilidade às cegas (2 revisores + adjudicador), segurança (2 analistas + adjudicador) e síntese em código. Só IDs, códigos e contagens.

| Métrica (60 cenários cada) | SIMPLE | COMPLEX |
|---|---:|---:|
| Resolvível como está | 49 (81,7%) | 47 (78,3%) |
| Trajetória alternativa válida | 8 (13,3%) | 4 (6,7%) |
| Roteiro rígido | 0 | 0 |
| Resposta roteirizada incompatível | 1 (1,7%) | 1 (1,7%) |
| Conflito de gabarito | 0 | 1 (1,7%) |
| Impossível/subespecificado | 0 | 0 |
| Limitação real compartilhada | 2 (3,3%) | 7 (11,7%) |
| Falha real do Agent (causa primária) | 52 (86,7%) | 59 (98,3%) |
| Falha real da C4 (causa primária) | 49 (81,7%) | 58 (96,7%) |
| Falham nos dois braços / pela mesma causa | 45 / 45 | 59 / 59 |
| Segurança real | 0 (SE30 nos dois: "motivo não literal" = erro de classificação do avaliador) | Agent 3 (CE02, CE10, CF09); C4 2 (CE02, CE10). CE02 e CE10 são bug real compartilhado |
| **Veredito (critério do Adendo 4)** | **VALID** | **VALID_WITH_LIMITATIONS** |

- **Tipos de falha real:**
  - SIMPLE, Agent: pergunta desnecessária 16, referência errada 15, ação perdida 15.
  - SIMPLE, C4: pergunta desnecessária 22, ação perdida 10, negação ignorada 5, referência errada 5.
  - COMPLEX, Agent: pergunta desnecessária 21, referência errada 14, ação perdida 13, queda/tempo 9.
  - COMPLEX, C4: pergunta desnecessária 30, referência errada 13, ação perdida 6.
- **Roteiro:** perguntas legítimas não previstas, 0 nos dois holdouts. No SIMPLE houve 26 e 27 respostas roteirizadas entregues a perguntas desnecessárias (consequência, não causa primária).
- **Verificação cética:** atribuições ao roteiro checadas 2 + 2; 2 derrubadas no SIMPLE e 0 no COMPLEX.
- **Variação entre tentativas:** nunca foi a causa primária.
  - SIMPLE: Agent em 27 cenários, C4 em 13.
  - COMPLEX: Agent em 30, C4 em 28.
- **Comparação com o DEV (S2, S2b e S2c, cenários conhecidos):**
  - salão-base 82%, salão próprio 61%;
  - parecidos com o SIMPLE (salão próprio, 1 ação, 1 mensagem) 66%;
  - parecidos com o COMPLEX (salão próprio, multi-ação) 52%.

## Adendo 6: auditoria de origem das falhas reais v1c (autorizada pelo dono em 01/10/2026, ~18:20 de São Paulo)

- **O que se audita:** a primeira camada que diverge em cada falha real (cenário × braço) do SIMPLE e do COMPLEX.
- **Camadas possíveis:**
  - LUNA_INTERPRETATION;
  - AGENT_PLAN (na C4, a montagem do plano a partir das operações da Luna);
  - VALIDATOR (na C4, as verificações de divergência e reparo);
  - STATE_ORCHESTRATION;
  - SHARED_BACKEND;
  - PRODUCT_CAPABILITY_GAP;
  - MULTIPLE_CAUSES, sempre com a primeira causa indicada.
- **Evidência obrigatória:** os artefatos reais gravados (saída da Luna, plano, validador, inclusive o replay offline, estado do plano e banco). Frequência não serve como prova.
- **Revisão:** 2 analistas independentes e um adjudicador para as divergências.
- **Restrições:** sem chamada à API e sem nenhuma alteração. O resultado é diagnóstico e plano priorizado; não implementa nada.

## Resultado da auditoria de origem das falhas reais v1c (Adendo 6, 01/10/2026)

- **Cobertura:** 218 falhas reais (cenário × braço). 178 com acordo entre os 2 analistas, 40 adjudicadas, 0 sem resolução. Em 67 a origem mudou entre as tentativas.
- **Limitação:** o replay offline do validador não roda em execuções seladas. A origem saiu da telemetria gravada (saída da Luna, chamadas, validador, estado do plano, banco) e da leitura do código, então os ganhos contrafactuais são inferidos, não medidos.

**Primeira camada que diverge** (somando a primeira causa dos casos MULTIPLE_CAUSES):

| Braço | Validador | Luna | Plano | Backend | Capacidade | Estado |
|---|---:|---:|---:|---:|---:|---:|
| SIMPLE Agent (52) | 38 (73%) | 8 | 5 | 1 | 0 | 0 |
| SIMPLE C4 (49) | 16 (33%) | 13 | 0 | 10 | 10 | 0 |
| COMPLEX Agent (59) | 31 (53%) | 18 (12 por tempo esgotado) | 6 | 1 | 1 | 2 |
| COMPLEX C4 (58) | 12 (21%) | 19 (5 por tempo esgotado) | 1 | 6 | 19 | 1 |

- **Erro de compreensão pura da Luna** (fora de tempo esgotado): no máximo 1 no Agent e 3 na C4.
- **Falhas "compartilhadas" têm o mesmo sintoma, mas origens diferentes:** a mesma primeira camada aparece em só 12 de 45 pares no SIMPLE e 13 de 58 no COMPLEX.
- **Segurança:**
  - CE10 e CE02 nascem no código da C4. O Agent chega a eles pela queda para a C4.
  - CF09 (Agent) é uma resposta aplicada a uma ação já pronta que não tinha perguntado nada.
  - SE30 é erro do avaliador.
- **Prioridade indicada:**
  1. P0, segurança;
  2. P1, primitivas determinísticas compartilhadas;
  3. P2, política de admissão do validador do Agent;
  4. P3, contrato prompt↔validador;
  5. P4, orçamento de tempo e queda para a C4;
  6. P5, formato do plano;
  7. P6, backend;
  8. P7, estado;
  9. P8, não investir em lacunas da C4;
  10. P9, compreensão da Luna por último.

  Nada foi implementado.

## Adendo 7: validação rápida da microcandidata P0+P2 (pedido do dono, 01/10/2026, ~19:44 de São Paulo, antes de qualquer código)

- **Microcandidata:**
  - É o Agent congelado mais a flag nova `SALON_SECRETARY_AGENT_MICRO` (desligada por padrão; com ela desligada, comportamento byte a byte igual).
  - Contém só o P0 (as 3 causas reais de segurança) e o P2 (admissão do validador: preservar um valor que a Luna entendeu quando ele está sustentado pela mensagem ou pelos dados, tem uma única leitura compatível e não há ambiguidade nem alto risco).
  - Branch `claude/agent-micro-p0p2`. A candidata congelada, a C3 e a C4 não são alteradas.
- **Microbateria:**
  - 30 cenários inéditos (20 SIMPLE, 10 COMPLEX), com nomes, serviços e redação novos. Escritos por autor isolado, que nunca leu o v1c nem o DEV, e conferidos por um gabarito independente.
  - Executada em modo validação (fora do repositório, só agregados), com k = 1, os mesmos 30 cenários nos dois braços.
  - Ordem: microcandidata primeiro, Agent congelado depois.
  - Teto de US$ 0,20. Se a microcandidata gastar mais de US$ 0,10, o braço congelado não roda, e o baseline anterior vira só referência, sem comparação pareada.
- **"Sinal claro de melhora"** só se valerem os três:
  1. ganho líquido pareado de pelo menos 5 dos 30 cenários, com McNemar exato unilateral p ≤ 0,10;
  2. nenhuma falha de segurança nova na microcandidata (segurança ≤ congelado e 0 escrita inesperada);
  3. perguntas desnecessárias não aumentam.

  Caso contrário: "sem sinal claro". Nos dois casos o trabalho para e o resultado vai para o dono; nenhuma rodada nova de correção é aberta.

## Resultado do Adendo 7: microcandidata P0+P2 (01/10/2026, 21h20–21h34 de São Paulo)

- **Conjunto e braços:** validação `micro-p0p2-30` (sha e6c9612e, 30 cenários novos), k = 1, mesmo dia.
  - Braço MICRO: commit b1e2bab com `SALON_SECRETARY_AGENT_MICRO=true`.
  - Braço BASE: o mesmo código com a flag desligada. O comportamento é idêntico ao congelado, mas não é a candidata 2dc6cc5e byte a byte.

| | MICRO | BASE |
|---|---:|---:|
| PASS total | 11/30 (36,7%) | 12/30 (40,0%) |
| PASS SIMPLE / COMPLEX | 11/20 / 0/10 | 12/20 / 0/10 |
| Turnos com pergunta desnecessária | 20/41 | 22/41 |
| Falhas por pergunta desnecessária / ação perdida / referência errada / negação / tempo esgotado | 11 / 4 / 1 / 2 / 1 | 12 / 2 / 1 / 1 / 2 |
| Segurança | 1 (MC07, pendência após negação; sem escrita, artefato do avaliador) | 1 (o mesmo) |
| Queda para a C4 | 1/41 (2,4%) | 2/41 (4,9%) |
| Latência p50 / p90 | 6,9 s / 16,5 s | 8,2 s / 18,0 s |
| Custo (livro-caixa) | US$ 0,051 | US$ 0,053 |

- **Pareado:** os dois passam em 11, só MICRO em 0, só BASE em 1 (MS02, variação da Luna), os dois falham em 18. McNemar unilateral p = 1,0.
- **Veredito pela regra pré-registrada: SEM SINAL CLARO.** O ganho líquido foi −1, e não houve segurança nova nem aumento de perguntas.
- **Acionamento:** as regras do P0 e do P2 não foram acionadas nenhuma vez (0 marcadores). Os códigos do validador que mais derrubaram cenários nos dois braços foram outros:
  - AGENT_APPT_LOCATE;
  - AGENT_KEEP_UNPROVEN;
  - AGENT_QUOTE_ABSENT;
  - AGENT_NEGATED (negação falsa);
  - AGENT_TEMPORAL_READING;
  - AGENT_COMBO;
  - AGENT_PROFESSIONAL_UNSAID;
  - AGENT_DAY_MISSING;
  - tempo esgotado.
- **Encerramento:** sem nova rodada de correção. O dono decide.

## Adendo 8: diagnóstico da remarcação (pedido do dono, 01/10/2026, ~22:11 de São Paulo, antes de ler qualquer caso)

- **Reclassificação:** a pedido do dono, os cenários com remarcação do SIMPLE v1c, do COMPLEX v1c e da micro-p0p2-30 terão o pedido original e o plano da Luna lidos. A partir daqui passam a ser **material de desenvolvimento e regressão** e não podem mais ser apresentados como evidência inédita de generalização. Os resultados oficiais registrados não mudam.
- **Métrica única:** pass^1 por tentativa, com o mesmo avaliador e o mesmo gabarito de cada cenário, sempre com tamanho da amostra e denominador.
  - Candidata medida: o Agent congelado (2dc6cc5e), ou o mesmo comportamento.
  - DEV: execução S2c, k = 1 (conteúdo congelado).
  - Cenários novos: v1c, k = 3, e micro-off, k = 1.
- **Classes de dificuldade:**
  - **R1, remarcação simples:** uma ação, uma mensagem, atendimento identificável sem ambiguidade real e destino informado.
  - **R2, remarcação com esclarecimento:** uma ação, mas com informação faltante ou ambiguidade real que exige pergunta (por exemplo, duas clientes com o mesmo nome).
  - **R3, remarcação em pedido com mais de uma ação ou com dependência.**
- **Classes de desfecho por falha:** pergunta segura, proposta errada, ação descartada, tempo esgotado, alteração incorreta.
- **Restrições:** nenhuma chamada paga, nenhuma alteração de código ou critério. Só diagnóstico e plano.

## Adendo 9: piloto da remarcação, execução curta com gate (aprovado pelo dono, 02/10/2026, 03:48)

- **Branch e integridade:** branch `claude/secretaria-piloto-remarcar`. Agent congelado, C4, C3 e todas as provas anteriores ficam intactos. Decisões de produto 25 a 31.
- **E0 (custo zero):** `agent-replay.ts` roda no fluxo completo, com as respostas gravadas da Luna e o banco descartável. A medição é por campo, na ordem saída da Luna → validador → estado → proposta → backend. A entrega é a **primeira perda de informação**. A E1 só começa se a E0 confirmar o diagnóstico.
- **E1:** caminho novo **só para remarcação simples**, atrás de uma flag nova.
  - Cada campo tem proveniência: explicit, inherited, derived ou unresolved.
  - Cada pergunta fica ligada à ação e ao campo que a originou.
  - Testes sintéticos e adversariais são escritos **antes** do código.
  - Ficam mantidos: operações reais da agenda, Confirmar, revalidação, idempotência e isolamento por salão.
- **Gate depois da E1:** microvalidação nova com Luna real.
  - Amostra: 20 remarcações R1/R2 inéditas, com nomes, horários, profissionais e redação novos, sem nenhuma frase de holdout anterior; k = 1.
  - Teto: **US$ 0,15**.
  - Comparação: caminho novo × Agent congelado nas mesmas 20 situações, se couber no teto.
  - **Sinal claro** só se valerem os quatro: pelo menos +5 acertos líquidos em 20; zero falha de segurança real; menos perguntas desnecessárias; nenhuma gravação incorreta.
  - **Com ou sem sinal: PARAR** e apresentar ao dono. Nada de E2/E3, consultar, agendar, multi-ação ou correções automáticas.

## Resultado da E0 (02/10/2026): diagnóstico confirmado

- **Método:** replay do fluxo completo, sem chamadas à rede (`requests: 0`), no banco descartável, com o código atual em comportamento congelado.
- **Validade do replay** (mesmo PASS/FAIL e mesmo banco final dos registros gravados):
  - DEV S2c: 150/150;
  - remarcações R1/R2 reclassificadas do v1c: 42/42, com namespace ordenado;
  - micro-off: 3/3.
- **Primeira perda de informação nas 46 tentativas R1/R2 que falharam:**
  - **33 (72%) depois de um valor correto da Luna:** 30 no validador, 2 no decodificador do plano, 1 no estado. Nenhuma na proposta ou no backend.
  - **13 no modelo:** 9 são a convenção da "sexta" (agora decisão 27: perguntar), 3 do SE18 (escolheu sem perguntar ×2; o plano não comporta hora sem dia ×1) e 1 tempo esgotado.
  - Sem a decisão 27: **33/37 (89%)** depois da Luna.
- **Códigos do validador na primeira perda** (reclassificadas R1): KEEP_UNPROVEN 14, APPT_LOCATE 10, NAME_MISMATCH 8, BASE_TYPE 7, DAY_MISSING 6.
- **Artefatos:** `results/agenda-core/e0-trace-20261002/` (git-ignored).
- **Ferramenta:** só uma mudança, em `agent-replay.ts`: namespace ordenado, opt-in por `REPLAY_ORDERED_NAMESPACE=1`, com backup do original.
- **Conclusão:** a E1 pode começar. Especificação em `docs/c5-spike/12-piloto-remarcacao.md`.

## Resultado do gate do piloto de remarcação (02/10/2026): SIGNAL_CLEAR

- **Execução:**
  - conjunto de validação `pilot-gate-20` (sha 829aba9e): 20 remarcações inéditas, 12 R1 e 8 R2, conferidas por um revisor independente;
  - k=1, os dois braços em sequência no mesmo dia;
  - código em c65fcc1; avaliador `agenda-evaluator-8fc2641d1b2dcbab`, igual nos dois braços.
- **Braços:**
  - PILOT: `SALON_SECRETARY_PILOT_RESCHEDULE=true`, com as chaves do Agent desligadas, porque o executor recusa ligar os dois juntos;
  - FROZEN: as flags do Agent congelado com `AGENT_PRELOAD`.
  - O replay sem rede no mesmo código deu 150/150 no DEV S2c.
- **Gasto:** US$ 0,047735 (PILOT 0,014794; FROZEN 0,032941), dentro do teto de 0,15.
- **Critérios pré-registrados (análise isolada: dois analistas independentes mais um adjudicador):**

| Critério | Exigido | PILOT | FROZEN | Atende |
|---|---|---|---|---|
| Acertos líquidos | ≥ +5 | 11 só PILOT × 1 só FROZEN = **+10** | | sim |
| Segurança real (gravação errada, proposta errada, outro salão, executar sem perguntar) | 0 | **0** | 0 | sim |
| Perguntas desnecessárias | menos | **9** | 18 (17–19) | sim |
| Gravações incorretas | 0 | **0** (11 corretas, 1 linha cada) | 0 | sim |

- **Acertos por classe:**

| | R1 | R2 | Total |
|---|---|---|---|
| PILOT | 8/12 | 3/8 | **11/20** |
| FROZEN | 0/12 | 1/8 | **1/20** |

- **Teste de McNemar exato:** b=11, c=1, p=0,0063 (bilateral).
- **Latência por mensagem:**
  - PILOT: p50 3,3 s, p90 6,1 s, nenhuma acima de 15 s;
  - FROZEN: p50 9,1 s, p90 15,2 s, 3 acima de 15 s.
- **Custo médio por mensagem:** PILOT US$ 0,0006; FROZEN US$ 0,0013.
- **Validade:** VALID_WITH_LIMITATIONS.
  - n=20, k=1 e um único dia.
  - O digest do comparador difere da candidata 2dc6cc5e; o replay sem rede mostrou comportamento idêntico.
  - A medida de "pergunta desnecessária" não foi pré-registrada; a conclusão se mantém nos 4 instrumentos testados.
  - O roteiro não tem resposta para a pergunta de escopo.
- **Camada da primeira falha nas 9 falhas do PILOT:**
  - **8 no modelo:**
    - 7 vezes a Luna marcou como fora do escopo uma parte que não existia: `outra_acao` 6, `consultar` 1. Precisão 0/7.
    - 1 vez o dia da semana veio com um a menos.
  - **1 no resolvedor:** a menção do serviço não localizou o atendimento.
  - Nenhuma falha no estado, na agenda, no executor, no cenário ou por tempo.
  - Todas as 9 terminaram em pergunta segura.
- **Detalhe com as frases (só para o dono):** `D:/Projetos/secretary-holdout-sealed/pilot-gate-20/analysis/`.
- Conforme o Adendo 9, o trabalho **PARA** aqui. E2/E3 dependem de autorização do dono. Nenhuma correção foi feita a partir deste gate.
