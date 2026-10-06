# Recomendações oficiais da OpenAI e da Anthropic para a arquitetura da Secretária (pesquisa de 30/09/2026)

Workflow `wf_80e5d492-5c3`: 4 pesquisadores e 1 verificador, que reabriu cada fonte. Status: CONFIRMED = citação, data e fonte oficial conferidas; OVERSTATED, WRONG_DATE = ver a nota do verificador.

## OpenAI

### Quando usar agente em vez de regras determinísticas

- **Status:** CONFIRMED
- **Fonte:** https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf (sem data)
- **Citação:** "Unlike simpler LLM applications, agents execute workflows end-to-end, making them well-suited for use cases that involve complex decisions, unstructured data, or brittle rule-based systems."
- **Recomendação:** A OpenAI recomenda agentes justamente para fluxos em que regras determinísticas falham: decisões com nuance, conjuntos de regras extensos que ficaram difíceis de manter e forte dependência de linguagem natural. O guia pede validar esses critérios antes; se não se aplicarem, uma solução determinística basta.
- **Aplicação à Secretária:** Dá razão ao dono. Um backend grande que reinterpreta o português com provas literais e regras temporais é exatamente o caso de 'brittle rule-based system'. A interpretação deve sair do backend e ir para o LLM, como em (a) ou (c). O backend fica com o que é determinístico por natureza: fatos da agenda, conflitos, permissões.

### Um único agente primeiro

- **Status:** CONFIRMED
- **Fonte:** https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf (sem data)
- **Citação:** "Our general recommendation is to maximize a single agent's capabilities first."
- **Recomendação:** Maximizar primeiro a capacidade de um único agente com ferramentas. Só dividir em vários agentes quando ele falhar de forma consistente em seguir instruções ou escolher ferramentas. Vários agentes trazem complexidade e overhead.
- **Aplicação à Secretária:** Favorece (a) ou (c) com um só agente (a Secretária), com poucas ferramentas somente leitura, sem pipeline de agentes classificador → extrator → validador. Uma mensagem com várias ações (marcar, mover, cancelar, bloquear) continua sendo trabalho de um único agente, que devolve um plano com vários itens.

### Classificar risco de cada ferramenta (leitura vs escrita)

- **Status:** CONFIRMED
- **Fonte:** https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf (sem data)
- **Citação:** "based on factors like read-only vs. write access, reversibility, required account permissions, and financial impact. Use these risk ratings to trigger automated actions"
- **Recomendação:** Dar a cada ferramenta um risco baixo, médio ou alto, conforme leitura ou escrita, reversibilidade, permissões e impacto financeiro. O risco decide pausas e escalonamento para humano. O mesmo guia diz que ações sensíveis ou irreversíveis devem passar por supervisão humana até crescer a confiança no agente, e que é preciso limitar tentativas e ações, escalando quando o limite é excedido.
- **Aplicação à Secretária:** Confirma o desenho atual. As ferramentas de leitura (agenda, horários livres, catálogo, expediente) são de baixo risco e podem ser chamadas livremente no loop de (a)/(c). As escritas (marcar, mover, cancelar, bloquear) são de alto risco e só acontecem depois do 'Confirmar'. Convém também limitar as iterações do loop e, ao estourar o limite, devolver uma pergunta ao dono em vez de um plano.

### Aprovação humana e validação junto da ferramenta que escreve (Agents SDK)

- **Status:** CONFIRMED
- **Fonte:** https://developers.openai.com/api/docs/guides/agents/guardrails-approvals (sem data)
- **Citação:** "Approvals are the human-in-the-loop path for tool calls. The model can still decide that an action is needed, but the run pauses until you approve or reject it."
- **Recomendação:** Guardrails fazem checagens automáticas. Aprovações (human-in-the-loop) pausam antes de efeitos colaterais como cancelamentos e edições, e a execução é retomada do mesmo estado depois do aprovar/rejeitar. A página manda pôr a validação ao lado da ferramenta que cria o efeito colateral, sem confiar só em guardrails de entrada/saída, e falhar fechado se a revisão não acontecer.
- **Aplicação à Secretária:** O 'Confirmar' é exatamente o padrão de aprovação. Em (a)/(c), o LLM decide as ações e o backend guarda o plano ou estado pendente. O backend só valida fatos no momento da escrita: horário ainda livre, dentro do expediente, profissional e serviço existentes no tenant. Não reinterpreta a linguagem. Se a validação falhar ou a confirmação expirar, nada é escrito.

### Pedir aprovação só sobre um resultado concreto e revisável (GPT-6)

- **Status:** CONFIRMED
- **Fonte:** https://developers.openai.com/api/docs/guides/latest-model (sem data)
- **Citação:** "complete the work that is already authorized from context and necessary to make the proposed action concrete and reviewable. The user should be approving a concrete, reviewable result."
- **Recomendação:** O guia do GPT-6 sugere que o modelo faça antes todo o trabalho já autorizado, incluindo leituras e ações reversíveis, sem pedir permissão. A aprovação do usuário deve ser o passo final, sobre algo concreto. O modelo deve perguntar só quando a resposta mudar o resultado. A OpenAI avisa que esses prompts foram observados no Astra e devem ser avaliados no modelo escolhido.
- **Aplicação à Secretária:** Apoia (a)/(c). O agente consulta a agenda, os horários livres e o catálogo por conta própria e devolve ao dono um plano já resolvido: IDs, horários, conflitos apontados. O 'Confirmar' é o último passo. Perguntas de esclarecimento ficam para ambiguidades que mudam o resultado (qual 'Ana'? qual dia?). O dono não deve ter de responder o que a agenda já responde.

### Critérios de decisão em vez de mapas de palavras-chave

- **Status:** CONFIRMED
- **Fonte:** https://developers.openai.com/api/docs/guides/prompt-guidance-gpt-5p6 (sem data)
- **Citação:** "When the correct value is implicit, provide decision criteria and let the model reason from context or schema. Avoid universal defaults, keyword maps, and broad semantic shortcuts."
- **Recomendação:** Nos prompts, preservar valores explícitos do usuário. Quando o valor for implícito, dar critérios de decisão e deixar o modelo raciocinar pelo contexto ou pelo schema, evitando defaults universais e mapas de palavras-chave. Antes de agir, o modelo deve resolver as leituras e validações pré-requisito. MUST/NEVER ficam para invariantes reais.
- **Aplicação à Secretária:** Vai contra regras fixas como 'pras 2 = 14h' ou o parsing literal no backend. A recomendação é dar ao LLM os horários reais do tenant e critérios ('interprete horas ambíguas pelo expediente e pelos horários livres; se couberem duas leituras, pergunte'). Isso favorece (a)/(c). A página é da família GPT-5.6, mas a própria OpenAI indica que vale para modelos da classe GPT-5, o que inclui GPT-6.

