# Secretária confiável: arquitetura e próximos passos

27/09/2026. Relatório pedido pelo responsável depois do teste manual da Agenda.
Base: a arquitetura atual do repositório, as falhas medidas nesta etapa (Golden,
bateria prática, A/B com a Luna real, teste manual) e uma pesquisa em fontes
primárias sobre sistemas reais que usam LLM para interpretar pedidos e um backend
determinístico para executar. As fontes estão no fim.

## 1. Resumo

A Secretária já segue o desenho dos sistemas maduros do mercado (Rasa CALM,
Amazon Lex e Bedrock, Microsoft Copilot Studio, Salesforce Agentforce). A Luna só
interpreta, numa única chamada com JSON Schema estrito. O backend resolve, pede
confirmação e executa. Por isso não houve nenhuma escrita insegura nos 40 cenários
práticos nem na Golden 30/30.

O que falta para ser "totalmente confiável" não é segurança. É **consistência e
atrito**, que vêm de três causas:

1. **Dois intérpretes de português.** O backend ainda relê a frase com regex (datas,
   negação, verbos da Comunicação). Quando ele e a Luna discordam, aparecem pergunta
   desnecessária, laço ou turno perdido (casos #9, #14, GF24, C08, C10).
2. **Medição de passe único.** 30/30 e 39/40 foram medidos uma vez, nos mesmos casos
   que motivaram as correções. No A/B com a Luna real, alguns casos acertaram só 4
   ou 6 de 8 vezes.
3. **Conversa na memória de um processo.** Um deploy ou uma segunda instância na
   Vercel perde o plano em andamento.

A direção é a que você descreveu: **a Luna entrega a intenção cada vez mais
estruturada e o backend calcula e decide tudo o que é fato**, com um único
intérprete de linguagem e medição repetida.

## 2. O que os sistemas reais fazem

| Sistema | Padrão | O que aproveitamos |
|---|---|---|
| Rasa CALM (e o artigo de Bocklisch et al.) | A LLM só emite comandos de um vocabulário fechado (iniciar fluxo, preencher campo, corrigir, esclarecer, cancelar). Um gerenciador determinístico executa os fluxos. Correção, cancelamento, ambiguidade e erro têm fluxos próprios. | Nosso envelope (NEW/ADD/PATCH/…) é esse padrão. Faltam comandos explícitos para descartar, escolher opção e corrigir, e validação campo a campo que pergunta de novo só o campo inválido. |
| Amazon Lex / Bedrock Agents | NLU assistido por LLM, com os campos validados por código ("code hooks") e confirmação. O agente devolve o controle à aplicação antes de agir ("Return of Control"). | Igual à nossa confirmação autenticada. Reforça: o modelo nunca executa. |
| Google Dialogflow CX | Agente híbrido: partes generativas para conversa e fluxos determinísticos para transações. Campo inválido gera nova pergunta, não perda do turno. | Aceitação parcial: um campo errado invalida o campo, não a mensagem inteira (GF24 perdia o turno). |
| Salesforce Agentforce (Agent Graph / Agent Script) | "Determinismo guiado": o estado da conversa é um grafo persistido no servidor, e o modelo raciocina dentro dele. | Persistir o estado da conversa e as referências entre ações ("no mesmo dia"). |
| Sierra (τ-bench, simulações, governança de release) | Mede confiabilidade como **pass^k**: o mesmo caso rodado k vezes, avaliando o estado final do banco. Simulador de usuários e gates de release. | Nossa maior lacuna de medição. No τ-bench, um modelo com ~61% em pass^1 caiu para menos de 25% em pass^8. |
| Shopify Sidekick, Intercom Fin, Decagon, DoorDash, Klarna | Poucas ferramentas bem descritas, procedimentos explícitos, avaliação contínua com casos reais, juiz de LLM calibrado com rótulos humanos. A Klarna mostrou que medir volume engana; o que importa é resolução correta. | Holdout escrito por você, telemetria de desfecho por turno, juiz só para qualidade subjetiva. |
| OpenAI / Anthropic (guias de agentes e de ferramentas) | Schemas estritos, enums, poucas ferramentas, "não pedir ao modelo o que o sistema já sabe", tornar o erro impossível de escrever. | Opções por identificador, datas como componentes, schema que muda conforme o estado. |

## 3. Princípios

1. **A Luna entende; o backend decide e executa.** A saída da Luna é um comando
   tipado. Identidade, datas absolutas, disponibilidade, permissão e escrita ficam
   sempre com o código.
2. **Um só intérprete de português.** O backend confere a origem ("o trecho citado
   existe na mensagem e é desta ação?"), mas não reinterpreta o sentido.
3. **Tornar o erro impossível de escrever**, em vez de detectá-lo depois: enums,
   identificadores de opção, datas em componentes, schema estreitado pelo estado.
4. **Não pedir ao modelo o que o sistema já sabe:** fuso, salão, IDs, plano e
   proposta pendente vêm do servidor.
5. **"Não sei" é resposta válida,** mas toda pergunta tem limite de repetição e uma
   saída determinística (por exemplo, abrir o formulário já preenchido).
6. **Nenhuma escrita sem proposta confirmada,** gerada pelo código e amarrada por
   fingerprint. O modelo nunca confirma.
7. **Falha local, efeito local.** Um campo inválido invalida o campo; o erro de uma
   ação não contamina as outras.
8. **Confiabilidade é consistência medida no resultado:** pass^k sobre o estado final
   do banco, em casos que não foram usados para ajustar o sistema.
9. **O estado da conversa fica no servidor,** persistido e reenviado à Luna como
   resumo estruturado.
10. **Mudança de contrato só entra com flag, modo sombra e gate de regressão,** e tudo
    o que chega ao modelo (prompt, schema, modelo) tem versão.

## 4. Recomendações, em ordem

Impacto: alto/médio/baixo. Esforço: P (dias), M (1–2 semanas), G (várias semanas).

### Fase 1: medir de verdade (1–2 semanas, sem mudar comportamento)

| # | Recomendação | Problema que resolve | Impacto | Esforço |
|---|---|---|---|---|
| 1 | **pass^k com checagem do estado final do banco** no runner da Golden e na bateria prática (k=5 na rotina, k=8 antes de liberar) | Passe único esconde 25–50% de variação (GF13 6/8, GF24 4/8) | alto | P |
| 2 | **Holdout novo escrito por você**, com as frases do dia a dia, selado e usado só para liberar versão; todo caso que motivar correção vira regressão e é reposto | Risco de ajustar o sistema aos próprios testes | alto | M |
| 3 | **Telemetria de desfecho por turno** (proposta pronta, pergunta, laço, turno perdido, divergência Luna×backend, reparo), sem gravar texto de clientes | Hoje não dá para medir as falhas reais de uso | alto | M |

### Fase 2: tirar o atrito barato (2–4 semanas)

| # | Recomendação | Problema que resolve | Impacto | Esforço |
|---|---|---|---|---|
| 4 | **Comunicação respeita a decisão da Luna** (texto exato ou sugerido, sem lista de verbos) e gera o rascunho sugerido para você revisar | C08: "pode sugerir um texto educado" em laço | alto | P |
| 5 | **Modo DESCARTAR** no contrato e botão "descartar esta ação" | C10: "Não, deixa" responde certo, mas o plano continua confirmável | alto | P |
| 6 | **Escolha de opção por identificador** (opção 1, 2, 3…) em vez de repetir data/hora | GF13: a Luna copiava a data da opção e gerava pergunta desnecessária | alto | M |
| 7 | **Aceitação parcial do envelope + um reparo guiado pelo erro** | GF24 e outros: um campo errado derrubava o turno inteiro | alto | M |
| 8 | **Limite de perguntas repetidas** com opções clicáveis e, na 3ª vez, "abrir no formulário da agenda" já preenchido | Laços (C08, holdout V2) | alto | M |
| 9 | **Confirmar o que está pronto:** grupos de confirmação por ações independentes; pares atômicos (cancelar→colocar no lugar) continuam juntos | C06 e o seu teste: uma ação pronta presa por outra pendente | alto | M |
| 10 | **Camada única de apresentação**: datas humanas ("ter, 29/09 às 10h") e separação entre o texto da tela e o dado enviado à Luna | Datas técnicas na tela; rótulos de tela influenciando a Luna | médio | M |
| 11 | **Linha do tempo por turno no chat**: cada turno com sua mensagem, resposta e cartões; turnos antigos só leitura | "Caixa em cima do meu comando" | médio | M |

### Fase 3: contrato estruturado (4–8 semanas, atrás de flag)

| # | Recomendação | Problema que resolve | Impacto | Esforço |
|---|---|---|---|---|
| 12 | **Datas como componentes** (data escrita, dia da semana, semana que vem, amanhã, hora, período), cada um com seu trecho de prova; o backend calcula a data; a gramática regex vai para modo sombra | Dois intérpretes de data (#9, #14, GF24, "semana que vem") | alto | G |
| 13 | **Polaridade e valores excluídos** no contrato ("passa para 11h, não 10h" → 10h excluído) em vez de negação por regex | #1, V216/V217, C07 | alto | M |
| 14 | **Referências entre ações** ("no mesmo dia", "com ela", "no mesmo horário") como ligação explícita no plano | C06 e C02 (perguntas extras) | alto | M |
| 15 | **Instruções no ponto certo e schema por estado** (regras dentro do campo que governam; só o que o estado permite) + checagem automática de instruções contraditórias | Prompt de ~6 mil tokens com regras globais | médio | M |
| 16 | **Busca de nomes com pontuação** (unaccent + pg_trgm, top-5, regras "achou/ambíguo/não achou") | Hoje resolve acento, mas não erro de digitação (Tatiane/Tatiana) nem ordena por confiança; exige migration com preflight | médio | M |

### Fase 4: pronta para produção (em paralelo ao fim da Fase 2)

| # | Recomendação | Problema que resolve | Impacto | Esforço |
|---|---|---|---|---|
| 17 | **Estado da conversa persistido no Postgres** (com RLS, concorrência otimista e log de eventos) | Deploy ou outra instância apaga o plano | alto | G |
| 18 | **Orquestrador com resultados tipados** (sem exceções de controle; um só dono dos dados) e divisão do `salon-secretary.ts` (1.119 linhas) | Complexidade e três fontes de verdade | médio | G |
| 19 | **Governança de release:** versão = hash de prompt/schema/modelo, gate no CI, canário por salão, código de avaliação fora do runtime | Não há versão única para comparar e reverter | médio | M |
| 20 | **Simulador de clientes em português** conversando com a Secretária no banco descartável, avaliado pelo estado final | Cobertura cresce devagar | médio | M |
| 21 | **Juiz de LLM só para qualidade subjetiva** (pergunta desnecessária, tom), calibrado com ~100 rótulos seus | Revisão semântica manual não escala | baixo | M |
| 22 | **Segunda interpretação só em escritas**, e só se os dados mostrarem necessidade | Instabilidade residual em campos críticos | baixo | M |

## 5. O que não fazer

- Não pedir à Luna datas absolutas já calculadas nem IDs de banco (o #9 inventou
  2025-04-11 a partir de "Amanhã.").
- Não criar novas regex, listas de verbos ou regras por palavra para "corrigir" a
  Luna; cada uma vira um mini-intérprete sem sinônimos. A correção entra no contrato.
- Não arrancar a gramática regex de uma vez: ela sai por modo sombra, com dados (a
  tentativa anterior quebrou 80 testes).
- Não declarar confiabilidade com passe único nos mesmos casos que motivaram as
  correções.
- Não afrouxar a confirmação explícita nem aceitar "sim" em texto livre como
  confirmação. O modelo nunca confirma nem executa.
- Não trocar o intérprete de chamada única por um agente que chama ferramentas de
  escrita livremente, nem dividir em vários agentes antes de esgotar o agente único.
- Não publicar ferramentas demais para a Luna (acima de ~20 a escolha piora).
- Não escolher cliente automaticamente por semelhança quando houver candidatos
  próximos.
- Não resolver instabilidade só com temperatura 0 ou mais tentativas.
- Não medir sucesso por volume ou satisfação média; medir resolução correta e
  retrabalho.
- Não gravar texto de clientes na telemetria.
- Não rodar migrations contra Supabase ou Production sem preflight e confirmação.

## 6. Métricas para acompanhar

- **pass^k** por caso e agregado (meta inicial: pass^8 ≥ 90% no núcleo da Agenda).
- **Escritas erradas executadas:** meta 0.
- **Correção logo após confirmar** (remarcou ou cancelou o que acabou de confirmar):
  sinal indireto de escrita errada no uso real.
- **Turnos perdidos** por 100 turnos (meta: resposta vazia = 0).
- **Divergência Luna × backend** por 100 turnos (deve cair a cada fase).
- **Perguntas desnecessárias e laços** (mesma pergunta 2+ vezes), com a taxa de
  saída para o formulário. Laço = a mesma pergunta mostrada de novo num turno em que
  nenhuma ação do plano mudou (telemetria: `repeated_question_count > 0`); num plano
  com várias ações, responder uma delas não conta as perguntas ainda abertas das
  outras como laço.
- **Turnos até a proposta ficar pronta** (mediana e p90), por tipo de pedido.
- **Resolução de nomes:** achou / ambíguo / não achou, e quantas vezes a escolha não
  foi o primeiro candidato.
- **Sessões perdidas** (meta 0 depois da persistência).
- **Custo e latência** por versão (hoje: ~US$ 0,0005 por mensagem; 3,9 s em média;
  6 s no p90).

## 7. Relação com a correção em andamento

A correção desta etapa já cobre parte da Fase 2, de forma compatível com a
arquitetura:

- nomes sem acento e sem diferença de maiúsculas (clientes, profissionais e
  serviços), sem migration; a versão com pontuação é a recomendação 16;
- datas humanas em todos os textos da Agenda (parte da recomendação 10);
- chat em ordem cronológica, com pedidos anteriores recolhidos, sem texto repetido e
  com rolagem automática (parte da recomendação 11);
- no pedido com várias ações, os cartões dizem o que está pronto e o botão diz o que
  falta. Confirmar só a parte pronta é a recomendação 9.

## 8. Próximo passo sugerido

Começar pela Fase 1: sem mudar o comportamento, ela mostra com números onde a
Secretária falha de verdade. Com isso, as Fases 2 e 3 podem ser priorizadas por
dado, e não por impressão. O único pedido para você é escrever o holdout: umas
30–50 conversas com as suas palavras do dia a dia, que ninguém usará para ajustar o
sistema.

## Fontes

Coletadas em 27/09/2026, priorizando documentação oficial, blogs de engenharia e
artigos.

- Rasa CALM — [LLM Command Generators](https://rasa.com/docs/reference/config/components/llm-command-generators/), [conceito](https://rasa.com/docs/learn/concepts/calm/), [Dialogue Understanding](https://rasa.com/docs/learn/concepts/dialogue-understanding/), [Conversation Patterns](https://rasa.com/docs/reference/primitives/patterns/), [Flow Steps](https://rasa.com/docs/reference/primitives/flow-steps/), [Process Calling](https://rasa.com/blog/process-calling-agentic-tools-need-state)
- Bocklisch et al., [Task-Oriented Dialogue with In-Context Learning](https://arxiv.org/abs/2402.12234)
- Google Dialogflow CX — [generativo vs determinístico](https://docs.cloud.google.com/dialogflow/cx/docs/generative-deterministic), [parâmetros](https://docs.cloud.google.com/dialogflow/cx/docs/concept/parameter)
- Microsoft Copilot Studio — [orquestração generativa](https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/generative-orchestration), [entradas de tópicos e ferramentas](https://learn.microsoft.com/en-us/microsoft-copilot-studio/advanced-additional-settings-topic-action-inputs)
- Salesforce — [Agent Graph](https://engineering.salesforce.com/agentforces-agent-graph-toward-guided-determinism-with-hybrid-reasoning/), [Agent Script](https://architect.salesforce.com/docs/architect/fundamentals/guide/hybrid-reasoning-agentforce-builder-agent-script)
- Amazon — [Lex V2 Assisted NLU](https://docs.aws.amazon.com/lexv2/latest/dg/assisted-nlu.html), [Bedrock Return of Control](https://docs.aws.amazon.com/bedrock/latest/userguide/agents-returncontrol.html), [Alexa Entity Resolution](https://developer.amazon.com/en-US/docs/alexa/custom-skills/entity-resolution.html)
- Sierra — [τ-bench](https://arxiv.org/abs/2406.12045), [τ²-bench](https://github.com/sierra-research/tau2-bench), [ADLC](https://sierra.ai/blog/agent-development-life-cycle), [Simulações](https://sierra.ai/blog/simulations-the-secret-behind-every-great-agent), [Governança de release](https://sierra.ai/blog/release-governance-guardrails-for-agents-at-scale)
- [Decagon AOPs](https://decagon.ai/blog/why-we-built-aop), [Intercom Fin Procedures](https://www.intercom.com/blog/procedures-simulations-updates/), [Shopify Sidekick](https://shopify.engineering/building-production-ready-agentic-systems), [DoorDash (InfoQ)](https://infoq.com/news/2026/03/doordash-llm-chatbot-simulator/), [Klarna (LangChain)](https://www.langchain.com/blog/customers-klarna), [Uber — identidade de agentes](https://www.uber.com/us/en/blog/solving-the-agent-identity-crisis/)
- OpenAI — [Guia prático de agentes](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Function calling](https://developers.openai.com/api/docs/guides/function-calling)
- Anthropic — [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents), [Writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents), [Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use), [Strict tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use), [Demystifying evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [Microsoft TypeChat](https://microsoft.github.io/TypeChat/docs/introduction/), [Instructor (re-ask)](https://python.useinstructor.com/concepts/reask_validation/), [DSPy Signatures](https://github.com/stanfordnlp/dspy/blob/main/docs/docs/learn/programming/signatures.md), [.txt — Say What You Mean](https://blog.dottxt.ai/say-what-you-mean.html)
- [Self-Consistency](https://arxiv.org/abs/2203.11171), [Laban et al. — LLMs Get Lost In Multi-Turn Conversation](https://arxiv.org/abs/2505.06120), [RAISED — Select, Don't Train](https://arxiv.org/html/2608.27470v1), [Hamel Husain — LLM-as-a-Judge](https://hamel.dev/blog/posts/llm-judge/)
- PostgreSQL — [pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html), [unaccent](https://www.postgresql.org/docs/current/unaccent.html), [fuzzystrmatch](https://www.postgresql.org/docs/current/fuzzystrmatch.html); [chrono-node](https://github.com/wanasit/chrono), [Duckling](https://github.com/facebook/duckling)
- [Google Conversation Design — Confirmações](https://developers.google.com/assistant/conversation-design/confirmations), [OpenTelemetry GenAI agent spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md), [LangSmith Automation rules](https://docs.langchain.com/langsmith/rules)
