# Gate 3.1B — GPT-6 Luna candidato e auditoria de custo OpenAI

Atualização de 2026-09-23: este documento registra a preparação anterior à bateria real. A Golden Battery V2 passou 10/10 casos funcionais e a promoção **local, sem deploy** está em `SECRETARIA_GATE_3_1B_PROMOCAO.md`. O restante abaixo conserva a auditoria e o plano originais como histórico.

Estado em 2026-09-22: preparação offline. O modelo ativo em `.env.local` permanece `gpt-5.6-luna`, com `SALON_SECRETARY_ALLOW_PAID_CALLS=false`. Não há router JEV nem chamadas reais neste Gate.

## Caminho auditado

| Item | Evidência e resultado |
| --- | --- |
| SDK | `packages/salon-secretary/package.json`: `@openai/agents@0.18.0`, `openai@7.15.0`; provedor `OpenAIProvider({useResponses:true})`. |
| Agent | `packages/salon-secretary/src/index.ts:createServicesAgent`: um Agent, `toolUseBehavior=stop_on_first_tool`, `maxTurns=1`, `parallelToolCalls=false`, `retry.maxRetries=0`, timeout 45 s. |
| Modelo | `SALON_SECRETARY_MODEL` lido por `paidModelConfig`, `createPaidModel` e `src/lib/salon-secretary.ts` para usage. `.env.local` ainda aponta para `gpt-5.6-luna`; `gpt-6-luna` é apenas candidato permitido pelo guard e pelo teste offline. |
| Auth | Chave e projeto dedicados `SALON_SECRETARY_OPENAI_API_KEY` e `SALON_SECRETARY_OPENAI_PROJECT`; não herda `OPENAI_API_KEY` do HQ. HTTPS base URL fixa, retries HTTP zero. `src/lib/salon-secretary-runtime.ts` exige ambiente local e banco descartável antes de disponibilizar a Secretária. |
| Request | `POST /v1/responses`; `model`, `instructions`, mensagens texto, `tools` com exatamente uma Function Tool (`select_capabilities` na descoberta ou `upsert_action_draft` após seleção), `tool_choice` para ela, `parallel_tool_calls=false`, `max_output_tokens=1200`, `store=false`, `stream=false`, `include=[]`. O schema estruturado entra como `parameters` da Function Tool; não se usa `text.format` separado. Capturado em teste com transporte fake pelo SDK instalado. |
| Handler | A Function Tool do Agent chama somente `receive`/validação local. Txx de Services, Customers, Scheduling, Financial, Inventory e Communication são capacidades do backend após a interpretação; não são hosted tools OpenAI. |
| Estado | Não usa SDK Sessions, `conversation`, `previous_response_id`, prompt hospedado, upload de arquivo ou vector store. Drafts e sessões de UI estão no backend Everflair; `store=false` é obrigatório. |
| Tracing/usage | `Runner({tracingDisabled:true,traceIncludeSensitiveData:false})`; `usage.ts` registra model, request/response ID e contadores de tokens. `reasoning_tokens` já integram `output_tokens` e não são cobrados uma segunda vez na estimativa. |
| Saída | O wrapper exige exatamente uma `function_call` com nome esperado e resposta `completed`; rejeita saída hospedada, múltiplas calls e texto livre. |

Busca em `src`, `packages`, `scripts`, configs e testes identificou somente esse ponto OpenAI da Secretária. O pacote HQ separado (`packages/hq-agents/src/chief.ts` e `support.ts`) continua com `gpt-5.6-luna`, Responses, `store=false`, tracing desativado, sem tools; não foi alterado. Referências históricas a `gpt-5.6-luna` em mocks, fixtures e relatórios não configuram o modelo da Secretária. O pacote JEV, seu adapter, dataset, decision-plan, derivation catalog, harness e resultados reais ficaram intactos.

## Capabilities de custo e proteção

O SDK instalado sabe converter `web_search`, `web_search_preview`, `file_search`, `code_interpreter` com `container`, `shell` com `container_auto`/`container_reference`, `computer`, `image_generation`, MCP hospedado e `tool_search`; isso é capacidade da biblioteca, **não** configuração do Everflair. Nenhum desses tipos aparece na request normal capturada. Não há `container`/`container_auto`, container ID, arquivo, vector store, sandbox ou hosted tool no caminho da Secretária.

`packages/salon-secretary/src/openai-cost-guard.ts` protege duas fronteiras: antes de chamar o `Model` do Agents SDK exige uma Function Tool local, nome publicado, sem handoff, estado hospedado, `providerData`/overrides ou tracing; antes do `fetch` valida URL/método e um allowlist estrito da request Responses serializada. Campos novos como `container`, `environment`, `background`, `service_tier`, `conversation` ou `prompt` falham antes da rede. Uma atualização de SDK que mude o payload exige revisão explícita do guard. Só `gpt-5.6-luna` e `gpt-6-luna` são aceitos pelo provider dedicado. Testes rejeitam todos os tipos hospedados citados e verificam old/new model pelo transporte fake.