### Tirar carga do modelo: argumentos conhecidos vêm do código

- **Status:** CONFIRMED
- **Fonte:** https://developers.openai.com/api/docs/guides/function-calling (sem data)
- **Citação:** "Don't make the model fill arguments you already know."
- **Recomendação:** Nas boas práticas de function calling: passar pelo código os valores que a aplicação já conhece em vez de pedir ao modelo, juntar funções sempre chamadas em sequência e usar código onde der. Descrever cada função e parâmetro com clareza, dizer no prompt quando usar e quando não usar cada uma, e aplicar o 'teste do estagiário'.
- **Aplicação à Secretária:** Tenant, fuso horário, data e hora atuais e o usuário dono entram pelo código, nunca como argumentos do LLM. Em (a)/(c), as ferramentas de leitura recebem só o que o modelo realmente precisa decidir (data e profissional). O cálculo de horários livres fica no backend, dentro da ferramenta, e não é feito pelo modelo.

### Strict mode e saída estruturada para o plano

- **Status:** CONFIRMED
- **Fonte:** https://developers.openai.com/api/docs/guides/function-calling (sem data)
- **Citação:** "Setting `strict` to `true` will ensure function calls reliably adhere to the function schema, instead of being best effort. We recommend always enabling strict mode."
- **Recomendação:** Ativar sempre strict: true nas funções para que as chamadas sigam o schema de forma garantida, e usar enums e estrutura de objeto para impedir estados inválidos. Para a resposta final ao app, usar Structured Outputs (text.format com json_schema, ou output_type no Agents SDK), porque o código consome dados tipados.
- **Aplicação à Secretária:** Vale para (a), (b) e (c). O plano proposto deve ser JSON estrito, com uma lista de ações tipadas por enum (book, move, cancel, block, change_service, read) que referenciam IDs retornados pelas ferramentas ou pelo contexto. Assim o backend valida fatos, não texto. O schema garante o formato, não a correção: a checagem de fatos continua obrigatória.

### Poucas ferramentas; tool search e allowed_tools

- **Status:** CONFIRMED
- **Fonte:** https://developers.openai.com/api/docs/guides/function-calling (sem data)
- **Citação:** "Aim for fewer than 20 functions available at the start of a turn at any one time, though this is just a soft suggestion."
- **Recomendação:** Manter pequeno o conjunto de funções disponíveis no início de cada turno (sugestão flexível: menos de 20) e avaliar o desempenho com números diferentes de ferramentas. Tool search (defer_loading, namespaces com menos de 10 funções) serve para ecossistemas grandes. allowed_tools restringe um subconjunto sem mudar a lista de tools, preservando o prompt caching.
- **Aplicação à Secretária:** Em (a)/(c) bastam de 4 a 6 ferramentas de leitura. Tool search não se justifica nessa escala, e custom tools ou gramáticas também não, já que o plano é JSON. allowed_tools pode ser útil para fixar só ferramentas de leitura na fase de interpretação sem invalidar o cache. Em (b) não há ferramentas, só contexto pré-carregado.

### O que vai no contexto vs o que vai por ferramenta (base do híbrido)

- **Status:** CONFIRMED
- **Fonte:** https://developers.openai.com/api/docs/guides/agents/define-agents (sem data)
- **Citação:** "If the model needs a fact, put it in instructions, input, retrieval, or a tool. If only your runtime needs it, keep it in local context."
- **Recomendação:** O Agents SDK separa o que o modelo vê (instruções, input, retrieval, ferramentas) do contexto local que só o código vê. Instruções que dependem do tenant ou do usuário devem vir de um callback de instruções dinâmicas, sem concatenar strings na chamada. O prompt caching reaproveita prefixos idênticos, por isso o conteúdo estável deve ficar no início.
- **Aplicação à Secretária:** É a base do (c). Fatos pequenos e estáveis (expediente, catálogo de serviços, profissionais, data de hoje) vão pré-carregados no input, como em (b), com prefixo estável para cache: o gpt-6-luna cobra US$0,10/1M de input e US$0,01/1M de input em cache, segundo a página do modelo. Fatos grandes ou dependentes da mensagem (agenda de um dia, horários livres de um serviço) vêm por ferramenta de leitura no loop, como em (a). IDs internos e tenant ficam no contexto local.

### Esforço de raciocínio e few-shot em modelos de raciocínio

