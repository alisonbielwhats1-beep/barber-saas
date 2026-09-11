# Everflare HQ — agentes, fase 1

Base: master 433afcb, PR #92 publicado. A solicitação posterior autoriza começar
a estrutura e validar por etapas; sucede o limite de não implementar SDK da
fundação inicial. Não autoriza compra, envio de mensagens ou consumo de API.

## Auditoria e primeira entrega

Next.js 15.5.25 / React 18 / TypeScript, NextAuth SUPER_ADMIN, Prisma/Supabase
com RLS. Reutilizar /hq, withHq e seus serviços; não tocar nas sessões dos
salões. A área agents era um placeholder. Não há vínculo account–salon,
telemetria de uso, WhatsApp, base de conhecimento nem runner instalado.

Entrega 1: laboratório privado, executando o Agents SDK com um modelo
determinístico local e cenários fictícios. Ele valida execução de ferramentas,
permissões, escopo, interrupção e limites, NÃO a qualidade de um modelo real.
Resultados ficam apenas na sessão da página; não entram no CRM ou banco.
Não há chamadas OpenAI, arquivos enviados, mensagens externas ou cobranças.
Sem migration nesta fase. O SDK é isolado em workspace com Zod 4 para não
alterar o contrato Zod 3 usado pelo produto existente.

## Organização

Você é o CEO. Chefe coordena operações; Suporte atende dúvidas; Vendas inclui
follow-up; Produto organiza solicitações; Financeiro consulta números
calculados em código; Marketing prepara ações. Nesta fase Chefe e Suporte
têm fluxos exercitáveis; demais áreas são planejadas e assim identificadas.
Especialistas são acionados conforme necessidade, sem debate permanente.

## Arquitetura alvo e limites

Canal -> validação/identidade -> inbox persistente -> fila -> especialista ->
ferramentas autorizadas -> resultado/pendência -> outbox -> canal.
Chefe usa o mesmo conjunto de ferramentas sob identidade interna verificada.
Cliente externo nunca ganha ferramentas globais do Chefe.

Cada execução recebe contexto estabelecido pelo servidor: identidade,
escopo de conta, canal e permissões. Texto, transcrição ou imagem jamais
definem autorização. Cada ferramenta revalida escopo e argumentos, mesmo
que o modelo seja instruído a ignorar restrições. Não expor SQL livre,
segredos, dados de clientes finais dos salões ou ações de cobrança.
O laboratório usa a mesma fronteira de ferramentas com repositório fictício.
Conhecimento da fase 1 é demonstrativo; artigos reais exigem revisão/versionamento.

## Próximas fases e critérios de liberação

2. Dados e persistência: vínculo explícito account–salon, sem união automática
por telefone. Último acesso, última ação e dias ativos em 7/30 dias, sem copiar
cadastros operacionais. Tabelas hq_agent_runs, hq_agent_events, hq_conversations,
hq_messages, hq_jobs, hq_outbox, hq_approvals, hq_knowledge e hq_usage com RLS,
índices, versão, FK e retenção. Só aplicar após preflight/backup/CI de banco.
IDs externos únicos evitam repetição. Jobs têm lease, tentativas limitadas,
retry com backoff, timeout e fila de falhas. Uma conversa processada por vez.

3. Piloto OpenAI no HQ: credencial exclusivamente no servidor, modelo Luna
configurável, orçamento reservado atomicamente antes da chamada e reconciliado
com usage. Limites de entrada/saída, rodadas e duração; fallback humano.
Registrar versão do prompt/modelo, ferramentas, falhas e custo, sem logs de
segredos nem raciocínio privado. Histórico redigido por conta e resumo com
fontes; retenção/exclusão de mídia definidas antes de receber dados reais.
Testes de qualidade: casos rotulados, instruções maliciosas, isolamento,
informação ausente, indisponibilidade, qualidade em português e custo.

4. WhatsApp: confirmar número, conta Meta e coexistência; verificar assinatura
dos webhooks, deduplicar e persistir antes de ACK. Agrupar mensagens próximas,
baixar mídia autenticada com limites/tipos permitidos, transcrever áudio,
interpretar prints e responder inicialmente por texto. Identidade do remetente
é vínculo verificado, não confiança irrestrita no telefone. Respeitar consentimento,
opt-out, janela e templates. Outbox retoma falhas sem duplicar envios.
Caixa de entrada e modo humano bloqueiam respostas concorrentes do agente.

5. Autonomia gradual: leitura e rascunho; depois tickets/follow-ups; respostas
automáticas somente em casos validados. Aprovação vinculada a ator, parâmetros,
versão e validade; recalcular autorização na execução. Valores, estornos,
cancelamentos e campanhas não ficam liberados por aprovação genérica.

## Custos e escala

Laboratório: zero tokens externos; usa computação normal da aplicação.
Estimativa anterior de US$10–15/mês é reserva de IA de baixo volume, não
orçamento integral garantido. Fila, armazenamento, mídia, busca hospedada,
mensagens proativas, impostos e excedentes precisam ser medidos no piloto.
Sem contratação nesta fase. SDK não implica assinatura por especialista.
Escala depende de mensagens simultâneas, não só número de clientes. Validar
carga progressiva e aumentar workers/compute mantendo contratos e isolamento.

## Validação e recuperação

Unitários: ferramentas negadas, conta diferente, limite, replay e cancelamento.
SDK real com modelo local: executar ferramentas e retornar resultado.
Navegador: administrador usa cenários, muda responsável/caso, vê passo a passo,
executa bateria e reinicia; visitante/usuário comum sem acesso.
Lint, TypeScript, suíte, build e CI. Sem teste de IA real nessa fase.
Rollback: voltar o código; nenhum schema/dado precisa ser revertido.