O guard não substitui um limite de gasto configurado no projeto OpenAI e não cobre código novo que deliberadamente ignore `createPaidModel`. Revisão de qualquer novo ponto de integração OpenAI permanece necessária. `store=false` impede o armazenamento de Response para recuperação; isso **não** equivale a ausência de logs de monitoramento de abuso ou de cache de prompt do provedor. A [política oficial de dados](https://developers.openai.com/api/docs/guides/your-data) descreve esses regimes separadamente.

## Inventário remoto somente leitura

Com a credencial e o cabeçalho de projeto já configurados, sem imprimir segredo, foram feitas somente consultas GET, sem inferência:

| Recurso | Resultado observado | Conclusão limitada |
| --- | --- | --- |
| `GET /v1/containers?limit=100` | HTTP 200, 0 itens, `has_more=false` | Nenhum container visível **agora** neste escopo; não audita cobrança histórica nem recursos invisíveis à chave. |
| `GET /v1/files?limit=100` | HTTP 401 | Existência/volume de Files não verificável com esta credencial. |
| `GET /v1/vector_stores?limit=100` | HTTP 401 | Existência/volume de Vector Stores não verificável com esta credencial. |
| `GET /v1/assistants?limit=100` | HTTP 404 | Endpoint legado indisponível neste acesso; não prova ausência de recursos antigos. |

Não foram criados, apagados ou modificados recursos remotos. Conferência manual necessária no [Platform Dashboard](https://platform.openai.com/): selecionar **Everflair Development**, conferir se o ID do projeto corresponde ao `SALON_SECRETARY_OPENAI_PROJECT` local, abrir **Storage/Files** e **Vector Stores** (ou a seção equivalente da UI) e verificar itens, tamanho e eventual retenção. Na **Usage** escolher o projeto no seletor próprio, revisar custos por linha **Containers/Hosted Shell/Code Interpreter**, **File search storage/calls**, **Web search** e **tokens Responses**; verificar período atual e histórico da cobrança anterior. Em **Project settings → Limits/Budgets**, conferir teto e alertas sem alterá-los. Não afirmar que serviços invisíveis à chave estão desabilitados. [Projetos e escopo](https://help.openai.com/en/articles/9186755), [Usage e filtros](https://help.openai.com/en/articles/10478918-reviewing-api-usage-and-costs).

## Tarifa oficial verificada

[GPT-6 Luna — Standard, contexto curto](https://developers.openai.com/api/docs/models/gpt-6-luna), USD por 1 milhão de tokens: input **$0.10**, cached input **$0.01**, cache write **$0.125**, output **$0.50**. Acima de 272 mil tokens de input, tabela de contexto longo: input **$0.20**, cached **$0.02**, cache write **$0.25**, output **$0.75**. O cálculo offline suporta apenas o contexto curto e falha fechado acima desse limite. Output já inclui reasoning. Não foi ativado Batch, Flex, Fast ou processamento regional especial.

[Cobranças separadas de tools](https://developers.openai.com/api/docs/pricing): Web Search $10/1.000 calls mais tokens de conteúdo; File Search $0.10/GB/dia (primeiro GB gratuito) e $2.50/1.000 calls; containers de Hosted Shell/Code Interpreter têm tarifa por capacidade/tempo (1 GB $0.03 por sessão de referência de 20 minutos, com regra atual de cobrança por minuto e mínimo de 5 minutos). A request normal protegida tem **zero** dessas tools; seu custo variável esperado é somente token GPT-6 Luna. A ausência de tool na request não prova ausência de custos de recursos antigos no projeto; por isso a conferência de Usage/Storage acima.

## Bateria candidata congelada

`packages/salon-secretary/evaluation/gpt6-luna-candidate.ts` seleciona dez mensagens/expecteds já revisados no dataset de 40 casos, sem editar o JEV. A comparação separa Skill, operação, campos, dependências, aceitação da boundary, validação backend, retries, usage e latência. Baseline histórico é `gpt-5.6-luna`; onde só existe relatório, não há comparação numérica pareada.

| Caso | Mensagem exata preparada | Expected essencial |
| --- | --- | --- |
| Services create | “Cadastre uma massagem por R$50.” | `services/service.create`, preço 5000 centavos; duração faltante. |
| Services change | “Altere o preço da massagem para R$80.” | `services/service.change`, preço 8000 centavos. |
| Customers | “Cadastre Amanda Souza.” | `customers/customer.create`, nome completo. |
| Scheduling create | “Marque Amanda amanhã às 10h com Tatiana para Progressiva.” | `scheduling/appointment.create`, refs somente pelo backend. |
| Scheduling change | “Passe a Amanda de amanhã às 10h para 11h.” | `scheduling/appointment.change`, hora nova 11:00. |
| Scheduling Batch | “Cancele a Amanda das 10h e coloque o Fábio nesse horário para corte masculino. Motivo: substituição solicitada pela equipe.” | `appointment.cancel → appointment.create`, dependência explícita. |
| Financial | “Quanto faturei ontem?” | `financial/financial.report`, `service_revenue`, yesterday; valor só do T09. |
| Inventory | “Quais produtos estão com estoque baixo?” | `inventory/product.search`, low_stock; saldo só do backend. |
| Communication EXACT | “Mande exatamente para o Fábio no WhatsApp: ‘Serviço cancelado, Fábio.’” | `communication/customer.message`, EXACT, sem reescrita. |
| Scheduling → Communication/nome composto | “Cancele a Amanda Communication Sintética de amanhã às 14h e mande exatamente no WhatsApp: ‘Amanda, seu horário foi cancelado.’ Motivo: teste controlado.” | `appointment.cancel → customer.message`; nome íntegro; service ausente. |

As strings armazenadas no dataset (inclusive aspas Unicode) são a fonte exata para execução futura; a tabela é leitura humana. Os anchors da fixture apontam para golden outputs e baselines reais ou relatórios por caso. A bateria futura não deve confirmar proposta, tocar produção ou acrescentar nova Tool.

Plano de primeira execução **ainda não autorizado**: preflight do local/descartável, projeto, `store=false`, wire guard e paid flag false; habilitar a flag apenas pelo runner controlado, enviar no máximo as 10 mensagens acima na ordem, uma inferência por mensagem, retries zero, parar no primeiro erro material de Skill/operação/dependência/boundary, request fora da allowlist, tool hospedada ou container; nunca confirmar proposta; restaurar flag false no `finally`. Cada inferência expõe só `select_capabilities` no Agent inicial; continuação, se futuramente aprovada, expõe só `upsert_action_draft`. Não executar GPT-5.6 novamente: usar histórico, anotando prompts/fixtures/tempo não pareados. Capturar request/response IDs, input/cached/cache-write/output/reasoning/total, latências e custo com a tarifa acima.

Estimativa conservadora condicionada a **até 10.000 tokens de input e 1.200 de output por inferência** (todos os inputs ao preço mais caro de cache write, sem desconto): 10 calls × (10.000 × $0.125 + 1.200 × $0.50) / 1M = **US$0.0185**. É teto do cenário de planejamento, não limite financeiro garantido: custo depende do usage real e da tarifa vigente na execução. Antes de autorizar a bateria real, confirmar teto/hard limit no portal. Nenhuma cobrança de hosted tool/container integra essa estimativa porque o guard bloqueia sua inclusão.

## Rollback e limites

Rollback do modelo candidato: manter ou restaurar `SALON_SECRETARY_MODEL=gpt-5.6-luna` e `SALON_SECRETARY_ALLOW_PAID_CALLS=false`; não há migration ou estado remoto para reverter. Rollback do código: remover o import/chamadas de `openai-cost-guard.ts` em `index.ts`, o arquivo de guard, testes e fixture candidatos, e as duas linhas de comentário em `.env.example`; isso removeria a proteção adicional e requer revisão de segurança antes de fazê-lo. JEV, as seis Skills, Tools, Registry, backend, RLS, grants, Outbox, billing e produção não foram modificados.

Limitações: `gpt-6-luna` ainda não recebeu request real, portanto compatibilidade efetiva, qualidade, latência e custo por caso são desconhecidos; parte do baseline histórico só tem relatório, não dados brutos; arquivos/vector stores remotos não foram auditáveis com a credencial atual; containers passados podem já ter expirado. Este Gate prepara validação controlada, sem colocar JEV ou GPT-6 no fluxo normal.

## Verificação executada

- Testes direcionados do SDK, cost guard e candidato: 48/48 aprovados, inclusive request `gpt-6-luna` de descoberta e interpretação pelo transporte fake, sem rede.
- `npm test`: 1.693/1.693 aprovados em 241 arquivos; regressões das seis Skills, boundary, batch e JEV isolado incluídas.
- `npm run lint` e `npx tsc --noEmit --incremental false`: aprovados.
- `npm run build`: primeira tentativa compilou e falhou na coleta de páginas por `NEXTAUTH_SECRET` ausente neste worktree; repetido com segredo **sintético efêmero somente no processo do build**, passou. `.env.local` não foi alterado.
- `.env.local` permaneceu ignorado/não rastreado, modelo ativo `gpt-5.6-luna`, paid flag `false`. Nenhuma chamada GPT-6, GPT-5.6 ou JEV, nenhuma hosted tool executada, nenhum container criado e nenhuma alteração administrativa remota.