- **Status:** OVERSTATED (A citação existe, mas a tabela de effort da página é apresentada no contexto do gpt-5.5. 'Nível atual e um abaixo' e 'checar critério/roteamento antes de subir' vêm do guia do GPT-5.6 (migração de 5.5/5.4), não desta página. Aqui o 'high' é recomendado para agentes; só o xhigh exige evals. 'Exemplos podem piorar' é mais forte que 'often don't need'.)
- **Fonte:** https://developers.openai.com/api/docs/guides/reasoning (sem data)
- **Citação:** "Efficient reasoning with a modest latency increase. Ideal for use cases requiring tool-use, planning, search, or multi-step decision making, while optimizing for speed and cost."
- **Recomendação:** O effort padrão do GPT-6 Luna é medium. 'low' é indicado para uso de ferramentas, planejamento e decisões em várias etapas com foco em custo e velocidade; high/xhigh só quando os evals mostrarem ganho claro. A OpenAI recomenda testar o nível atual e um abaixo e, antes de subir o effort, verificar se falta no prompt um critério de sucesso ou uma regra de roteamento. Sobre exemplos: começar zero-shot, porque exemplos podem piorar modelos de raciocínio; se usar few-shot, os exemplos devem bater exatamente com as instruções.
- **Aplicação à Secretária:** Para (a)/(c) no gpt-6-luna, comparar low, medium e high no conjunto de prova (C4/Golden) antes de mexer no prompt. No loop com ferramentas, devolver os reasoning items entre chamadas (previous_response_id), como a mesma página recomenda. Poucos exemplos curtos, coerentes com as regras, e só para os padrões que falham de forma recorrente, como mensagens com várias ações.

### Evals de agente e trace grading

- **Status:** CONFIRMED
- **Fonte:** https://developers.openai.com/api/docs/guides/agent-evals (sem data)
- **Citação:** "Trace grading is the fastest way to identify workflow-level issues. A trace captures the end-to-end record of model calls, tool calls, guardrails, and handoffs for one run."
- **Recomendação:** Começar por traces para depurar comportamento: se o agente escolheu a ferramenta certa e se violou alguma instrução. Criar graders sobre os traces e, depois, datasets e eval runs repetíveis para comparar prompts, modelos e effort. As boas práticas de evals incluem medir seleção de ferramenta e precisão dos argumentos (data precision). O guia prático sugere fixar uma linha de base com o modelo mais capaz e depois trocar por modelos menores para ver onde falham.
- **Aplicação à Secretária:** Antes de escolher entre (a), (b) e (c), rodar o mesmo conjunto de prova nas três opções e avaliar o plano final (ações e IDs corretos, escritas erradas = 0) e o trace (ferramentas chamadas, argumentos, número de voltas). Uma rodada de linha de base com Sol ou Astra mostra se a reprovação vem do gpt-6-luna ou da arquitetura, sem trocar o modelo de produção.

### GPT-6: pedir aprovação só depois de um resultado concreto e revisável (bias to action)

- **Status:** CONFIRMED
- **Fonte:** https://developers.openai.com/api/docs/guides/latest-model (sem data (página viva; pelo changelog: Astra 03/09/2026, Luna 22/09/2026, 6.1 Sol 29/09/2026))
- **Citação:** "Prompt the model to ask for approval only after preparing a concrete, reviewable result."
- **Recomendação:** O guia oficial da família GPT-6 (Astra, 6.1 Sol e Luna) recomenda que o modelo infira a intenção, tenha 'bias towards action' e faça antes todo o trabalho já autorizado (leituras, ações reversíveis), para que a aprovação do usuário seja o último passo. Leitura não exige permissão, e o guia desaconselha criar fluxos de aprovação extras por risco hipotético. O próprio guia avisa que esses prompts foram calibrados com o Astra e precisam ser avaliados no modelo escolhido, que no nosso caso é o Luna.
- **Aplicação à Secretária:** Favorece (a) ou (c). O modelo consulta sozinho agenda, horários livres e catálogo e entrega uma proposta já resolvida. O botão 'Confirmar' é exatamente o 'último passo' que o guia descreve. O modelo não deve parar para perguntar antes de ler a agenda e só pergunta quando a resposta mudaria o resultado. O backend não precisa de outra camada de aprovação semântica.

### Instruções muito prescritivas atrapalham, mas o Luna pede orientação diferente da do Astra

- **Status:** OVERSTATED (A citação e a data (Sep 11, 2026, no HTML) estão certas. Mas a conclusão 'modelos menores ainda se beneficiam de mais orientação' é inferência; o post fala de skills de repositório para agentes de código e não diz isso.)
- **Fonte:** https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra (2026-09-11)
- **Citação:** "Guidance that helps Sol or Luna may overconstrain GPT-6 Astra, so consider which models will use the instructions you leave behind."
- **Recomendação:** A OpenAI pede revisar as instruções acumuladas: descrições curtas, divulgação progressiva e menos 'receitas' passo a passo ('overly specific guidance can now hinder results'). Ao mesmo tempo, admite que orientações úteis para Sol e Luna podem restringir demais o Astra, ou seja, modelos menores ainda se beneficiam de mais orientação.
- **Aplicação à Secretária:** Matiza a tese do dono. Com o gpt-6-luna dá para deixar o LLM interpretar quase tudo, mas trocando regras literais do backend por critérios de decisão curtos no prompt, não por ausência de guia. Isso aponta para (c): o LLM interpreta e o prompt traz critérios enxutos, validados por evals (Golden/C4).

### gpt-6-luna: tools com raciocínio exigem a Responses API; preços

- **Status:** CONFIRMED
- **Fonte:** https://developers.openai.com/api/docs/models/gpt-6-luna (sem data (modelo lançado em 22/09/2026, segundo o changelog))
- **Citação:** "Use the Responses API for built-in tools and function calling."
- **Recomendação:** No Luna, reasoning.effort vai de none a max (padrão medium). No Chat Completions, function calling só funciona com reasoning_effort none; para raciocinar e usar ferramentas é preciso usar a Responses API. Preços por 1M de tokens: US$0,10 de input, US$0,01 de input em cache, US$0,125 de escrita de cache e US$0,50 de output. A lista de ferramentas suportadas não inclui programmatic tool calling.
- **Aplicação à Secretária:** Se escolhermos (a) ou (c) com tools de leitura, a implementação tem de usar a Responses API. Pelo Chat Completions com tools, o modelo perderia o raciocínio justamente na interpretação. Estimativa nossa: com prompts de poucos milhares de tokens, cada rodada extra do loop custa frações de centavo de dólar, então o limitador de (a) é a latência, não o custo.

### Escolha de esforço do Luna para problemas com restrições

- **Status:** CONFIRMED
- **Fonte:** https://developers.openai.com/api/docs/guides/model-selection (sem data)
- **Citação:** "Finding current context across multiple apps, prioritizing work, and solving problems with clear constraints."
- **Recomendação:** O guia oficial de seleção de modelos associa Luna·Low a edições finas e extração simples, e Luna·Extra high a achar o contexto atual e resolver problemas com restrições claras. Recomenda testar com as mesmas entradas e ficar com a configuração mais leve que atinge a barra de qualidade.
- **Aplicação à Secretária:** Interpretar uma mensagem com várias ações contra a agenda real é o caso 'contexto atual + restrições claras'. Vale medir o Luna em medium, high e xhigh no Golden/C4, em vez de low, antes de concluir que o modelo não dá conta. Isso vale para (a), (b) e (c). O gpt-6.1-sol, lançado em 29/09/2026, só entra se o dono reabrir a decisão de modelo.

### GPT-5.6: prompts orientados a resultado, não a passos

- **Status:** CONFIRMED
- **Fonte:** https://developers.openai.com/api/docs/guides/prompt-guidance-gpt-5p6 (sem data (família GPT-5.6 lançada em 09/07/2026, segundo o changelog))
- **Citação:** "GPT-5.6 works best when prompts define the outcome, important constraints, available evidence, and completion bar, then leave room for the model to choose an efficient path."
- **Recomendação:** Descreva o destino (resultado, restrições, evidências disponíveis e critério de pronto) e deixe o modelo escolher o caminho. Use ALWAYS/NEVER apenas para invariantes verdadeiros e regras de decisão para julgamentos.
- **Aplicação à Secretária:** Apoia a tese do dono e as opções (a) e (c). O prompt define o resultado (plano resolvido apontando ids de linhas), as restrições (funcionamento, duração, conflitos) e quando está pronto. O backend deixa de reinterpretar o português e só valida fatos. Invariante duro: nada é escrito antes do 'Confirmar'.

### Evitar mapas de palavras-chave e padrões universais

- **Status:** CONFIRMED
- **Fonte:** https://developers.openai.com/api/docs/guides/prompt-guidance-gpt-5p6 (sem data (família GPT-5.6 lançada em 09/07/2026, segundo o changelog))
- **Citação:** "When the correct value is implicit, provide decision criteria and let the model reason from context or schema. Avoid universal defaults, keyword maps, and broad semantic shortcuts."
- **Recomendação:** Preserve literalmente os valores explícitos do usuário. Quando o valor é implícito, dê critérios de decisão e deixe o modelo raciocinar pelo contexto ou pelo schema. Evite padrões universais, mapas de palavras-chave e atalhos semânticos amplos.
- **Aplicação à Secretária:** É uma crítica direta ao backend determinístico atual: provas literais, regras temporais fixas como '2 = 14h' e mapas de termos são o que a OpenAI manda evitar. Está alinhado com a Candidata 4, que resolve 'pras 2' pelos horários reais do salão. Na prática: o LLM resolve o implícito com a agenda e o horário de funcionamento como contexto, e o backend apenas confere os fatos (opção a/c).

### GPT-5.6: prompts mais enxutos melhoram qualidade e custo

- **Status:** CONFIRMED
- **Fonte:** https://developers.openai.com/api/docs/guides/prompt-guidance-gpt-5p6 (sem data (família GPT-5.6 lançada em 09/07/2026, segundo o changelog))
- **Citação:** "configurations with leaner system prompts improved evaluation scores by roughly 10–15% while reducing total tokens by 41–66% and cost by 33–67%."
- **Recomendação:** Remova regras repetidas, exemplos que não mudam o comportamento e tools irrelevantes, um grupo por vez, rodando as mesmas evals a cada corte. Mantenha o resultado esperado, os critérios de sucesso, as restrições de permissão e o formato de saída. Os números da OpenAI vêm de evals internas de agentes de código e ela os trata como indicativos.
- **Aplicação à Secretária:** Vale para qualquer opção. Enxugue o system prompt da Secretária e corte as regras que o backend repetia, mantendo só os invariantes (escrever apenas após Confirmar, usar somente ids existentes). Meça cada corte no Golden/C4. Um prompt enxuto também é o que torna (a)/(c) viável no Luna sem rigidez.

### Menor número útil de rodadas de ferramenta, sem sacrificar a evidência

- **Status:** CONFIRMED
- **Fonte:** https://developers.openai.com/api/docs/guides/prompt-guidance-gpt-5p6 (sem data (família GPT-5.6 lançada em 09/07/2026, segundo o changelog))
- **Citação:** "Resolve the request in the fewest useful tool loops, but do not let loop minimization outrank correctness, required evidence, calculations, or required citations."
- **Recomendação:** Antes de agir, resolva as etapas de descoberta, busca e validação necessárias. Depois de cada resultado, verifique se já dá para responder; se falta um fato, nomeie o que falta e use o menor fallback útil. Paralelize leituras independentes e mantenha sequenciais as dependentes.
- **Aplicação à Secretária:** Sustenta o híbrido (c). Pré-carregue o contexto quase sempre necessário para que a maioria das mensagens se resolva em 0 ou 1 rodada, como em (b). Deixe tools de leitura para quando faltar evidência (outro dia, outro profissional, horários livres), como em (a). Inclua no prompt uma regra de parada: se o plano já pode ser montado, monte.

### Passar ao código o que já é conhecido; poucas funções, em modo strict

- **Status:** CONFIRMED
- **Fonte:** https://developers.openai.com/api/docs/guides/function-calling (sem data)
- **Citação:** "Don't make the model fill arguments you already know."
- **Recomendação:** Não peça ao modelo argumentos que o sistema já conhece, combine funções que sempre são chamadas em sequência e mantenha menos de 20 funções no início do turno. Use enums para impedir estados inválidos e ative sempre o strict mode ('We recommend always enabling strict mode').
- **Aplicação à Secretária:** Aponta para (c). O backend injeta o que já sabe (tenant, data e hora atuais, fuso, catálogo, funcionamento, profissionais) e expõe poucas tools de leitura com schema estrito. O plano sai em Structured Outputs com ids de linhas, e o backend valida apenas se os ids existem e se o slot está livre.

### Subagentes/multi-agent: quando não usar

- **Status:** CONFIRMED
- **Fonte:** https://developers.openai.com/api/docs/guides/responses-multi-agent (sem data (multi-agent do GPT-6.1 Sol anunciado em 29/09/2026, segundo o changelog))
- **Citação:** "Note that adding subagents can increase token usage, and may not be as beneficial for tasks that depend on a single ordered chain of reasoning"
- **Recomendação:** O multi-agent da Responses API está em beta e só existe para GPT-6.1 Sol e modelos GPT-5.6. A OpenAI recomenda um único agente quando cada passo depende do anterior, quando a tarefa cabe numa execução curta ou quando os agentes disputariam o mesmo recurso mutável.
- **Aplicação à Secretária:** Descarta subagentes para a Secretária. As ações de uma mesma mensagem dependem umas das outras (mover A libera o horário de B) e mexem na mesma agenda. Além disso, o gpt-6-luna não está entre os modelos suportados. Em (a) ou (c) deve haver um único loop, não uma orquestração de agentes.

### Agents API (DevDay 2026): runtime gerenciado é para tarefas longas

- **Status:** CONFIRMED
- **Fonte:** https://developers.openai.com/api/docs/guides/agents (sem data (Agents API em beta público desde 10/09/2026, segundo o changelog))
- **Citação:** "Long-running tasks where OpenAI manages the agent and saves its progress"
- **Recomendação:** A Agents API, em beta público desde 10/09/2026 e com computer use adicionado no DevDay de 29/09/2026, roda o harness Codex gerenciado pela OpenAI, com sessões duráveis, compaction, subagentes e recuperação. A própria página de comparação indica o Agents SDK para controlar o loop dentro do app e a Responses API para chamar modelos diretamente.
- **Aplicação à Secretária:** É desproporcional para a Secretária. A interação é curta e síncrona (mensagem vira proposta em segundos) e as leituras são funções do nosso próprio backend multi-tenant. Em (a) ou (c), o loop deve rodar no nosso servidor com a Responses API, ou o Agents SDK, mantendo controle de tenant, auditoria e do 'Confirmar'.

### Prompt caching com breakpoints explícitos (GPT-5.6 e posteriores, inclui Luna)

- **Status:** CONFIRMED
- **Fonte:** https://developers.openai.com/api/docs/guides/prompt-caching (sem data (controles explícitos lançados com o GPT-5.6 em 09/07/2026, segundo o changelog))
- **Citação:** "If requests share a long prefix but have different suffixes, caching the first complete request implicitly-only does not make the shorter shared prefix reusable."
- **Recomendação:** Desde o GPT-5.6 existe prompt_cache_options.mode (implicit/explicit) com prompt_cache_breakpoint, mínimo de 1.024 tokens, escrita a 1,25x, leitura a 0,1x e ttl '30m'. Coloque primeiro o conteúdo estável e marque um breakpoint logo depois dele; o conteúdo dinâmico vem em seguida. Instruções no campo top-level 'instructions' não aceitam breakpoint, então use uma mensagem developer. Só adote breakpoints explícitos se a medição mostrar ganho.
- **Aplicação à Secretária:** Em (b) e (c), o contexto pré-carregado (agenda do dia, horários livres) muda a cada requisição. Instruções, tools, catálogo e funcionamento do salão vão no início com breakpoint explícito, e a agenda dinâmica vem depois; o modo explicit evita pagar escrita da parte que muda. Em (a), cada rodada só acrescenta resultados, então o cache implícito aproveita bem as rodadas seguintes. Se o prefixo estável tiver menos de 1.024 tokens, não há cache.

## Anthropic

### Building effective agents: workflows vs agentes e começar simples

- **Status:** CONFIRMED
- **Fonte:** https://www.anthropic.com/engineering/building-effective-agents (19/12/2024. A página tem uma nota do editor dizendo que o cenário de ferramentas mudou desde dez/2024 e remetendo a Claude Managed Agents (de 2026). A página não mostra a data da nota. Um resumo de terceiros citou modificação em 10/08/2026, mas isso não foi confirmado na página oficial.)
- **Citação:** "workflows offer predictability and consistency for well-defined tasks, whereas agents are the better option when flexibility and model-driven decision-making are needed at scale."
- **Recomendação:** Comece com a solução mais simples e só aumente a complexidade quando necessário. Use workflow (caminhos de código predefinidos) quando a tarefa é bem definida e agente (o LLM decide o próprio processo e as ferramentas) quando for preciso flexibilidade e decisão do modelo. O post também avisa que a autonomia significa "higher costs, and the potential for compounding errors".
- **Aplicação à Secretária:** Favorece (c) puxando para (a). Interpretar português livre com várias ações é a parte aberta, então vale a flexibilidade do LLM. Validar fatos e gravar depois do "Confirmar" é a parte bem definida e deve seguir como workflow determinístico. O backend que reinterpreta o português (provas literais, regras temporais) é justamente a complexidade que o post manda evitar até provar que ela é necessária.

### Building effective agents: verdade vinda do ambiente e checkpoints humanos

- **Status:** CONFIRMED
- **Fonte:** https://www.anthropic.com/engineering/building-effective-agents (19/12/2024 (com nota do editor posterior, sem data exibida))
- **Citação:** "agents to gain 'ground truth' from the environment at each step (such as tool call results or code execution) to assess its progress."
- **Recomendação:** Em cada passo, o agente deve se basear no resultado real das ferramentas (a verdade do ambiente), não em suposições. O post também diz: "Agents can then pause for human feedback at checkpoints or when encountering blockers." Recomenda testes extensos em ambiente isolado (sandbox) com guardrails adequados.
- **Aplicação à Secretária:** Apoia (a) e (c). Os horários livres, a agenda, o catálogo e o expediente devem vir de ferramentas somente leitura, que são a verdade. O LLM não deve deduzir disponibilidade sozinho. O botão "Confirmar" já é o checkpoint humano recomendado. Quando faltar informação (qual cliente? qual profissional?), o LLM deve parar e perguntar, sem que o backend chute.

### Building effective agents: design da interface agente-computador (ACI) e poka-yoke

- **Status:** CONFIRMED
- **Fonte:** https://www.anthropic.com/engineering/building-effective-agents (19/12/2024 (com nota do editor posterior, sem data exibida))
- **Citação:** "Poka-yoke your tools. Change the arguments so that it is harder to make mistakes."
- **Recomendação:** Invista no design das ferramentas tanto quanto se investe em interface humana. Crie argumentos que tornem o erro difícil: IDs em vez de texto livre, data e hora absolutas com fuso, enums para o tipo de ação. O post também diz: "invest just as much effort in creating good agent-computer interfaces (ACI)."
- **Aplicação à Secretária:** Vale para (a) e (c). O plano que o LLM devolve deve ter formato estrito: acao ∈ {agendar, remarcar, cancelar, bloquear, alterar_servico}, agendamento_id, profissional_id, servico_id e inicio em ISO com fuso America/Sao_Paulo. Assim o backend só confere fatos e deixa de reinterpretar o português. Em (b), apontar para as linhas pré-carregadas é uma forma de poka-yoke.

### Writing effective tools for agents: ferramentas de alto nível, nomes legíveis e erros úteis

- **Status:** CONFIRMED
- **Fonte:** https://www.anthropic.com/engineering/writing-tools-for-agents (11/09/2025)
- **Citação:** "Instead of implementing a `list_users`, `list_events`, and `create_event` tools, consider implementing a `schedule_event` tool which finds availability and schedules an event."
- **Recomendação:** Não exponha uma ferramenta para cada endpoint da API: junte o que costuma andar junto (por exemplo, achar disponibilidade e agendar). Devolva campos com significado e nomes naturais em vez de identificadores crípticos. Use paginação, filtros e truncamento com bons valores padrão. Escreva mensagens de erro claras e acionáveis. Melhore as ferramentas guiado por avaliações (evals).
- **Aplicação à Secretária:** Em (a) e (c), prefira poucas ferramentas de leitura de alto nível, como buscar_horarios_livres(servico, profissional, periodo) e consultar_agenda(dia, profissional), em vez de listar tudo cru. Elas devem devolver nomes de cliente, serviço e profissional junto com os IDs. Se a validação falhar, o erro deve dizer ao LLM o que corrigir ("às 14h a Ana já tem cliente; livres: 15h, 16h30").

### Effective context engineering: contexto sob demanda (just-in-time) vs pré-carregado e estratégia híbrida

- **Status:** CONFIRMED
- **Fonte:** https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents (29/09/2025)
- **Citação:** "the most effective agents might employ a hybrid strategy, retrieving some data up front for speed, and pursuing further autonomous exploration at its discretion"
- **Recomendação:** Pré-carregar é mais rápido; buscar sob demanda ocupa menos contexto, mas é mais lento ("runtime exploration is slower than retrieving pre-computed data"). O post sugere o híbrido: carregar de início o essencial e estável e deixar o agente buscar o resto com ferramentas. Ele observa que "The decision boundary for the 'right' level of autonomy depends on the task" e que "do the simplest thing that works" continua sendo o melhor conselho.
- **Aplicação à Secretária:** Endossa diretamente (c). Pré-carregue o que é pequeno e estável: data e hora atuais, expediente, catálogo de serviços, profissionais e a agenda de hoje e amanhã. Isso resolve a maioria das mensagens em 1 chamada, como em (b). Ofereça ferramentas somente leitura para o resto: outros dias, horários livres, busca de cliente. Assim o gpt-6-luna explora só quando precisa, como em (a).

### Effective context engineering: evitar lógica frágil do tipo if-else e escrever o prompt na 'altitude certa'

- **Status:** CONFIRMED
- **Fonte:** https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents (29/09/2025)
- **Citação:** "At one extreme, we see engineers hardcoding complex, brittle logic in their prompts to elicit exact agentic behavior."
- **Recomendação:** Não codifique lógica complexa e frágil para forçar um comportamento exato. Escreva o prompt de sistema na "altitude certa": específico o bastante para guiar, flexível o bastante para dar heurísticas. Em vez de listar casos extremos, use alguns exemplos diversos e canônicos. Busque o menor conjunto de tokens de alto sinal.
- **Aplicação à Secretária:** Mostra onde está a rigidez atual. O post fala de lógica frágil no prompt, mas o mesmo raciocínio vale para as "provas literais" e as regras temporais no backend. Em (a) e (c), deixe a interpretação com o LLM, guiada por heurísticas e poucos exemplos canônicos de mensagens reais do dono com múltiplas ações. As regras determinísticas ficam só para fatos (conflito, expediente, existência de IDs).

### Demystifying evals: avaliar o resultado, não o caminho

- **Status:** CONFIRMED
- **Fonte:** https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents (09/01/2026)
- **Citação:** "It's often better to grade what the agent produced, not the path it took."
- **Recomendação:** Avalie o que o agente produziu (o estado final), não a sequência de chamadas de ferramenta. Combine avaliadores por código, por modelo e humanos. Comece com 20 a 50 tarefas simples tiradas de falhas reais. Teste casos em que a ação deve e em que não deve ocorrer. Leia as transcrições.
- **Aplicação à Secretária:** Em (a), o agente pode chegar ao mesmo plano por caminhos diferentes. Avalie o plano final (ações, IDs, horários) comparando por código com um gabarito (golden), não se ele chamou a ferramenta X antes da Y. Um bom conjunto inicial são as falhas reais da prova C4, incluindo as 4 escritas erradas. Inclua casos negativos (mensagem só de leitura não deve gerar escrita).

### Demystifying evals: pass^k para agentes voltados ao cliente e regressão

- **Status:** CONFIRMED
- **Fonte:** https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents (09/01/2026)
- **Citação:** "This metric especially matters for customer-facing agents where users expect reliable behavior every time."
- **Recomendação:** Meça pass^k: a probabilidade de acertar em todas as k tentativas, não só em pelo menos uma. Separe evals de capacidade (começam com taxa baixa) de evals de regressão (perto de 100%). O post alerta: "Evals get harder to build the longer you wait." Para agentes conversacionais, use um segundo LLM para simular o usuário.
- **Aplicação à Secretária:** Serve para decidir entre (a), (b) e (c) com dados, não com opinião. Rode o mesmo conjunto golden k vezes no gpt-6-luna em cada arquitetura e compare pass^k, latência e custo. Um loop agente (a) pode ter pass@1 alto e pass^k baixo por causa da variação. O híbrido (c) tende a ser mais estável porque faz menos passos.

### Post da ferramenta 'think': hoje prefira o raciocínio nativo

- **Status:** WRONG_DATE (A citação está na página, mas a nota do editor TEM data: 'Extended thinking update Dec 15, 2025'. O item diz 'sem data exibida'. A publicação em 20/03/2025 está correta, e o resto da recomendação bate.)
- **Fonte:** https://www.anthropic.com/engineering/claude-think-tool (20/03/2025 (nota do editor posterior, sem data exibida))
- **Citação:** "Extended thinking capabilities have improved since its initial release, such that we recommend using that feature instead of a dedicated think tool in most cases."
- **Recomendação:** A nota do editor diz que o extended thinking nativo evoluiu e deve ser preferido à ferramenta "think" dedicada na maioria dos casos. O post original indicava pensar entre passos em ambientes cheios de regras, decisões sequenciais e análise de saída de ferramentas. Também dizia que isso ajuda pouco com chamada única ou instruções simples e que exemplos do domínio no prompt melhoram muito o resultado.
- **Aplicação à Secretária:** O gpt-6-luna já é um modelo de raciocínio, então não crie uma ferramenta "pensar" artificial: ajuste o esforço de raciocínio do próprio modelo. Mensagens com várias ações dependentes (remarcar A para liberar B) são decisões sequenciais e se beneficiam de raciocinar sobre os resultados das ferramentas, o que favorece (a) e (c) em vez de uma única chamada cega. A extrapolação da Anthropic (Claude) para a OpenAI é inferência.

### Managed Agents: suposições do harness ficam obsoletas conforme os modelos melhoram

- **Status:** CONFIRMED
- **Fonte:** https://www.anthropic.com/engineering/managed-agents (08/04/2026)
- **Citação:** "Harnesses encode assumptions about what Claude can't do on its own. However, those assumptions need to be frequently questioned because they can go stale as models improve."
- **Recomendação:** Revise com frequência as camadas que o harness (o código em volta do modelo) adiciona para compensar limitações do modelo, porque elas envelhecem. O post dá o exemplo de uma correção necessária no Sonnet 4.5 que ficou inútil no Opus 4.5. Também recomenda separar o "cérebro" (modelo + harness) das "mãos" (ferramentas e sandbox) e manter as credenciais fora do alcance do código gerado pelo modelo.
- **Aplicação à Secretária:** Reforça a intuição do dono. O grande backend que reinterpreta o português foi criado supondo que o LLM não interpretaria bem, e essa suposição deve ser testada de novo com o gpt-6-luna usando evals. Em (a) e (c), o cérebro (LLM) interpreta e as mãos (backend) só executam e validam. As escritas continuam atrás do "Confirmar" e as credenciais nunca ficam expostas ao modelo.

### Claude Agent SDK: loop do agente e verificação por regras

- **Status:** CONFIRMED
- **Fonte:** https://claude.com/blog/building-agents-with-the-claude-agent-sdk (29/09/2025)
- **Citação:** "The best form of feedback is providing clearly defined rules for an output, then explaining which rules failed and why."
- **Recomendação:** Use o ciclo "gather context -> take action -> verify work -> repeat". A melhor verificação é por regras claras que dizem ao modelo qual regra falhou e por quê. Usar um LLM como juiz é "generally not a very robust method, and can have heavy latency tradeoffs". As ferramentas são as ações principais que o modelo considera.
- **Aplicação à Secretária:** Mostra o papel certo do backend determinístico em (a) e (c). Ele não reinterpreta o texto: valida o plano do LLM contra regras de fato (fora do expediente, conflito, serviço inexistente, ID inválido) e devolve a lista de violações para o LLM corrigir antes de mostrar a proposta. Limite esse reparo a 1 ou 2 rodadas para controlar custo e latência.

### Agentes de comércio: aprovação humana antes de ir ao ar e guardrails presos aos dados reais

- **Status:** CONFIRMED
- **Fonte:** https://claude.com/blog/claude-for-commerce-agents (02/09/2026)
- **Citação:** "When the agent proactively suggests a change, a person approves it before anything goes live, meaning users get the final say while their agent watches the store."
- **Recomendação:** Quando o agente propõe uma mudança operacional, uma pessoa aprova antes de ela entrar em vigor. Os guardrails devem restringir o agente aos dados reais do catálogo, em vez de confiar no texto gerado.
- **Aplicação à Secretária:** Confirma o desenho atual de proposta mais "Confirmar" nas três opções. O guardrail equivalente para nós é o backend garantir que todo serviço, profissional, cliente e horário do plano exista de fato e esteja livre ("constrain ... to actual catalog data"). A interpretação fica com o LLM; a garantia fica com os dados.

### Scaling Managed Agents: separar o "cérebro" das "mãos" (e as premissas do harness envelhecem)

- **Status:** CONFIRMED
- **Fonte:** https://www.anthropic.com/engineering/managed-agents (2026-04-08)
- **Citação:** "harnesses encode assumptions about what Claude can't do on its own. However, those assumptions need to be frequently questioned because they can go stale as models improve."
- **Recomendação:** Separe o "cérebro" (modelo mais loop) das "mãos" (ferramentas com interface simples do tipo execute(name, input) → string). Questione com frequência as regras que o harness impõe por supor que o modelo não dá conta, porque essas premissas ficam obsoletas quando o modelo melhora.
- **Aplicação à Secretária:** Favorece (a) ou (c). O backend que reinterpreta o português (provas literais, regras temporais) é exatamente uma "premissa sobre o que o modelo não consegue" e deve ser reduzido. O backend passa a ser as "mãos": ferramentas de leitura mais validação de fatos, sem nova interpretação da intenção.

### Design de harness em 3 padrões: "ask what you can stop doing" e ferramentas dedicadas para ações que exigem confirmação

- **Status:** CONFIRMED
- **Fonte:** https://claude.com/blog/harnessing-claudes-intelligence (2026-04-02)
- **Citação:** "Reversibility is often a good criterion, and hard-to-reverse actions such as external API calls can be gated by user confirmation."
- **Recomendação:** Apoie-se no que o modelo já sabe e pergunte o que o harness pode parar de fazer. Mantenha ferramentas dedicadas e tipadas só onde há fronteira de segurança, UX ou observabilidade. Ações difíceis de reverter devem ficar bloqueadas até a confirmação do usuário, e a ferramenta pode ser exibida como modal que bloqueia o loop até o usuário responder.
- **Aplicação à Secretária:** Confirma o desenho atual de escrita: marcar, mover, cancelar e bloquear viram proposta tipada, interceptada pelo backend e travada até o "Confirmar". Muda onde fica a interpretação: ela sai do backend e vai para o LLM (a ou c). A fronteira determinística só existe na escrita.

### Trustworthy agents in practice: leitura liberada, escrita com aprovação, e aprovação do plano inteiro de uma vez

- **Status:** CONFIRMED
- **Fonte:** https://www.anthropic.com/research/trustworthy-agents (2026-04-09)
- **Citação:** "users can, for example, decide it's always safe for Claude to read their calendar, but still require approval before sending someone an invitation."
- **Recomendação:** Configure permissões por ação: leitura sempre permitida e escrita exigindo aprovação. Em tarefas com várias ações, mostre o plano completo antecipadamente para o usuário revisar, editar e aprovar de uma vez (padrão Plan Mode), em vez de pedir aprovação ação por ação.
- **Aplicação à Secretária:** Valida diretamente "ferramentas de leitura livres mais uma proposta única com N ações e um Confirmar" para mensagens do dono com várias ações. Serve para (a), (b) e (c). Sugere permitir que o dono edite a proposta antes de confirmar.

### How we contain Claude: a aprovação humana é falível e a fronteira determinística vem primeiro

- **Status:** CONFIRMED
- **Fonte:** https://www.anthropic.com/engineering/how-we-contain-claude (2026-05-25)
- **Citação:** "Our telemetry showed users approved roughly 93% of permission prompts. The more approvals a user sees, the less attention they pay to each"
- **Recomendação:** Projete a contenção primeiro na camada do ambiente (determinística) e só depois oriente o comportamento no modelo. Aprovações repetidas perdem atenção: os usuários aprovaram cerca de 93% dos prompts. Ferramentas somente leitura podem ser liberadas com muito mais amplitude do que as de escrita.
- **Aplicação à Secretária:** O "Confirmar" do dono não substitui a validação determinística no momento da escrita (conflito de horário, expediente, serviço e profissional existentes, tenant, status). Em (a) ou (c), o backend para de interpretar o português, mas continua como barreira final de fatos. As ferramentas read-only têm baixo risco e podem ser liberadas ao LLM.

### Context engineering: estratégia híbrida (pré-carga mais exploração just-in-time)

- **Status:** OVERSTATED (A citação e a data estão certas. Mas o 'Combine...' imperativo ignora o 'In certain settings... might' e omite que o híbrido 'might be better suited for contexts with less dynamic content'. Isso é relevante, porque a agenda é dinâmica.)
- **Fonte:** https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents (2025-09-29)
- **Citação:** "the most effective agents might employ a hybrid strategy, retrieving some data up front for speed, and pursuing further autonomous exploration at its discretion."
- **Recomendação:** Busque o menor conjunto de tokens de alto sinal. Combine dados trazidos antes, que são mais rápidos, com exploração autônoma via ferramentas quando o modelo precisar, lembrando que explorar em tempo de execução é mais lento que usar dados pré-computados.
- **Aplicação à Secretária:** É o argumento mais direto a favor de (c): pré-carregar o essencial (expediente, catálogo, profissionais, agenda dos dias citados ou próximos) e expor ferramentas read-only (slots livres, outro dia, buscar cliente ou agendamento) para o resto. É de 2025, mas continua sendo a referência citada nos posts de 2026.

### Writing effective tools for agents: poucas ferramentas de alto nível e identificadores legíveis

- **Status:** CONFIRMED
- **Fonte:** https://www.anthropic.com/engineering/writing-tools-for-agents (2025-09-11)
- **Citação:** "consider implementing a schedule_event tool which finds availability and schedules an event."
- **Recomendação:** Consolide passos em ferramentas de alto nível; o próprio exemplo do post é agenda: um schedule_event que acha disponibilidade e agenda. Devolva nomes em linguagem natural em vez de IDs crípticos, ofereça response_format conciso ou detalhado e escreva erros de validação acionáveis que orientem o agente.
- **Aplicação à Secretária:** Em (a) ou (c): expor ferramentas como buscar_horarios_livres(profissional, serviço, janela) e localizar_agendamento(cliente, data), que retornam nome, horário e ID. A validação do backend deve devolver erro explicativo para o LLM corrigir o plano, em vez de rejeição rígida. Em (b), as linhas pré-carregadas devem trazer nomes legíveis ao lado dos IDs.

### Advanced tool use: Tool Search, Programmatic Tool Calling e Tool Use Examples, adotados por gargalo

- **Status:** CONFIRMED
- **Fonte:** https://www.anthropic.com/engineering/advanced-tool-use (2025-11-24)
- **Citação:** "In our own internal testing, tool use examples improved accuracy from 72% to 90% on complex parameter handling."
- **Recomendação:** Não use os três recursos por padrão; ataque o maior gargalo. Para excesso de definições de ferramentas, Tool Search. Para resultados intermediários grandes, PTC. Para erros de parâmetro, Tool Use Examples: o schema JSON não expressa padrões de uso, e os exemplos subiram a acurácia de 72% para 90%.
- **Aplicação à Secretária:** O gargalo provável da Secretária é parâmetro, não quantidade de ferramentas: datas relativas ("sexta que vem", "pras 2"), serviços combinados, qual agendamento mover. Vale incluir exemplos concretos de uso no schema, na descrição ou no prompt. Tool Search é desnecessário com poucas ferramentas. São recursos da API Claude; com gpt-6-luna, replicar o padrão por exemplos.

### Programmatic tool calling (GA): quando NÃO compensa

- **Status:** CONFIRMED
- **Fonte:** https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling (sem data)
- **Citação:** "A small number of tool calls with small responses, especially on the first turn of a conversation, where container and script overhead can exceed the savings"
- **Recomendação:** O PTC compensa em fan-out, resultados grandes e buscas iterativas. É um encaixe fraco para poucas chamadas com respostas pequenas, para fluxos estritamente sequenciais que dependem de raciocínio a cada passo e para ferramentas que exigem feedback imediato do usuário. Meça tokens com e sem o recurso antes de ativar.
- **Aplicação à Secretária:** A agenda de um salão gera poucas leituras pequenas por mensagem, então um loop pesado com execução de código não se justifica. Isso reforça (c), ou um (a) enxuto com 1 a 3 chamadas read-only, em vez de um agente longo e caro.

### Structured outputs e strict tool use (GA): garantem a forma, não a verdade

- **Status:** CONFIRMED
- **Fonte:** https://platform.claude.com/docs/en/build-with-claude/structured-outputs (sem data)
- **Citação:** "Structured outputs guarantee schema-compliant responses through constrained decoding"
- **Recomendação:** Use JSON outputs com schema ou strict tool use (strict: true) para garantir o formato do plano via constrained decoding. Trate as exceções documentadas: em recusa ou em max_tokens, a saída pode não seguir o schema.
- **Aplicação à Secretária:** Em qualquer opção (a, b ou c), o plano resolvido deve sair em schema estrito: lista de ações com tipo, IDs de linha, data e hora ISO, profissional, serviço e nível de confiança ou pergunta. O schema garante a forma, não os fatos, e por isso o backend continua validando conflitos e existência. Não é motivo para o backend reinterpretar o texto.

### Common workflow patterns: comece com uma única chamada e adicione complexidade só se for mensurável

- **Status:** CONFIRMED
- **Fonte:** https://claude.com/blog/common-workflow-patterns-for-ai-agents-and-when-to-use-them (2026-03-05)
- **Citação:** "Before choosing a pattern, try the task as a single agent call first. If that meets your quality bar, you're done."
- **Recomendação:** Antes de escolher um padrão, teste a tarefa com uma única chamada; se atingir a barra de qualidade, está resolvido. Use sequencial como padrão e adicione paralelismo ou loops avaliador-otimizador apenas com ganho medido.
- **Aplicação à Secretária:** Sugere começar por (b) ou (c), com uma chamada e contexto pré-carregado, e só escalar para o loop com ferramentas de (a) onde a eval mostrar falha, por exemplo quando a mensagem cita um dia ou cliente fora do pré-carregado. A escolha entre a, b e c deve ser decidida por medição, não por preferência.

### Automating eval design and hillclimbing (28/09/2026): train/test separados e o risco de overfitting do harness

- **Status:** CONFIRMED
- **Fonte:** https://claude.dev/blog/automating-eval-design-and-hillclimbing/ (2026-09-28)
- **Citação:** "These harness additions improve your evaluation score, but don't translate to improvements in production"
- **Recomendação:** Monte a eval a partir de transcrições reais de produção. Separe treino (legível pelo otimizador) de teste (nunca visto) e meça o ruído antes de iterar. Faça uma mudança por rodada e mantenha-a só se treino e teste melhorarem. Cuidado: regras de harness criadas para casos da eval sobem a nota sem melhorar a produção. Caso real do post: 90,5% contra 78,6% no teste, a cerca de 1/5 do custo.
- **Aplicação à Secretária:** O backend determinístico acumulado para passar em "provas literais" é o padrão de overfitting descrito. Recomendação: montar o conjunto de mensagens reais do dono com split treino/teste e comparar a, b e c no teste nunca visto. Ressalva: o domínio claude.dev não mostra rodapé de propriedade, mas os mesmos números aparecem no post oficial claude.com/blog/reducing-cost-and-improving-performance-with-claude-platform (08/09/2026).

### Demystifying evals for AI agents: avalie o resultado, não o caminho, e use pass^k para consistência

- **Status:** CONFIRMED
- **Fonte:** https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents (2026-01-09)
- **Citação:** "it's often better to grade what the agent produced, not the path it took."
- **Recomendação:** Avalie o que o agente produziu, como o estado final ou a reserva no banco, e não a sequência exata de passos; checagens rígidas de passos geram testes frágeis porque o agente encontra caminhos válidos. Use pass^k quando a consistência importa e comece com 20 a 50 tarefas tiradas de falhas reais.
- **Aplicação à Secretária:** A eval da Secretária deve comparar a proposta final (ações, horários, linhas afetadas) com o gabarito, sem exigir a interpretação literal passo a passo que hoje engessa o sistema. Usar pass^k porque o dono precisa de acerto consistente. Isso permite dar ao LLM a interpretação (a ou c) mantendo o rigor na medição.
