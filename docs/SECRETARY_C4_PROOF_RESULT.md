# Secretária de Agenda — resultado da prova da Candidata 4 e retomada

Data: 30/09/2026, madrugada, horário de São Paulo.

- Worktree: `D:\Projetos\barber-saas\.claude\worktrees\secretary-mobile-investigation-8658bb`.
- Branch: `claude/secretary-mobile-investigation-8658bb`.
- PR em rascunho: [#132](https://github.com/alisonbielwhats1-beep/barber-saas/pull/132). Não mergear.
- Candidata congelada: `35bbe35f00a4d525`, com conteúdo idêntico ao de `3bba4e1f83c88b61`.
- Flags: `.demo/agenda-core/candidate-flags-c4.sh`.
- Critérios pré-registrados e histórico completo: `docs/SECRETARY_HOLDOUT_PROTOCOL.md`, a partir da seção "Holdout do dono (v2)".

## 1. Resultados medidos

Os números abaixo são os medidos e não foram alterados. Todas as provas usaram a Luna real (`gpt-6-luna`), um executor de cada vez.

| Conjunto | Tipo | Resultado | Segurança | Critério |
|---|---|---|---|---|
| Golden 30, k=5 | regressão | **150/150** (pass^5 = 100%); 0 perguntas desnecessárias | 0 | atingido |
| Holdout do dono v2 (60 frases do dono), k=3 | **prova principal** | **pass^1 54,4%**, pass^3 50,0% | 12 tentativas em 5 cenários | **não atingido** (exigia ≥ 80% e 0) |
| V4 mantido (52 estruturas novas), k=3 | extra | pass^1 19,9%, pass^3 13,5% | 14, das quais 3 anotadas como escrita confirmada em passo anterior | só reportado |
| DEV final (C4 + regras do dono / V/N), k=2 | desenvolvimento | 97,9% / 96,1% | 0 / 1 (V30, corrigido antes do freeze) | — |

### Holdout do dono v2 por nível

| Nível | Acerto |
|---|---|
| Simples e diretas | **84%** |
| Referências naturais | **80%** |
| Duas ou três ações | 30% |
| Correções | 57% |
| Multi-ação pesada | 10% |
| Naturais e bagunçadas | 47% |

Classes das 180 tentativas: PASS 98, esclarecimento 46, funcional 24 e segurança 12. Por cenário: 30 sempre passam, 5 são instáveis e 25 sempre falham.

Gasto real do programa ao fim da prova: US$ 6,25, de um teto de US$ 15.

## 2. Causa raiz das 30 frases do dono que falharam

Três analistas leram as transcrições. As alegações de "oráculo ou harness" (OV28, OV33, OV40) **não passaram pela verificação adversarial**, porque o limite semanal dos agentes foi atingido (volta em 03/10, 15h).

| Causa | Cenários |
|---|---|
| Capacidade ausente na C4 (11) | OV18, OV24, OV29, OV31, OV34, OV45, OV50, OV52, OV53, OV54, OV60 |
| Bug de backend (10) | OV09, OV30, OV36, OV39, OV40, OV43, OV47, OV48, OV49, OV56 |
| Leitura errada da Luna (4) | OV03, OV14, OV51, OV55 |
| Mista (3) | OV35, OV46, OV58 |
| Harness / pergunta necessária, não verificado (2) | OV28, OV33 |

**Escritas erradas reais (bloqueiam o piloto):**
- **OV09 e OV43:** "adiciona barba" num atendimento de Corte, em salão com o combo "Corte e barba", gravou **"Corte + Corte e barba"**, com 90 min e preço errado. O combo foi somado ao próprio componente.
- **OV45:** "fecha a agenda do rodrigo amanhã depois das 5, **menos** o horário da camila" bloqueou o intervalo inteiro, por cima da cliente.
- **OV60:** "fecha meu horário amanhã depois das quatro, mas se tiver cliente **não mexe**, só bloqueia o vazio" bloqueou a partir das 16h, por cima do atendimento.
- **OV40 k2:** classificado como artefato, sem verificação.

Em todos esses casos, a proposta mostrava o erro antes do Confirmar.

**Capacidades ausentes que mais apareceram:**
- bloqueio com exceção ou "só o vazio";
- encadeamento ("uma depois da outra", "logo depois");
- âncoras na agenda ("depois do último cliente dela", "o primeiro da julia");
- escolha delegada ("com quem tiver", "com quem puder");
- limites em consultas ("quem está marcado depois das 3");
- condicionais ("se não couber, procura outro");
- troca de profissional sem dizer qual.

**Bugs de backend que mais apareceram:**
- autorreferência ("mesmo horário") que invade a oração vizinha;
- "não pera" e "na verdade" em correções;
- números que não são tempo ("os dois", "as duas") lidos como horário;
- referências com "depois desse atendimento";
- regra 9 (combos) nas adições.

## 3. Veredito

- **Pronto:**
  - pedidos simples e com referências, em torno de 80–84% com as frases reais do dono;
  - a regressão Golden (100%);
  - as regras de segurança básicas: confirmação, nada gravado sem proposta.
- **Ainda falha:**
  - multi-ação com duas ou mais ações (10–30%), correções (57%) e frases bagunçadas (47%);
  - estruturas inéditas (V4, 20%).
- **Piloto:**
  - Pelo critério pré-registrado, a Agenda **não está pronta** para piloto em salão real.
  - Na **conta demo** (dados fictícios), um piloto **supervisionado** faz sentido depois de corrigir as 4 escritas erradas reais. O uso deve ser orientado a pedidos de uma ação por vez.
- **Bloqueadores de produção:**
  - as 4 escritas erradas;
  - cota por salão;
  - migrations 026/027 com preflight e backup;
  - `maxDuration`;
  - allowlist do piloto;
  - multi-ação confiável.

## 4. Próximos passos mínimos (Candidata 5)

1. **Correções de segurança primeiro:**
   - guarda de combo, para nunca somar um combo ao próprio componente e aplicar a regra 9 nas adições;
   - guarda de bloqueio, para nunca propor bloqueio por cima de atendimento sem pedido explícito, perguntando ou dividindo o intervalo;
   - verificar o OV40.
2. **Bugs de backend** da seção 2: autorreferência, "não pera", números que não são tempo e referências com "depois desse".
3. **Capacidades por frequência:**
   - bloqueio com exceção ou "só o vazio";
   - "uma depois da outra";
   - "com quem tiver";
   - âncoras na agenda;
   - limites em consultas.
4. **Estratégia:**
   - Sem fine-tuning (decisão do dono; o `gpt-6-luna` não aceita).
   - Regras estruturais no backend e few-shot para as construções novas.
   - O holdout do dono v2 **já foi usado** (1 olhar) e agora pode virar material DEV/regressão. A próxima prova precisa de **frases novas do dono**.
5. **Piloto supervisionado na conta demo** depois do item 1, seguindo `docs/SECRETARY_RELEASE_CHECKLIST.md`, seção 8.

## 5. Como retomar numa conversa nova

- Leia este arquivo, `docs/SECRETARY_HOLDOUT_PROTOCOL.md` (final), `docs/DECISOES_PRODUTO.md` (última seção) e `.demo/agenda-core/AGENT_RULES.md`.
- **Artefatos da análise, fora do repo:**
  - execução selada do dono: `D:/Projetos/secretary-holdout-sealed/derived/runs/sealed-owner-v2-5f861bde-2026-09-30T06-15-44-342Z`;
  - execução do V4: `D:/Projetos/secretary-validation/runs/sealed-multi-salon-v4-a57ac948-2026-09-30T07-02-19-861Z`;
  - Golden: `packages/salon-secretary/evaluation/results/free-use/golden-20260930-c4-proof`.
- **Classificação de causa raiz por cenário:** journal do workflow `owner-v2-proof-failure-analysis`, também resumida na seção 2.
- **Ferramentas:**
  - `node .demo/agenda-core/final-analysis.cjs <run-dir>` (classes);
  - `node packages/salon-secretary/evaluation/program-spend-report.cjs` (gasto);
  - `node scripts/secretary-proof-diversity.cjs` (diversidade).
- **Nunca** rode dois executores ao mesmo tempo. Confira a hora de São Paulo com `node` (Intl).
- Nada de Production sem autorização explícita a cada passo.

## 6. Plano aprovado para a Candidata 5 (30/09/2026)

A arquitetura segue o princípio "a IA entende, o backend confere". O modelo continua sendo o `gpt-6-luna`, sem fine-tuning.

1. **Segurança primeiro:**
   - guarda de combo, para nunca somar um combo ao próprio componente (regra 9 nas adições);
   - guarda de bloqueio, para nunca bloquear por cima de atendimento sem pedido explícito (pergunta ou divide o intervalo);
   - verificar o OV40;
   - **conferente**: uma chamada curta da Luna compara o pedido do dono com a proposta antes de mostrá-la. Se houver divergência, pergunta ou recusa.
2. **Spike de arquitetura, medido antes de adotar:**
   - ferramentas locais só de leitura para a Luna (agenda do dia, disponibilidade, catálogo e combos, jornada do profissional, intervalos livres), com no máximo 2 a 3 consultas por mensagem;
   - saída **resolvida**: entidades escolhidas entre os candidatos reais e data e hora absolutas;
   - o backend valida os dados, as regras e a confirmação, com uma checagem leve de evidência literal no lugar da reinterpretação do português.
   - **Comparação C4 × spike:** holdout do dono v2 (agora material DEV) e V4. Só adotar se melhorar sem regressão de segurança.
   - Ligar o cache de prompt para compensar custo e latência. A meta é chegar a no máximo 3 chamadas por mensagem.
3. **Capacidades mais frequentes com as ferramentas:** bloqueio com exceção ou "só o vazio", "uma depois da outra", "com quem tiver", âncoras na agenda e limites em consultas.
4. **Multi-segmento, guiado pelos dados do salão e nunca por regras de segmento no código:**
   - apelidos de serviço por salão;
   - combos;
   - pausa e finalização;
   - recursos (sala, maca);
   - serviços simultâneos;
   - intervalo de limpeza.
   - Validação com baterias por segmento (barbearia, salão, esmalteria, spa/massagem, estética) e contas demo por segmento.
5. **Prova nova com frases novas do dono**, depois piloto supervisionado na conta demo `everflair-apresentacao`.

As etapas 2 a 4 precisam de workflows com muitos agentes, que ficam disponíveis de novo depois de 03/10, 15h.

## 7. Plano da Candidata 5 revisado com referências (30/09/2026, aprovado pelo dono)

O objetivo e as regras da seção 6 continuam. Muda como cada etapa é feita e a ordem. Referências: guias da OpenAI (GPT-5.6 de 13/07/2026, GPT-6 de 05/09/2026, function calling, prompt caching, evaluation best practices, agent evals) e da Anthropic (context engineering, writing tools, Demystifying evals, eval e hillclimbing de 28/09/2026), τ-bench, PolicyGuide (ago/2026) e o estudo de falso sucesso (jun/2026).

**Decisões do dono (30/09):**
- bloqueio com atendimento dentro do intervalo: a Secretária sempre pergunta, com um cartão de opções reais;
- conferente com erro ou timeout: a proposta aparece como hoje (o Confirmar continua obrigatório) e o erro vai para a telemetria;
- metas por nível aprovadas (abaixo).

**Etapas, na ordem:**
1. **Segurança (até 03/10, trabalho direto):**
   - travas no código primeiro: guarda de combo (o combo substitui o componente que o atendimento já tem; combo e componente juntos nunca), guarda de bloqueio (cartão: só o horário livre ou o período todo mantendo os agendamentos) e invariantes do plano;
   - OV40: verificado, sem escrita; a resposta "no mesmo horário" vai para os bugs de backend;
   - conferente da Luna: só barra, só com citação literal do pedido, medido offline (acerto e alarme falso nas transcrições rotuladas da prova) antes de ser ligado.
2. **Auditoria sem custo:** cache de prompt (14,2% na prova; a parte fixa vem primeiro), dieta do prompt (menos regras, nenhuma contradição, os "nunca" viram trava no backend) e banco de exemplos canônicos por estrutura.
3. **A/B pago:** few-shot sem exemplos × selecionados × canônicos fixos; esforço de raciocínio baixo × médio. Empate fica com a opção mais simples (R8).
4. **Spike de ferramentas só de leitura** (seção 6, item 2), com `strict` e `enum`, menos de 20 ferramentas, nomes no lugar de IDs e filtragem no código.
5. **Capacidades pelas ferramentas** e validação do plano inteiro (liberado e reocupado, sequências, contradições); o que está claro fica pronto e só a parte ambígua é perguntada.
6. **Multi-segmento** pelos dados do salão (seção 6, item 4).
7. **Prova com frases novas do dono** e piloto supervisionado na conta demo.

**Método:** uma mudança por rodada, pela causa raiz; DEV dividido 70/30 por estrutura (melhora só nos 70% = decoreba, a mudança é desfeita); avaliação da conversa inteira (ferramenta, argumentos, estado final); amostra conferida pelo dono para calibrar os avaliadores.

**Metas por nível (pré-registradas para a prova da C5):** simples ≥ 90%; referências ≥ 85%; duas ou três ações ≥ 65%; correções ≥ 70%; multi-ação pesada ≥ 40%, com o restante terminando em pergunta segura; **0 escrita errada** em qualquer nível.

**Custo estimado:** cerca de US$ 5 a 6 dos US$ 8,75 restantes; cada rodada paga é reportada.
