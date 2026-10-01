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
